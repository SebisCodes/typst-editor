/**
 * The Pictures tab: the pictures and files of the open document with their size, where the
 * code uses them, the files the code asks for but that are missing ("Add file…"), and for each
 * file Insert, As figure, Rename (the references follow, one undo step), Replace, Download and
 * Remove.
 */

import { escapeHtml } from './typst.js?v=8';
import { findFileReferences } from './typst-code.js?v=3';
import { formatString } from './typst-rules.js?v=3';
import { assets, getDataUrlBytes } from './assets.js?v=6';
import { openConfirmation } from './dialogs.js?v=5';
import { saveFile } from './util.js?v=3';
import { state, ui, areas, NARROW_SCREEN } from './state.js?v=3';
import { showCodePosition } from './code-view.js?v=6';
import { startCompile } from './compile.js?v=6';
import { addSnippet } from './code-insert.js?v=6';
import { getExtension, getFileKind, isReferenceTo, getInsertCode, addDocumentFile, renameDocumentFile } from './document-files.js?v=6';
import { showPane } from './layout.js?v=6';
import { hasTemplatePlaceholder } from './template-tags.js?v=2';
import { TEMPLATE_SYNTAX } from './typst-template.js?v=1';

const KILOBYTE = 1024;
const MEGABYTE = 1024 * 1024;
/** What the file picker offers. */
const PICKER_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,.csv,.json,.yaml,.yml,.toml,.xml,.txt,.bib,.typ,.cbor,.otf,.ttf,.ttc';
/** The size in pixels of each picture once it has loaded: "name|length" -> "640 × 480 px". */
const pictureSizes = {};
const filePicker = createFilePicker();

/**
 * Creates the file input of the tab: several files to add, or one file for a name.
 * @returns {HTMLInputElement} the input, not on the page.
 */
function createFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = PICKER_TYPES;
    input.multiple = true;
    return input;
}

/**
 * Returns a size in kilobytes or megabytes.
 * @param {number} bytes - the size.
 * @returns {string} "12 KB" (at least 1 KB) or "1.5 MB".
 */
