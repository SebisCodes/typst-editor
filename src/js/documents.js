/**
 * The documents of "My documents" in the editor: opening one (each keeps its own undo history
 * while the page is open), making a new one, starting the open one over, the "New" menu, and
 * the buttons of the top bar for "My documents", Undo and Redo.
 *
 * openDocument() runs these steps:
 *   1. end an edit on the page, store the open document's waiting edits and keep its history;
 *   2. take the other document's code, name, history and the files read so far;
 *   3. show it from the top, compile it, and compile again once its files are read.
 */

import { store } from './files.js?v=10';
import { assets } from './assets.js?v=6';
import { START, TEMPLATES, BLANK } from './samples.js?v=3';
import { openConfirmation } from './dialogs.js?v=5';
import { state, ui, areas, DEFAULT_NAME, NARROW_SCREEN, getElement, getElements, showToast } from './state.js?v=2';
import { setCode, addHistoryStep, updateHistoryButtons, undo, redo } from './history.js?v=3';
import { startCompile } from './compile.js?v=3';
import { saveWaitingEdits } from './storage.js?v=3';
import { showCodePosition } from './code-view.js?v=3';
import { isTextEditing, stopTextEdit } from './text-edit.js?v=3';
import { renderInsertPanel } from './insert-panel.js?v=3';
import { createFilesDialog } from './files-dialog.js?v=3';

