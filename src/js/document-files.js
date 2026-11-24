/**
 * The pictures and files of the open document: their kinds, what Insert puts into the code for
 * each, adding a file (dropped, pasted or chosen) and renaming one with the code's references.
 *
 * Pictures (PNG, JPG, GIF, WebP, SVG, PDF) are for image("name"), data files (CSV, JSON, YAML,
 * TOML, XML, TXT, CBOR) for csv("name") and the like, .bib (and .yml) files for
 * bibliography("name"), other .typ files for #import "name.typ", fonts for #set text(font: …).
 * A file added while another document is opened stays with the document it was added to.
 */

import { formatString } from './typst-rules.js?v=3';
import { findFileReferences } from './typst-code.js?v=3';
import { store } from './files.js?v=10';
import { assets, getFreeName, readAsDataUrl } from './assets.js?v=6';
import { state, areas, showToast } from './state.js?v=3';
import { setCode } from './history.js?v=5';
import { startCompile } from './compile.js?v=5';
import { addSnippet } from './code-insert.js?v=5';
import { renderInsertPanel } from './insert-panel.js?v=5';
import { renderFilesTab } from './files-tab.js?v=5';

/** The media type of a file by its extension. */
export const FILE_TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf',
    csv: 'text/csv', json: 'application/json', yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', xml: 'text/xml', txt: 'text/plain', bib: 'text/plain', typ: 'text/plain',
    cbor: 'application/cbor', otf: 'font/otf', ttf: 'font/ttf', ttc: 'font/collection',
};
/** The files a document can keep, by name. */
export const ACCEPTED_FILES = /\.(png|jpe?g|gif|webp|svg|pdf|csv|json|ya?ml|toml|xml|txt|bib|typ|cbor|otf|ttf|ttc)$/i;
/** The pictures a document can keep, by media type (a pasted picture may have no name). */
const ACCEPTED_PICTURE_TYPES = /^image\/(png|jpeg|gif|webp|svg\+xml)$/;
/** The largest file a document keeps, in bytes. */
const MAX_FILE_SIZE = 12 * 1024 * 1024;
const DEFAULT_FILE_NAME = 'picture.png';
/** The name of the compiled code: a file of this name is stored as module.typ. */
const MAIN_FILE = 'main.typ';
const MODULE_FILE = 'module.typ';

/**
 * Returns the extension of a file name.
 * @param {string} name - the file name.
 * @returns {string} the extension in lower case, "" without one.
 */