function formatSize(bytes) {
    return bytes < MEGABYTE ? `${Math.max(1, Math.round(bytes / KILOBYTE))} KB` : `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

/**
 * Returns the badge a file that is no picture shows in place of a preview.
 * @param {string} name - the file's name.
 * @returns {string} "PDF", "Font", "Typst", "BIB" or the extension.
 */
function getBadge(name) {
    return ({ pdf: 'PDF', font: 'Font', typ: 'Typst', data: getExtension(name).toUpperCase(), bib: 'BIB', other: getExtension(name).toUpperCase() || 'File' })[getFileKind(name)];
}

/**
 * Tells whether a file the code reads is missing in the document. With a template syntax a file
 * name that holds a placeholder is filled in later and counts as there.
 * @param {import('./typst-code.js').FileReference} reference - the file the code reads.
 * @param {Array<[string, string]>} files - the document's files: [name, data URI].
 * @returns {boolean} true when the file is missing.
 */
function isMissingReference(reference, files) {
    if (!reference.name || /^https?:/.test(reference.name)) return false;
    if (TEMPLATE_SYNTAX && hasTemplatePlaceholder(reference.name)) return false;
    return !files.some(([name]) => isReferenceTo(reference.name, name));
}

/**
 * Draws the Pictures tab: the header with the count and size, the hints, the missing files and
 * a card per file; the sizes of the pictures in pixels follow once they have loaded.
 * @returns {void}
 */
export function renderFilesTab() {
    const box = ui.pictures;
    const files = Object.entries(state.assets);
    const references = findFileReferences(state.code);
    const missing = [...new Set(references.filter(reference => isMissingReference(reference, files)).map(reference => reference.name))];
    const total = files.reduce((sum, [, dataUrl]) => sum + getDataUrlBytes(dataUrl).length, 0);
    box.innerHTML = `
        <div class="picture-header"><button type="button" class="button primary" id="pic-add">Add pictures or files…</button>
            <span class="muted">${files.length ? `${files.length} ${files.length === 1 ? 'file' : 'files'} · ${formatSize(total)}` : 'No pictures or files yet'}</span></div>
        <p class="hint">Pictures and files belong to “<span data-no-i18n>${escapeHtml(state.name)}</span>” and stay in your browser.</p>
        <p class="hint">Drop or paste pictures anywhere in the editor, or add them here: <code>image("name")</code> shows a picture, <code>csv</code>, <code>json</code>, <code>read</code> or <code>bibliography</code> read data files, fonts (.otf, .ttf) work with <code>#set text(font: …)</code>.</p>
        ${missing.length ? `<div class="missing-pictures"><h3>Missing in this document</h3><ul>${missing.map(name => `<li><code data-no-i18n>${escapeHtml(name)}</code><button type="button" class="button small" data-pic-fill="${escapeHtml(name)}" title="Choose the file for ${escapeHtml(name)}">Add file…</button></li>`).join('')}</ul></div>` : ''}
        <ul class="picture-gallery">${files.map(([name, dataUrl]) => formatFileCard(name, dataUrl, references)).join('')}</ul>`;
    box.querySelectorAll('img[data-dim]').forEach(showPictureSize);
}

/**
 * Returns the card of a file: its preview (or badge), name, size, where it is used, and its buttons.
 * @param {string} name - the file's name.
 * @param {string} dataUrl - its content.
 * @param {import('./typst-code.js').FileReference[]} references - the files the code reads.
 * @returns {string} the HTML of the card.
 */
function formatFileCard(name, dataUrl, references) {
    const used = references.filter(reference => isReferenceTo(reference.name, name)).length;
    const size = pictureSizes[name + '|' + dataUrl.length];
    const kind = getFileKind(name);
    const insertCode = getInsertCode(name);
    return `<li class="picture-card" data-name="${escapeHtml(name)}">
                <button type="button" class="picture-preview" ${insertCode ? `data-pic="${escapeHtml(name)}" title="Insert it at the cursor"` : 'disabled'}>${kind === 'image' ? `<img alt="" src="${escapeHtml(dataUrl)}" data-dim="${escapeHtml(name + '|' + dataUrl.length)}">` : `<span class="picture-pdf" data-no-i18n>${escapeHtml(getBadge(name))}</span>`}</button>
                <div class="picture-info"><code class="picture-title" title="${escapeHtml(name)}" data-no-i18n>${escapeHtml(name)}</code>
                    <small>${size ? size + ' · ' : ''}${formatSize(getDataUrlBytes(dataUrl).length)} · ${used ? `<button type="button" class="link-button" data-pic-show="${escapeHtml(name)}" title="Show where it is used">used ${used}×</button>` : kind === 'font' ? 'a font of the document' : 'not used yet'}</small></div>
                <div class="picture-actions">
                    ${insertCode ? `<button type="button" class="button small" data-pic="${escapeHtml(name)}" title="Insert it at the cursor">Insert</button>` : ''}
                    ${kind === 'image' || kind === 'pdf' ? `<button type="button" class="button small" data-pic-fig="${escapeHtml(name)}" title="A figure with caption and label at the cursor">As figure</button>` : ''}
                    <button type="button" class="button small" data-pic-ren="${escapeHtml(name)}" title="Rename - the code is changed along">Rename</button>
                    <button type="button" class="button small" data-pic-rep="${escapeHtml(name)}" title="Choose another file, keep the name">Replace</button>
                    <button type="button" class="button small" data-pic-dl="${escapeHtml(name)}" title="Download the file">Download</button>
                    <button type="button" class="button small danger" data-pic-del="${escapeHtml(name)}" title="Remove the file from this document">Remove</button>
                </div></li>`;
}

/**
 * Shows the size in pixels of a picture once it has loaded, and remembers it.
 * @param {HTMLImageElement} image - the picture of a card.
 * @returns {void}
 */
function showPictureSize(image) {
    const key = image.dataset.dim;
    if (pictureSizes[key]) return;
    image.addEventListener('load', () => {
        pictureSizes[key] = `${image.naturalWidth} × ${image.naturalHeight} px`;
        const small = image.closest('.picture-card')?.querySelector('small');
        if (small && !small.textContent.includes(' px')) small.insertAdjacentText('afterbegin', pictureSizes[key] + ' · ');
    }, { once: true });
}

/**
 * Puts a field in place of a file's name to rename it: Enter or leaving the field renames,
 * Escape keeps the name.
 * @param {HTMLButtonElement} button - the file's Rename button.
 * @param {string} name - the file's name.
 * @returns {void}
 */
function startRename(button, name) {
    const title = button.closest('.picture-card').querySelector('.picture-title');
    const input = Object.assign(document.createElement('input'), { value: name, className: 'picture-rename', spellcheck: false });
    input.setAttribute('aria-label', 'New name');
    title.replaceWith(input);
    input.focus();
    input.setSelectionRange(0, name.replace(/\.[a-z0-9]+$/i, '').length);
    let done = false;
    /**
     * Ends the rename once.
     * @param {boolean} keep - true to rename to the typed name.
     * @returns {void}
     */
    const stopRename = keep => {
        if (done) return;
        done = true;
        if (keep && input.value.trim()) renameDocumentFile(name, input.value); else renderFilesTab();
    };
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); stopRename(true); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopRename(false); }
    });
    input.addEventListener('blur', () => stopRename(true));
}

/**
 * Removes a file from the open document after asking; the code that uses it then reports a
 * missing file.
 * @param {string} name - the file's name.
 * @returns {Promise<void>} settles when it is removed or kept.
 */
async function removeFileOnConfirm(name) {
    if (!await openConfirmation({ title: `Remove "${name}"?`, text: 'The file is removed from this document. The code that uses it then reports a missing file. "Undo" does not bring it back.', ok: 'Remove' })) return;
    const id = state.fileId;
    const left = await assets.remove(id, name);
    if (state.fileId !== id) return;
    state.assets = left;
    renderFilesTab();
    startCompile();
    areas.sync?.handleChange();
}

/**
 * Adds a figure with the picture, a caption and a label made from its name at the cursor.
 * @param {string} name - the picture's name.
 * @returns {void}
 */
function addFigure(name) {
    const label = name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-');
    addSnippet(`#figure(\n  image(${formatString(name)}, width: 70%),\n  caption: [|],\n) <fig:${label}>\n`, true);
}

