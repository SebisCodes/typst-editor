/**
 * Documents that arrive: from AI links and WebMCP tools (ai.js, mcp.js), and from the page
 * around the editor or ?src= (sync.js).
 *
 * A document from an AI goes to the document the link names: "new" makes a new document, a
 * name opens that document (or makes it when there is none), no name means the open one; with
 * mode "add" the text goes at the end. A change of an existing document is one undo step.
 *
 * A document from a page replaces the document of that name that came from the same page
 * before (one undo step), or becomes a new document; the user's own documents are never
 * replaced. A document a page hands over is kept in memory only, never stored.
 */

import { store } from './files.js?v=10';
import { assets } from './assets.js?v=6';
import { BLANK } from './samples.js?v=3';
import { VIEWER } from './sync.js?v=23';
import { state, ui, AI_DOCUMENT_NAME, showToast } from './state.js?v=2';
import { setCode } from './history.js?v=3';
import { startCompile, waitForCompile } from './compile.js?v=3';
import { openDocument, openNewDocument } from './documents.js?v=3';
import { renderInsertPanel } from './insert-panel.js?v=3';


/**
 * Which document an AI's document is for.
 * @typedef {object} ReceiveTarget
 * @property {string} [file] - "new", the name of a document, or "" for the open one.
 * @property {string} [name] - the name of a new document.
 * @property {boolean} [direct] - true for a call of a WebMCP tool.
 */

/**
 * Takes a document from an AI (see the header) and waits for the compiler to report on it; in
 * the viewer no message is shown.
 * @param {string} code - the Typst code.
 * @param {string} mode - "add" to add it at the end, anything else to replace the code.
 * @param {ReceiveTarget} [target] - which document.
 * @returns {Promise<void>} settles when the document is in the editor and compiled.
 */
export async function receiveDocument(code, mode, target = {}) {
    const wanted = String(target.file || '').trim();
    const isNew = wanted.toLowerCase() === 'new';
    const entry = isNew ? null : wanted ? store.findByName(wanted) : store.getEntry(state.fileId);
    if (!entry) {
        const name = isNew ? target.name || AI_DOCUMENT_NAME : wanted || AI_DOCUMENT_NAME;
        if (openNewDocument(name, mode === 'add' ? addAtEnd(BLANK, code) : code)) VIEWER || showToast(`New document "${state.name}" from the AI - your other documents are unchanged`);
        return;
    }
    // The link says which document (chosen with the prompt's buttons): no question; "Undo" takes the change back.
    if (entry.id !== state.fileId) openDocument(entry.id);
    setCode(mode === 'add' ? addAtEnd(state.code, code) : code);
    await waitForCompile();
    const errors = state.problems.filter(problem => problem.kind === 'error').length;
    VIEWER || showToast(errors ? `Document received - the compiler found ${errors} ${errors === 1 ? 'problem' : 'problems'}, see above the code` : `"${state.name}" changed by the AI - "Undo" takes it back`);
}

/**
 * Returns the code with text added at its end, after a blank line.
 * @param {string} code - the code.
 * @param {string} text - the text to add.
 * @returns {string} the code with the text and a line break at the end.
 */
function addAtEnd(code, text) {
    return code.replace(/\s*$/, '\n\n') + text.trim() + '\n';
}

/**
 * A document from the page around the editor or from ?src= (sync.js's load contract).
 * @typedef {object} ExternalDocument
 * @property {string} name - its name.
 * @property {string} content - its code.
 * @property {Object<string, string>} [assets] - its pictures and files.
 * @property {boolean} [replaceAssets] - true when the files are the whole set (what the page removed must not come back).
 * @property {string} [into] - the id of the document to replace (the page's document).
 * @property {boolean} [asNew] - true to always make a new document.
 * @property {string} [page] - the origin of the page.
 * @property {boolean} [temp] - true to keep the document in memory only.
 */

/**
 * Opens a document from a page (see the header), from the top.
 * @param {ExternalDocument} external - the document.
 * @returns {Promise<void>} settles when it is open.
 */
export async function importExternalDocument(external) {
    const { name, into, asNew, page, temp } = external;
    const entry = asNew ? null : (into && store.getEntry(into)) || store.list().find(item => item.name === name && item.page && item.page === page && !!item.temp === !!temp);
    if (entry) await setPageDocument(entry, external);
    else addPageDocument(external);
    ui.ta.setSelectionRange(0, 0);
    ui.ta.scrollTop = 0;
    ui.scroller.scrollTop = 0;
}

/**
 * Puts a page's document into the document that came from the page before: its files as sent
 * (all of them, or added to the others), its code as one undo step.
 * @param {import('./files.js').FileEntry} entry - the document from the page.
 * @param {ExternalDocument} external - the document.
 * @returns {Promise<void>} settles when it is open.
 */
async function setPageDocument(entry, external) {
    const { content, assets: files, replaceAssets } = external;
    if (replaceAssets) await assets.set(entry.id, { ...(files || {}) });
    else if (files && Object.keys(files).length) await assets.set(entry.id, { ...(await assets.get(entry.id)), ...files });
    if (entry.id !== state.fileId) openDocument(entry.id);
    state.assets = await assets.get(entry.id);
    renderInsertPanel();
    if (content !== state.code) setCode(content); else startCompile();
}

/**
 * Makes a new document of a page's document, in memory only when the page asks so, and notes
 * the page it came from.
 * @param {ExternalDocument} external - the document.
 * @returns {void}
 */
function addPageDocument(external) {
    const { name, content, assets: files, page, temp } = external;
    const id = openNewDocument(name, content, files, !!temp);
    if (id && page) try { store.setEntryFields(id, { page }); } catch (e) { /* storage full: it just is not recognized next time */ }
    if (!id || !files) return;
    state.assets = files;
    renderInsertPanel();
    startCompile();
}
