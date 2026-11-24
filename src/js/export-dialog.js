/**
 * The Export dialog and the download buttons of the top bar: a format (PDF, PNG, JPG, WebP,
 * SVG, .typ, .typ with its files as ZIP), the pages (all or the one in view) and the scale of
 * pictures; Download, Copy, and one ZIP with everything. Ctrl+S saves to the server or the page
 * around the editor when that is set up, else it downloads the .typ (with its files as ZIP).
 *
 * The dialog waits for the compiler before it counts the pages and before it exports. With
 * template placeholders the pictures of the pages show the template view and the PDF follows the
 * view the pages show; the dialog names the view of each.
 */

import { createZip } from './zip.js?v=4';
import { openDialog } from './dialogs.js?v=5';
import { saveFile, getSafeName } from './util.js?v=3';
import { state, ui, areas, getElement, showToast, PIXELS_PER_POINT } from './state.js?v=3';
import { waitForCompile } from './compile.js?v=6';
import { getPageSize } from './zoom.js?v=6';
import { isTextEditing, stopTextEdit } from './text-edit.js?v=6';
import { getPagePictures, exportPdf, createTypZip, getFileEntries, loadPicturePages, getPicturePagesInfo } from './export.js?v=6';
import { getViewTitle, getTemplateViewTitle } from './preview-views.js?v=1';

const PICTURE_FORMATS = /^(png|jpeg|webp|svg)$/;
const COPY_PICTURE_FORMATS = /^(png|jpeg|webp)$/;
const COPIED = 'Copied to the clipboard';

/** The elements of the dialog. */
const dialog = getElement('#export');
const nameField = getElement('#ex-name'), formatField = getElement('#ex-format'), pagesField = getElement('#ex-pages'), scaleField = getElement('#ex-scale'), textField = getElement('#ex-text'), infoField = getElement('#ex-info');

/**
 * Opens the Export dialog with the document's name, and updates it once the code is compiled and
 * the pages of the pictures are there.
 * @returns {Promise<void>} settles when the dialog shows the compiled pages.
 */
export async function openExportDialog() {
    nameField.value = state.name;
    updateExportDialog();
    openDialog(dialog);
    await waitForCompile();
    updateExportDialog();
    try { await loadPicturePages(); } catch (e) { return; }
    updateExportDialog();
}

/**
 * Returns a number of pages as text.
 * @param {number} count - the number of pages.
 * @returns {string} e.g. "2 pages", translated.
 */
function formatPageCount(count) {
    const text = `${count} ${count === 1 ? 'page' : 'pages'}`;
    return areas.i18n?.translate(text) ?? text;
}

/**
 * Returns the file name of the export: the name in the dialog, else the document's name.
 * @returns {string} the name, safe as a file name.
 */
function getExportName() {
    return getSafeName(nameField.value || state.name);
}

/**
 * Shows what the chosen format gives: the size of the pictures, the number of pages, the files
 * of a ZIP, or the code with its size; "Open in another editor" (convert-to.js) has its own row.
 * @returns {void}
 */
