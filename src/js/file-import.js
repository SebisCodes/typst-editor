/**
 * Opening files: with the Open button, by dropping them on the editor and by pasting. .typ
 * files become new documents, a ZIP with a .typ and its files becomes one document (zip-read.js),
 * pictures and data files go into the open document. A picture dropped on the code goes where
 * it was dropped; dropped on the Pictures tab, a .typ file is a file of the document. A pasted
 * picture becomes a picture of the open document.
 */

import { state, ui, TYPING_FIELDS, DEFAULT_NAME, showToast } from './state.js?v=3';
import { startCompile } from './compile.js?v=7';
import { openNewDocument } from './documents.js?v=7';
import { ACCEPTED_FILES, addDocumentFile } from './document-files.js?v=7';
import { renderInsertPanel } from './insert-panel.js?v=7';
import { readZipDocument } from './zip-read.js?v=7';

/** The largest .typ file opened as a document, in bytes. */
const MAX_DOCUMENT_SIZE = 8 * 1024 * 1024;
/** The name the browser gives a pasted picture without one. */
const PASTED_PICTURE_NAME = 'image.png';
let dragDepth = 0;

/**
 * Opens files: .typ files (and plain text files that are no data files) as new documents,
 * ZIPs as documents with their files, the rest as files of the open document (one picture alone
 * also at the cursor).
 * @param {File[]} list - the files.
 * @returns {Promise<void>} settles when all are opened.
 */
export async function openFiles(list) {
    const zips = list.filter(file => /\.zip$/i.test(file.name));
    const documents = list.filter(file => /\.typ$/i.test(file.name) || (!zips.includes(file) && /^text\/plain$/.test(file.type) && !ACCEPTED_FILES.test(file.name)));
    const rest = list.filter(file => !zips.includes(file) && !documents.includes(file));
    for (const file of documents) {
        if (file.size > MAX_DOCUMENT_SIZE) { showToast('The file is larger than 8 MB'); continue; }
        const code = await file.text();
        if (openNewDocument(file.name.replace(/\.[^.]+$/, '') || DEFAULT_NAME, code)) showToast(`Opened "${file.name}" - it is now in "My documents"`);
    }
    for (const zip of zips) await openZip(zip);
    for (const file of rest) await addDocumentFile(file, rest.length === 1 && !documents.length);
}

/**
 * Opens a ZIP with a .typ file and its pictures and files as one new document; a ZIP that
 * cannot be read is reported with the reason.
 * @param {File} file - the ZIP file.
 * @returns {Promise<void>} settles when it is open or reported.
 */
async function openZip(file) {
    try {
        const zipDocument = await readZipDocument(file);
        const count = Object.keys(zipDocument.files).length;
        if (!openNewDocument(zipDocument.name || file.name.replace(/\.zip$/i, ''), zipDocument.code, zipDocument.files)) return;
        state.assets = zipDocument.files;
        renderInsertPanel();
        startCompile();
        showToast(`Opened "${file.name}" with ${count} ${count === 1 ? 'file' : 'files'}`);
    } catch (e) { showToast(`"${file.name}" could not be opened: ${e.message}`); }
}

/**
 * Opens the files dropped on the editor (a drop handler): a picture dropped on the code goes
 * where it was dropped, files dropped on the Pictures tab are files of the document.
 * @param {DragEvent} event - the drop.
 * @returns {void}
 */
function openDroppedFiles(event) {
    dragDepth = 0;
    document.body.classList.remove('drop');
    const files = [...event.dataTransfer.files];
    if (!files.length) return;
    event.preventDefault();
    if (event.target === ui.ta && document.caretPositionFromPoint) {
        const caret = document.caretPositionFromPoint(event.clientX, event.clientY);
        if (caret && caret.offsetNode === ui.ta) ui.ta.setSelectionRange(caret.offset, caret.offset);
        ui.ta.focus({ preventScroll: true });
    }
    if (event.target.closest && event.target.closest('#pics-wrap')) { addFilesInOrder(files); return; }
    openFiles(files);
}

/**
 * Adds files to the open document one after the other.
 * @param {File[]} files - the files.
 * @returns {Promise<void>} settles when all are stored.
 */
async function addFilesInOrder(files) {
    for (const file of files) await addDocumentFile(file, false);
}

/**
 * Adds a pasted picture to the open document (a paste handler): at the cursor when the code
 * has the focus; not while another field has it.
 * @param {ClipboardEvent} event - the paste.
 * @returns {void}
 */
function addPastedPicture(event) {
    const active = document.activeElement;
    const file = [...(event.clipboardData?.files || [])].find(item => /^image\//.test(item.type));
    if (!file || !(active === ui.ta || !(active && active.matches(TYPING_FIELDS)))) return;
    event.preventDefault();
    const extension = file.type.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    addDocumentFile(new File([file], file.name && file.name !== PASTED_PICTURE_NAME ? file.name : `picture.${extension}`, { type: file.type }), active === ui.ta);
}

/**
 * Asks for files to open.
 * @returns {void}
 */
export function showOpenPicker() {
    document.getElementById('file').click();
}

/**
 * Connects the Open button and its file input.
 * @returns {void}
 */
export function startOpenButton() {
    const input = document.getElementById('file');
    document.getElementById('btn-open').addEventListener('click', showOpenPicker);
    input.addEventListener('change', async () => { await openFiles([...input.files]); input.value = ''; });
}

/**
 * Connects dropping files on the editor (the page shows where they can go) and pasting pictures.
 * @returns {void}
 */
export function startFileImport() {
    window.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('drop'); event.preventDefault(); } });
    window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drop'); } });
    window.addEventListener('drop', openDroppedFiles);
    window.addEventListener('paste', addPastedPicture);
}
