/**
 * Typst editor: the code on the left, the compiled pages in the middle, the document settings
 * beside them. This file starts the editor and wires its areas together; each area has its own
 * module (state.js describes the shared state).
 *
 * The code is the single source of truth: the real Typst compiler (WebAssembly in a worker,
 * compiler.js / worker.js) compiles it a moment after each change and the pages are shown as
 * SVG. The settings and insert buttons change the code. Text on the pages is found in the code
 * through the compiler's syntax tree (plain text runs of the markup, text-runs.js), so a click
 * on the page leads to the code, the cursor in the code to the page, and text that is in the
 * code exactly as on the page can be edited on the page.
 *
 * Start-up steps:
 *   1. the interface language (the AI prompt stays English) and the line wrap of the code;
 *   2. start the compiler and connect the code view, the pages, the side panel, the documents,
 *      opening files, the keyboard, the layout, the Export dialog, the dialogs and the controls of
 *      template placeholders, in the order their listeners take events;
 *   3. take the stored settings and open the last document (or the welcome example);
 *   4. draw everything, and compile once the document's files are read;
 *   5. start the AI Assistant, the WebMCP tools, the AI status, "Open in another editor" and
 *      sync.js (webhook, embedding, ?src=);
 *   6. offer the test hook window.typstEditor.
 */

import { createI18n } from './i18n.js?v=26';
import { createWrap } from './wrap.js?v=5';
import { createAiStatus } from './aistatus.js?v=9';
import { createSync, VIEWER } from './sync.js?v=24';
import './export-menu.js?v=6';
import { startConvert } from './convert-to.js?v=15';
import { START } from './samples.js?v=3';
import { store } from './files.js?v=10';
import { assets } from './assets.js?v=6';
import { createAi } from './ai.js?v=10';
import { createMcp } from './mcp.js?v=4';
import { state, ui, areas, PREFIX, showToast } from './state.js?v=3';
import { getSettings, startStorageSync } from './storage.js?v=6';
import { renderCode, moveCodeLayers, showCodePosition, startCursorLine, startCodeView } from './code-view.js?v=6';
import { setCode, addHistoryStep, undo, redo } from './history.js?v=6';
import { startCompilerWorker, startCompile, waitForCompile } from './compile.js?v=6';
import { startSourceMark } from './source-mark.js?v=6';
import { startTextEditing } from './text-edit.js?v=6';
import { startPictureMove, startPictureRemoving } from './picture-move.js?v=6';
import { setZoom, showPage, startZoom } from './zoom.js?v=6';
import { startProblems } from './problems.js?v=6';
import { startToolbar } from './code-insert.js?v=6';
import { startTyping } from './typing.js?v=6';
import { renderInsertPanel, startInsertPanel } from './insert-panel.js?v=6';
import { startFilesTab } from './files-tab.js?v=6';
import { renderSettingsPanel, startSettingsPanel } from './settings-panel.js?v=6';
import { renderOutline, startOutline } from './outline.js?v=6';
import { showFileName, openDocument, createDocumentsDialog, startDocumentButtons } from './documents.js?v=6';
import { showOpenPicker, startOpenButton, startFileImport } from './file-import.js?v=6';
import { startKeyboard } from './keyboard.js?v=6';
import { showSplit, startLayout, startDialogs } from './layout.js?v=6';
import { startExportDialog } from './export-dialog.js?v=6';
import { exportPdf, getPageSvg, drawPageCanvas, showPrintDialog, getPagePictures } from './export.js?v=6';
import { startTemplateControls, updateTemplateView } from './template-panel.js?v=3';
import { createTemplateExamples } from './template-examples.js?v=2';
import { receiveDocument, importExternalDocument } from './incoming.js?v=6';
import { getPromptState, getProblemList, getOutlineList, getFileList, openFileByName, createFile, addCode, updateText, showLine } from './agent-api.js?v=6';

/** How often a picture that could not be stored is reported, at most, in milliseconds. */
const NOT_STORED_INTERVAL = 60000;
/** The scale of a page picture of the test hook when none is given. */
const TEST_PICTURE_SCALE = 1.5;
let notStoredWarnedAt = 0;