export function getExtension(name) {
    return (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase() || '';
}

/**
 * Returns what kind of file a name is.
 * @param {string} name - the file name.
 * @returns {string} "image", "pdf", "font", "typ", "bib", "data" or "other".
 */
export function getFileKind(name) {
    const extension = getExtension(name);
    if (/^(png|jpe?g|gif|webp|svg)$/.test(extension)) return 'image';
    if (extension === 'pdf') return 'pdf';
    if (/^(otf|ttf|ttc)$/.test(extension)) return 'font';
    if (extension === 'typ') return 'typ';
    if (/^(bib|yml)$/.test(extension)) return 'bib';
    if (/^(csv|json|yaml|toml|xml|txt|cbor)$/.test(extension)) return 'data';
    return 'other';
}

/**
 * Tells whether a name in the code means a file (without "./" or "/" at its start, ignoring case).
 * @param {string} reference - the name in the code.
 * @param {string} name - the file's name.
 * @returns {boolean} true when it means the file.
 */
export function isReferenceTo(reference, name) {
    return reference.replace(/^\.?\//, '').toLowerCase() === name.toLowerCase();
}

/**
 * Returns what "Insert" puts into the code for a file, with "|" for the cursor.
 * @param {string} name - the file's name.
 * @returns {string|null} the code, null for a file the code cannot use by itself (a font).
 */
export function getInsertCode(name) {
    const kind = getFileKind(name), extension = getExtension(name);
    if (kind === 'image' || kind === 'pdf') return `#image(${formatString(name)}, width: 50%)|`;
    if (extension === 'csv') return `#table(columns: 2, ..csv(${formatString(name)}).flatten())|`;
    if (extension === 'bib') return `#bibliography(${formatString(name)})|`;
    if (extension === 'typ') return `#import ${formatString(name)}: *|`;
    if (kind === 'data') return `#let data = ${extension === 'txt' ? 'read' : extension}(${formatString(name)})|`;
    return null;
}

/**
 * Stores a picture or file with the open document and compiles again.
 * @param {File} file - the file.
 * @param {boolean} [insert] - true to add its code at the cursor.
 * @param {string} [as] - the name to store it under (replacing that file, or one the code asks for).
 * @returns {Promise<void>} settles when it is stored.
 */
export async function addDocumentFile(file, insert, as) {
    const id = state.fileId;
    if (!ACCEPTED_FILES.test(file.name || '') && !ACCEPTED_PICTURE_TYPES.test(file.type)) { showToast('Pictures can be PNG, JPG, GIF, WebP, SVG or PDF; files CSV, JSON, YAML, TOML, XML, TXT, BIB, Typst or fonts'); return; }
    if (file.size > MAX_FILE_SIZE) { showToast('The file is larger than 12 MB'); return; }
    const typed = file.type ? file : new File([file], file.name, { type: FILE_TYPES[getExtension(file.name)] || 'application/octet-stream' });
    const dataUrl = await readAsDataUrl(typed);
    const known = state.fileId === id ? state.assets : assets.getCached(id);
    let name = as || getFreeName(known, (file.name || DEFAULT_FILE_NAME).toLowerCase());
    if (name === MAIN_FILE) name = getFreeName(known, MODULE_FILE);
    const files = await assets.add(id, name, dataUrl);
    if (state.fileId !== id) return;
    state.assets = files;
    renderInsertPanel();
    renderFilesTab();
    if (insert && getInsertCode(name)) addSnippet(getInsertCode(name), false);
    startCompile();
    showToast(as ? `"${name}" now has the new file` : `"${name}" added to "${state.name}"`);
    areas.sync?.handleChange();
}

/**
 * Gives a file a new name (a free one, with the old extension when the new name has none); the
 * code's references follow as one undo step, and Undo / Redo rename the file back and forth with
 * the code. When another document was opened meanwhile, only the document the rename started on
 * changes.
 * @param {string} oldName - the file's name.
 * @param {string} wanted - the new name as typed.
 * @returns {Promise<void>} settles when the file is renamed.
 */
export async function renameDocumentFile(oldName, wanted) {
    const others = { ...state.assets };
    delete others[oldName];
    let typed = wanted.trim();
    if (!/\.[a-z0-9]+$/i.test(typed)) typed += (/(\.[a-z0-9]+)$/i.exec(oldName) || ['', ''])[1];
    const name = getFreeName(others, typed);
    if (name === oldName) { renderFilesTab(); return; }
    const files = {};
    for (const [fileName, dataUrl] of Object.entries(state.assets)) files[fileName === oldName ? name : fileName] = dataUrl;
    const id = state.fileId, startCode = state.code;
    let code = startCode;
    for (const reference of findFileReferences(state.code).filter(item => isReferenceTo(item.name, oldName)).reverse()) code = code.slice(0, reference.nameAt) + name + code.slice(reference.nameAt + reference.len);
    await assets.set(id, files);
    if (state.fileId !== id) {
        if (code !== startCode) try { store.save(id, { code }); } catch (e) { /* storage full */ }
        return;
    }
    state.assets = files;
    if (code !== state.code) {
        setCode(code);
        state.history[state.history.length - 1].rename = [oldName, name];
    } else startCompile();
    renderFilesTab();
    areas.sync?.handleChange();
    showToast(`"${oldName}" is now "${name}"`);
}