const STORAGE_FULL = 'The browser storage is full - delete or download documents under "My documents" first';
/** The lines a start over keeps at the top: rules, imports, definitions and comments. */
const KEPT_LINE = /^\s*(#(set|show|import|let)\b|\/\/)/;
/** The undo history of each document opened in this page, by id. */
const documentHistories = new Map();

/**
 * Shows the open document's name in the top bar, the tooltip of "My documents" and the "New" menu.
 * @returns {void}
 */
export function showFileName() {
    getElement('#file-name').textContent = state.name;
    getElement('#btn-files').title = `"${state.name}" is open. My documents: open, rename, duplicate or delete your documents (Ctrl+O)`;
    getElement('#new-restart b').textContent = `Start "${state.name}" over`;
}

/**
 * Opens a document of "My documents" (the steps in the header).
 * @param {string} id - the document's id.
 * @param {string} [code] - its code, when the caller has it; else it is read from the store.
 * @returns {void}
 */
export function openDocument(id, code) {
    saveClosedDocument();
    const opened = code ?? store.code(id) ?? BLANK;
    setOpenedDocument(id, opened);
    showOpenedDocument(opened);
    assets.get(id).then(files => showOpenedFiles(id, files));
}

/**
 * Takes the files of a document read after it opened and compiles it with them, while it is
 * still open and the files differ from the ones shown.
 * @param {string} id - the document that was opened.
 * @param {Object<string, string>} files - its files: name -> data URI.
 * @returns {void}
 */
function showOpenedFiles(id, files) {
    if (state.fileId !== id || files === state.assets) return;
    state.assets = files;
    renderInsertPanel();
    startCompile();
}

/**
 * Cancels an edit on the page, stores the edits of the document being closed that still wait
 * for the delayed store, and keeps its undo history for when it opens again.
 * @returns {void}
 */
function saveClosedDocument() {
    clearTimeout(state.historyTimer);
    if (isTextEditing()) stopTextEdit(false);
    saveWaitingEdits();
    if (!state.fileId) return;
    addHistoryStep();
    documentHistories.set(state.fileId, { history: state.history, future: state.future });
}

/**
 * Sets a document into the state: id, name, the code as stored, its history and its files as
 * far as they are read.
 * @param {string} id - the document's id.
 * @param {string} code - its code.
 * @returns {void}
 */
function setOpenedDocument(id, code) {
    state.fileId = id;
    state.name = store.getEntry(id)?.name || DEFAULT_NAME;
    state.savedCode = code;
    const kept = documentHistories.get(id);
    state.history = kept ? kept.history : [];
    state.future = kept ? kept.future : [];
    state.assets = assets.getCached(id);
}

/**
 * Shows the opened document from the top and draws everything for it.
 * @param {string} code - its code.
 * @returns {void}
 */
function showOpenedDocument(code) {
    ui.ta.value = code;
    ui.ta.scrollTop = 0;
    ui.ta.setSelectionRange(0, 0);
    ui.scroller.scrollTop = 0;
    setCode(code, { history: false });
    addHistoryStep();
    updateHistoryButtons();
    showFileName();
    areas.files.render();
    renderInsertPanel();
    areas.sync?.updateUi();
}

/**
 * Makes a new document in "My documents" and opens it with the cursor at its end. A command
 * that returns the new id, as the callers need it.
 * @param {string} name - the wanted name.
 * @param {string} code - the code.
 * @param {Object<string, string>} [files] - its pictures and files.
 * @param {boolean} [inMemory] - keep it in memory only (a page's document), never stored.
 * @returns {string|null} the id, null when the browser storage is full.
 */
export function openNewDocument(name, code, files, inMemory = false) {
    let id;
    try { id = store.create(name, code, inMemory); } catch (e) {
        showToast(STORAGE_FULL);
        return null;
    }
    if (files && Object.keys(files).length) assets.set(id, files);
    openDocument(id, code);
    if (!NARROW_SCREEN.matches) setTimeout(() => showCodePosition(code.length), 0);
    return id;
}

/**
 * Empties the text of the open document but keeps its #set, #show, #import and #let lines (and
 * comments) at the top, after asking; "Undo" brings it back. Nothing happens when another
 * document was opened while the question was open.
 * @returns {Promise<void>} settles when it is done or cancelled.
 */
async function clearDocumentOnConfirm() {
    const lines = state.code.split('\n');
    let kept = 0;
    for (const line of lines) { if (KEPT_LINE.test(line) || !line.trim()) kept++; else break; }
    const head = lines.slice(0, kept).join('\n').replace(/\s*$/, '');
    const emptied = head ? head + '\n\n' : '';
    if (state.code === emptied) { showToast('This document is empty already'); return; }
    const forId = state.fileId;
    if (!await openConfirmation({
        title: `Start "${state.name}" over?`,
        text: head ? 'The text is removed; the settings at the top (#set, #show, #import, #let) stay. "Undo" brings it back as long as the page is open.' : 'Everything is removed. "Undo" brings it back as long as the page is open.',
        ok: 'Start over',
    })) return;
    if (state.fileId !== forId) return;
    setCode(emptied);
    showCodePosition(emptied.length);
    showToast(`"${state.name}" is empty now - "Undo" brings it back`);
}

/**
 * Runs an entry of the "New" menu: start the open document over, or a new document from the
 * welcome example, a template or a blank page.
 * @param {string} kind - "restart", "example", a template's key, or "blank".
 * @returns {void}
 */
export function openFromMenu(kind) {
    if (kind === 'restart') { clearDocumentOnConfirm(); return; }
    const template = kind === 'example' ? START : TEMPLATES[kind];
    if (openNewDocument(template ? template.name : DEFAULT_NAME, template ? template.code : BLANK)) showToast(`New document "${state.name}" - your other documents are under "My documents"`);
}

/**
 * Connects "My documents" (files-dialog.js) to the editor.
 * @param {function(): void} showFilePicker - asks for a file to open.
 * @returns {import('./files-dialog.js').FilesDialog} the dialog's API.
 */
export function createDocumentsDialog(showFilePicker) {
    return createFilesDialog({
        getCurrent: () => ({ id: state.fileId, name: state.name, code: state.code }),
        openDocument: id => { openDocument(id); showToast(`"${state.name}" opened`); },
        openNew: openFromMenu,
        renameDocument,
        onRemoved: openAfterRemoval,
        showFilePicker,
        showToast,
    });
}

/**
 * Gives a document a new name.
 * @param {string} id - the document's id.
 * @param {string} name - the new name.
 * @returns {void}
 */
function renameDocument(id, name) {
    try { store.save(id, { name }); } catch (e) { showToast('The browser storage is full'); return; }
    if (id !== state.fileId) return;
    state.name = name;
    showFileName();
    areas.sync?.handleChange();
}

/**
 * Forgets the history of a deleted document; when it was open, opens the most recent other
 * one, or a new blank document.
 * @param {string} id - the deleted document's id.
 * @returns {void}
 */
function openAfterRemoval(id) {
    documentHistories.delete(id);
    if (id !== state.fileId) return;
    state.fileId = '';
    const next = store.getSortedEntries()[0];
    if (next) openDocument(next.id);
    else openNewDocument(DEFAULT_NAME, BLANK);
}

/**
 * Opens or closes the "New" menu; the first entry gets the focus when it opens.
 * @param {boolean} [open] - true to open, false to close; switches when left out.
 * @returns {void}
 */
export function applyNewMenuSwitch(open = getElement('#new-menu').hidden) {
    const menu = getElement('#new-menu');
    menu.hidden = !open;
    getElement('#btn-new').setAttribute('aria-expanded', open);
    if (open) menu.querySelector('button').focus();
}

/**
 * Tells whether the "New" menu is open.
 * @returns {boolean} true while it is open.
 */
export function isNewMenuOpen() {
    return !getElement('#new-menu').hidden;
}

/**
 * Connects the "New" menu (arrow keys move, Escape closes, a click outside closes) and the
 * buttons of "My documents", Undo and Redo.
 * @returns {void}
 */
export function startDocumentButtons() {
    const newButton = getElement('#btn-new'), menu = getElement('#new-menu');
    newButton.addEventListener('click', () => applyNewMenuSwitch());
    menu.addEventListener('click', openNewDocumentOnClick);
    menu.addEventListener('keydown', event => {
        const items = getElements('button', menu), index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
        if (event.key === 'Escape') { event.stopPropagation(); applyNewMenuSwitch(false); newButton.focus(); }
    });
    document.addEventListener('pointerdown', event => { if (!menu.hidden && !event.target.closest('#new-menu, #btn-new')) applyNewMenuSwitch(false); });
    getElement('#btn-files').addEventListener('click', () => areas.files.open());
    getElement('#btn-undo').addEventListener('click', undo);
    getElement('#btn-redo').addEventListener('click', redo);
}

/**
 * Closes the "New" menu and opens what the clicked item stands for.
 * @param {MouseEvent} event - the click in the menu.
 * @returns {void}
 */
function openNewDocumentOnClick(event) {
    const entry = event.target.closest('[data-new]');
    if (!entry) return;
    applyNewMenuSwitch(false);
    openFromMenu(entry.dataset.new);
}