startEditor();

/**
 * Starts the editor (the flow of the steps in the header).
 * @returns {void}
 */
function startEditor() {
    startLanguageAndWrap();
    connectAreas();
    applyMemoryForPageFiles();
    openStartDocument();
    startDocument();
    window.typstEditor = createTestHook();
}

/**
 * Starts the interface language (translated at run time, see i18n.js) and the line wrap of
 * the code view (wrap.js), which draws the line numbers.
 * @returns {void}
 */
function startLanguageAndWrap() {
    areas.i18n = createI18n({
        prefix: 'typsteditor',
        roots: '.header, .views, #work, #ai-receive, #toast, .storage-hint, dialog',
        skip: '',
    });
    areas.lineWrap = createWrap({
        prefix: PREFIX, ta: ui.ta, layers: [ui.hl, ui.marks], gutter: ui.gutter, button: document.getElementById('btn-wrap'),
        onChange: () => { renderCode(); moveCodeLayers(); },
    });
}

/**
 * Starts the compiler and connects the areas of the page, in the order their listeners take events.
 * @returns {void}
 */
function connectAreas() {
    startStorageSync();
    startCursorLine();
    startCompilerWorker();
    startSourceMark();
    startTextEditing();
    startPictureMove();
    startPictureRemoving();
    startZoom();
    startProblems();
    startCodeView();
    startToolbar();
    startTyping();
    startInsertPanel();
    startFilesTab();
    startSettingsPanel();
    startOutline();
    areas.files = createDocumentsDialog(showOpenPicker);
    startDocumentButtons();
    startOpenButton();
    startFileImport();
    startKeyboard();
    startLayout();
    startExportDialog();
    startDialogs();
    startTemplateControls();
}

/**
 * Keeps the pictures of documents from a page in memory like the documents; a picture that
 * could not be stored is kept until the page closes, and the user is told (at most once a minute).
 * @returns {void}
 */
function applyMemoryForPageFiles() {
    assets.setMemoryOnlyRule(id => VIEWER || store.isInMemory(id));
    assets.setNotStoredHandler(showNotStoredWarning);
}

/**
 * Tells the user that a picture could not be stored, at most once in NOT_STORED_INTERVAL.
 * @returns {void}
 */
function showNotStoredWarning() {
    const now = Date.now();
    if (now - notStoredWarnedAt < NOT_STORED_INTERVAL) return;
    notStoredWarnedAt = now;
    showToast('The picture could not be stored in this browser (storage full or blocked) - it is kept only until the page is closed: download the document to keep it');
}

/**
 * Takes the stored settings and opens the last document, or the welcome example when
 * "My documents" is empty; with the storage blocked, the example without saving.
 * @returns {void}
 */
function openStartDocument() {
    const settings = getSettings();
    if (settings) {
        if (settings.split) state.split = settings.split;
        if ('fit' in settings) state.fit = settings.fit;
        if (settings.zoom) state.zoom = settings.zoom;
    }
    showSplit();
    let code = null;
    try {
        if (!store.list().length) store.create(START.name, START.code);
        const entry = store.getEntry(settings?.file) || store.getSortedEntries()[0];
        code = store.code(entry.id);
        if (code != null) { state.fileId = entry.id; state.name = entry.name; state.savedCode = code; state.assets = assets.getCached(entry.id); }
    } catch (e) { /* storage blocked: one document without saving */ }
    if (code == null) { code = START.code; state.name = START.name; }
    state.code = code;
}

/**
 * Draws the start document, then reads its files, compiles it, makes its first undo step and
 * starts the AI and sync.
 * @returns {void}
 */
function startDocument() {
    ui.ta.value = state.code;
    showFileName();
    renderInsertPanel();
    renderCode();
    renderSettingsPanel();
    renderOutline();
    Promise.resolve(state.fileId ? assets.get(state.fileId).then(files => { state.assets = files; }) : null).then(startLoadedDocument);
}