function updateExportDialog() {
    const format = formatField.value;
    if (format === 'convert') return;
    const isPicture = PICTURE_FORMATS.test(format);
    dialog.dataset.raster = format === 'pdf' ? 'pdf' : String(isPicture);
    dialog.dataset.vector = String(format === 'svg');
    getElement('#ex-copy').hidden = format === 'pdf' || format === 'typzip';
    if (isPicture) {
        const info = getPicturePagesInfo();
        const pages = getTemplateViewTitle(formatPageCount(info.count));
        const scale = +scaleField.value;
        const { w, h } = info.size ? { w: info.size.w * PIXELS_PER_POINT, h: info.size.h * PIXELS_PER_POINT } : getPageSize();
        getElement('#ex-size').textContent = format === 'svg' ? `${pages} as SVG (sharp at any size)` : `${Math.round(w * scale)} × ${Math.round(h * scale)} pixels per page · ${pages}`;
        infoField.textContent = '';
        return;
    }
    if (format === 'pdf') { infoField.textContent = getViewTitle(formatPageCount(state.pages.length), state.compiledCode); return; }
    if (format === 'typzip') {
        const fileCount = Object.keys(state.assets).length;
        textField.value = [`${getExportName()}.typ`, ...Object.keys(state.assets)].join('\n');
        infoField.textContent = `.typ and ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
        return;
    }
    textField.value = state.code;
    infoField.textContent = `${new Blob([state.code]).size.toLocaleString('en')} bytes`;
}

/**
 * Downloads the chosen format (the dialog's Download button), once the code is compiled; one
 * picture alone as its file, several as a ZIP.
 * @returns {Promise<void>} settles when the download starts or the error is shown.
 */
async function exportChosenFormat() {
    const format = formatField.value;
    const button = getElement('#ex-download');
    button.disabled = true;
    try {
        await waitForCompile();
        await saveChosenFormat(format);
        showToast('Downloaded');
    } catch (err) { console.error(err); showToast(err.message); } finally { button.disabled = false; }
}

/**
 * Saves a format as a file.
 * @param {string} format - "pdf", "png", "jpeg", "webp", "svg", "typzip" or "typ".
 * @returns {Promise<void>} settles when the download starts.
 * @throws {Error} when the document has no pages or the PDF cannot be made (the Promise rejects).
 */
async function saveChosenFormat(format) {
    if (format === 'pdf') { const { pdf } = await exportPdf(); saveFile(new Blob([pdf], { type: 'application/pdf' }), `${getExportName()}.pdf`); return; }
    if (PICTURE_FORMATS.test(format)) {
        const pictures = await getPagePictures(format === 'svg' ? 'svg' : 'image/' + format, pagesField.value, +scaleField.value, getExportName());
        if (pictures.length === 1) saveFile(pictures[0].data, pictures[0].name, 'image/svg+xml');
        else saveFile(await createZip(pictures), `${getExportName()}-pages.zip`);
        return;
    }
    if (format === 'typzip') { saveFile(await createTypZip(getExportName()), `${getExportName()}.zip`); return; }
    saveFile(state.code, `${getExportName()}.typ`, 'text/plain');
}

/**
 * Downloads everything as one ZIP (the dialog's ZIP button): the .typ, its files, the PDF
 * (left out when the document has errors) and every page as PNG and SVG.
 * @returns {Promise<void>} settles when the download starts or the error is shown.
 */
async function exportAllAsZip() {
    const button = getElement('#ex-zip');
    button.disabled = true;
    try {
        await waitForCompile();
        const name = getExportName();
        const pngs = await getPagePictures('image/png', 'all', +scaleField.value, getExportName());
        const svgs = await getPagePictures('svg', 'all', +scaleField.value, getExportName());
        let pdf = null;
        try { pdf = (await exportPdf()).pdf; } catch (e) { /* the document has errors: no PDF in the ZIP */ }
        const zip = await createZip([
            { name: `${name}.typ`, data: state.code },
            ...getFileEntries(),
            ...(pdf ? [{ name: `${name}.pdf`, data: pdf }] : []),
            ...pngs.map(picture => ({ name: 'pages/' + picture.name, data: picture.data })),
            ...svgs.map(picture => ({ name: 'pages/' + picture.name, data: picture.data })),
        ]);
        saveFile(zip, `${name}-all.zip`);
        showToast(`ZIP downloaded: .typ, files, PDF and ${pngs.length} ${pngs.length === 1 ? 'page' : 'pages'} as PNG and SVG`);
    } catch (err) { console.error(err); showToast(err.message); } finally { button.disabled = false; }
}

/**
 * Copies the chosen format (the dialog's Copy button): the picture of the page in view as PNG or SVG, or the
 * text; where the clipboard is not allowed, the .typ is copied from the field.
 * @returns {Promise<void>} settles when it is copied or the error is shown.
 */
async function copyChosenFormat() {
    const format = formatField.value;
    try {
        // The clipboard is written within the click; the picture follows as a promise of the item.
        if (COPY_PICTURE_FORMATS.test(format)) {
            const picture = getPagePictures('image/png', 'current', +scaleField.value, getExportName()).then(pictures => pictures[0].data);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': picture })]);
        } else if (format === 'svg') {
            const svg = getPagePictures('svg', 'current', 1, getExportName()).then(pictures => new Blob([pictures[0].data], { type: 'text/plain' }));
            await navigator.clipboard.write([new ClipboardItem({ 'text/plain': svg })]);
        } else await navigator.clipboard.writeText(textField.value);
        showToast(COPIED);
    } catch (err) {
        if (format === 'typ') { textField.select(); document.execCommand('copy'); showToast(COPIED); }
        else showToast('This browser does not allow copying this');
    }
}

/**
 * Copies the code (the Copy button of the code view).
 * @returns {Promise<void>} settles when it is copied.
 */
async function copyCode() {
    try { await navigator.clipboard.writeText(state.code); } catch (e) { ui.ta.select(); document.execCommand('copy'); }
    showToast('Code copied');
}

/**
 * Downloads the .typ, or a ZIP with its pictures and files when it has any; the dialog's name
 * becomes the document's name.
 * @returns {void}
 */
export function saveTypFile() {
    nameField.value = state.name;
    if (Object.keys(state.assets).length) createTypZip(getExportName()).then(zip => { saveFile(zip, `${getSafeName(state.name)}.zip`); showToast('.typ with its files downloaded (ZIP)'); });
    else { saveFile(state.code, `${getSafeName(state.name)}.typ`, 'text/plain'); showToast('.typ downloaded'); }
}

/**
 * Saves on Ctrl+S: text being edited on the page goes into the code first; then to the server
 * or the page around the editor when set up, otherwise a download.
 * @returns {void}
 */
export function saveOnShortcut() {
    if (isTextEditing()) stopTextEdit(true);
    if (areas.sync && areas.sync.isActive()) { areas.sync.save(); return; }
    saveTypFile();
}

/**
 * Connects the Export dialog and the Export, Copy and Download buttons.
 * @returns {void}
 */
export function startExportDialog() {
    formatField.addEventListener('change', updateExportDialog);
    scaleField.addEventListener('change', updateExportDialog);
    pagesField.addEventListener('change', updateExportDialog);
    nameField.addEventListener('input', updateExportDialog);
    getElement('#ex-download').addEventListener('click', exportChosenFormat);
    getElement('#ex-zip').addEventListener('click', exportAllAsZip);
    getElement('#ex-copy').addEventListener('click', copyChosenFormat);
    getElement('#btn-export').addEventListener('click', openExportDialog);
    getElement('#btn-copy').addEventListener('click', copyCode);
    getElement('#btn-download').addEventListener('click', () => saveTypFile());
}
