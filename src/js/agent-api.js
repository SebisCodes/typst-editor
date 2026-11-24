/**
 * What the AI prompt (ai.js) and the WebMCP tools (mcp.js) get from the editor: the document as
 * they see it, its problems and headings, the user's documents, and the changes the tools make
 * (each an undo step).
 */

import { store } from './files.js?v=10';
import { BLANK } from './samples.js?v=3';
import { state, ui, AI_DOCUMENT_NAME, areas } from './state.js?v=3';
import { setCode } from './history.js?v=5';
import { waitForCompile } from './compile.js?v=5';
import { getLineIndex, getLineStartPlace, showCodePosition } from './code-view.js?v=5';
import { showSourceMark } from './source-mark.js?v=5';
import { openDocument, openNewDocument } from './documents.js?v=5';


/**
 * Returns the document as the prompt and the agent see it.
 * @returns {{code: string, name: string, files: string[], pictures: string[], sel: string, problems: string[], context: object|null}}
 *   the code, its name, the names of all documents and of its files, the selected code, the
 *   problems with their lines and what the page that holds the document says.
 */
export function getPromptState() {
    return {
        code: state.code, name: state.name, files: store.getSortedEntries().map(entry => entry.name), pictures: Object.keys(state.assets),
        sel: state.code.slice(ui.ta.selectionStart, ui.ta.selectionEnd),
        problems: state.problems.map(problem => `line ${problem.line}: ${problem.msg}`),
        context: areas.sync?.getContext() || null,
    };
}

/**
 * Returns the compiler's problems for the code as it is, with their hints and lines. A command
 * that returns a Promise: it waits for the compiler.
 * @returns {Promise<Array<{kind: string, msg: string, line: number}>>} the problems.
 */
export async function getProblemList() {
    await waitForCompile();
    return state.problems.map(problem => ({ kind: problem.kind, msg: problem.msg + (problem.hints.length ? ' (hint: ' + problem.hints.join('; ') + ')' : ''), line: problem.line }));
}

/**
 * Returns the headings with their line numbers.
 * @returns {Array<{level: number, title: string, pos: number, line: number}>} the headings.
 */
export function getOutlineList() {
    return state.outline.map(heading => ({ ...heading, line: getLineIndex(heading.pos) + 1 }));
}

/**
 * Returns the user's documents, the most recently changed first.
 * @returns {Array<{name: string, updated: number, open: boolean}>} the documents.
 */
export function getFileList() {
    return store.getSortedEntries().map(entry => ({ name: entry.name, updated: entry.updated, open: entry.id === state.fileId }));
}

/**
 * Opens a document by name. A command that returns whether it took place.
 * @param {string} name - the document's name.
 * @returns {boolean} true when the document exists (it is open then).
 */
export function openFileByName(name) {
    const entry = store.findByName(name);
    if (entry && entry.id !== state.fileId) openDocument(entry.id);
    return !!entry;
}

/**
 * Makes and opens a new document. A command that returns the name it got.
 * @param {string} name - the wanted name.
 * @param {string} [code] - its code; an empty A4 page when left out.
 * @returns {string|null|false} the document's name, null or false when the storage is full.
 */
export function createFile(name, code) {
    return openNewDocument(name || AI_DOCUMENT_NAME, code || BLANK) && state.name;
}

/**
 * Adds Typst code at the end, at the cursor, or on the line after the heading with the given
 * title (ignoring case and spaces around it). A command that returns whether it took place.
 * @param {string} text - the code to add.
 * @param {string} where - "end", "cursor", or a heading's title.
 * @returns {boolean} false when there is no such heading.
 */
export function addCode(text, where) {
    const at = getAddPlace(where);
    if (at == null) return false;
    const before = state.code.slice(0, at);
    setCode(before + (where === 'end' && before && !/\n$/.test(before) ? '\n' : '') + text.replace(/\s*$/, '\n') + state.code.slice(at));
    return true;
}

/**
 * Returns where addCode() adds: the cursor, the end, or the start of the line after a heading.
 * @param {string} where - "end", "cursor", or a heading's title.
 * @returns {number|null} the place, null when there is no such heading.
 */
function getAddPlace(where) {
    if (where === 'cursor') return ui.ta.selectionStart;
    if (where === 'end') return state.code.length;
    const heading = state.outline.find(item => item.title.trim().toLowerCase() === where.trim().toLowerCase());
    if (!heading) return null;
    const lineEnd = state.code.indexOf('\n', heading.pos);
    return lineEnd < 0 ? state.code.length : lineEnd + 1;
}

/**
 * Replaces an exact piece of the code, the first match or every match. The work of the WebMCP
 * tool replace_text: it returns the count of changes the tool reports to the agent.
 * @param {string} find - the text.
 * @param {string} replacement - the new text.
 * @param {boolean} all - true for every match.
 * @returns {number} how many matches were replaced, 0 for none.
 */
export function updateText(find, replacement, all) {
    if (!find) return 0;
    const count = state.code.split(find).length - 1;
    if (!count) return 0;
    setCode(all ? state.code.split(find).join(replacement) : state.code.replace(find, () => replacement));
    return all ? count : 1;
}

/**
 * Puts the cursor at the start of a line and frames its text on the page.
 * @param {number} lineNumber - the line, 1-based.
 * @returns {void}
 */
export function showLine(lineNumber) {
    showCodePosition(getLineStartPlace(lineNumber));
    showSourceMark(true, true);
}