/**
 * Shows the start document's files, compiles it, makes its first undo step and starts the AI
 * and sync, once its files are read.
 * @returns {void}
 */
function startLoadedDocument() {
    renderInsertPanel();
    startCompile();
    addHistoryStep();
    moveCodeLayers();
    startAiAndSync();
}

/**
 * Starts the AI Assistant, the WebMCP tools, the AI status, "Open in another editor" and
 * sync.js. The callbacks reach the areas through `areas`, so each may start after the ones
 * it calls.
 * @returns {void}
 */
function startAiAndSync() {
    areas.ai = createAi({
        getState: getPromptState,
        receiveDocument: async (...args) => { setTimeout(() => areas.aiStatus.addDelivery('link')); await receiveDocument(...args); return state.fileId; },
        tryOpenDocument: id => { if (!store.getEntry(id)) return false; openDocument(id); return true; },
        showToast,
        getRemote: () => areas.sync?.getAiSettings() || null,
        fetchKey: () => (areas.sync ? areas.sync.fetchKey() : Promise.resolve(null)),
        hasValidKey: () => !!areas.sync?.hasValidKey(),
        handleAiClick: openEditorDialog => (areas.sync ? areas.sync.handleAiClick(openEditorDialog) : openEditorDialog()),
        getKeyDecline: () => areas.sync?.getKeyDecline() || '',
    });
    const agent = createMcp({
        onUse: () => areas.aiStatus.addDelivery('agent'),
        getState: getPromptState,
        getProblems: getProblemList,
        getOutline: getOutlineList,
        getFiles: getFileList,
        openFileByName,
        createFile,
        receiveDocument,
        addCode,
        updateText,
        showLine,
        undo,
    });
    areas.aiStatus = createAiStatus({
        prefix: PREFIX, btn: document.getElementById('btn-ai'), box: document.getElementById('ai-status'),
        remote: () => areas.sync?.getAiSettings() || null, agent: () => agent,
    });
    startConvert({ editor: 'typst', code: () => state.code, name: () => state.name, toast: showToast, t: text => areas.i18n.translate(text), hasFiles: () => Object.keys(state.assets || {}).length > 0 });
    areas.sync = createSync(createSyncEditor());
}

/**
 * Creates what sync.js gets from the editor; the property names are sync.js's contract.
 * @returns {object} the adapter.
 */
function createSyncEditor() {
    return {
        onAiResult: () => areas.aiStatus.addDelivery('page'),
        onAiEnd: () => areas.aiStatus.resetDelivery(),
        prefix: PREFIX, editor: 'typst', word: 'document', files: true,
        current: () => ({ id: state.fileId, name: state.name, content: state.code, assets: state.assets }),
        load: importExternalDocument,
        toast: showToast,
        hookFor: id => store.getEntry(id)?.hook || null,
        setHookFor: (id, hook) => { try { store.setEntryFields(id, { hook }); } catch (e) { showToast('The browser storage is full'); } },
        onAi: () => areas.ai?.updateRemote(),
        pdf: exportPdf,
        parseTemplate: message => createTemplateExamples(message),
        onTemplate: updateTemplateView,
    };
}

/**
 * Creates the hook for automated UI tests (window.typstEditor); its keys are the ones the tests call.
 * @returns {object} the state and the functions the tests call.
 */
function createTestHook() {
    return {
        state, store, assets, setCode, undo, redo, compiled: waitForCompile, zoomTo: setZoom, goPage: showPage, receive: receiveDocument,
        revealInCode: showCodePosition, sync: () => areas.sync, print: showPrintDialog,
        pdf: () => exportPdf().then(result => result.pdf), pageSvg: getPageSvg,
        pagePng: (index = 0, scale = TEST_PICTURE_SCALE) => drawPageCanvas(index, scale).then(canvas => canvas.toDataURL()),
        pictureSvgs: () => getPagePictures('svg', 'all', 1, 'page').then(pictures => pictures.map(picture => picture.data)),
    };
}