/**
 * Selects where the code uses a file.
 * @param {string} name - the file's name.
 * @returns {void}
 */
function showFileUse(name) {
    const reference = findFileReferences(state.code).find(item => isReferenceTo(item.name, name));
    if (!reference) return;
    if (NARROW_SCREEN.matches) showPane('code');
    showCodePosition(reference.nameAt, true, reference.nameAt + reference.len);
}

/**
 * Runs a button of the tab (a click handler).
 * @param {MouseEvent} event - the click.
 * @returns {Promise<void>} settles when the button's action is done.
 */
async function handleTabClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const data = button.dataset;
    if (button.id === 'pic-add') { filePicker.click(); return; }
    if (data.pic) { const code = getInsertCode(data.pic); if (code) addSnippet(code, false); return; }
    if (data.picFig) { addFigure(data.picFig); return; }
    if (data.picShow) { showFileUse(data.picShow); return; }
    if (data.picRen) { startRename(button, data.picRen); return; }
    if (data.picRep || data.picFill) { filePicker.dataset.into = data.picRep || data.picFill; filePicker.multiple = false; filePicker.click(); return; }
    if (data.picDl) { saveFile(new Blob([getDataUrlBytes(state.assets[data.picDl])]), data.picDl); return; }
    if (data.picDel) await removeFileOnConfirm(data.picDel);
}

/**
 * Adds the chosen files: one file under the name it was chosen for, or several files (one of
 * them alone also at the cursor).
 * @returns {Promise<void>} settles when they are stored.
 */
async function addChosenFiles() {
    const into = filePicker.dataset.into;
    delete filePicker.dataset.into;
    filePicker.multiple = true;
    if (into && filePicker.files[0]) await addDocumentFile(filePicker.files[0], false, into);
    else for (const file of filePicker.files) await addDocumentFile(file, filePicker.files.length === 1);
    filePicker.value = '';
}

/**
 * Connects the tab; its Insert buttons keep the cursor in the code.
 * @returns {void}
 */
export function startFilesTab() {
    ui.pictures.addEventListener('mousedown', event => { if (event.target.closest('[data-pic], [data-pic-fig]')) event.preventDefault(); });
    ui.pictures.addEventListener('click', handleTabClick);
    filePicker.addEventListener('change', addChosenFiles);
}
