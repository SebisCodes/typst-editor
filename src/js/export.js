/**
 * What the pages export as: the PDF straight from the compiler (real text, selectable), each
 * page as SVG (with its glyphs, without the text layer used for selecting) or drawn on a canvas
 * (PNG, JPG, WebP on white paper), the .typ with its files as ZIP, and printing the pages.
 */

import { createZip } from './zip.js?v=4';
import { getDataUrlBytes } from './assets.js?v=6';
import { state, ui, areas, PIXELS_PER_POINT, showToast } from './state.js?v=2';
import { getCurrentPage } from './zoom.js?v=3';

/** The quality of JPG and WebP pictures. */
const PICTURE_QUALITY = 0.92;
/** The color of the paper under a page drawn as a picture. */
const PAPER_COLOR = '#ffffff';
const NO_PAGES = 'This document has no pages yet - fix the problems above the code first';
/** How long printing waits for the layer to be drawn, and to clean up after, in milliseconds. */
const PRINT_DELAY = 50;
const PRINT_CLEANUP_DELAY = 500;
const PAGE_NUMBER_DIGITS = 2;

/**
 * A file of an export.
 * @typedef {object} ExportFile
 * @property {string} name - its name.
 * @property {string|Blob|Uint8Array} data - its content.
 */

/**
 * Returns one page as a standalone SVG file: the shared definitions inside, without the text
 * layer used for selecting.
 * @param {number} index - the page's index.
 * @returns {string} the SVG.
 */
export function getPageSvg(index) {
    const page = state.pages[index], size = state.sizes[index];
    const group = page.querySelector('.typst-page').cloneNode(true);
    group.querySelectorAll('foreignObject').forEach(element => element.remove());
    group.querySelectorAll('.typst-text').forEach(element => element.style.removeProperty('visibility'));   // the text being edited on the page
    const inner = new XMLSerializer().serializeToString(group);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size.w}pt" height="${size.h}pt" viewBox="0 0 ${size.w} ${size.h}"><style>svg { fill: none; }</style>${state.defs.replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '')}${inner}</svg>`;
}

/**
 * Draws one page on a canvas on white paper.
 * @param {number} index - the page's index.
 * @param {number} scale - the scale, 1 for 96 dpi.
 * @returns {Promise<HTMLCanvasElement>} the canvas.
 * @throws {Error} when the page cannot be drawn (the Promise rejects).
 */
export function drawPageCanvas(index, scale) {
    const size = state.sizes[index];
    const width = Math.round(size.w * PIXELS_PER_POINT * scale), height = Math.round(size.h * PIXELS_PER_POINT * scale);
    const svg = getPageSvg(index).replace(/width="[^"]*pt" height="[^"]*pt"/, `width="${width}" height="${height}"`);
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        image.addEventListener('load', () => { const canvas = createPaperCanvas(image, width, height); URL.revokeObjectURL(url); resolve(canvas); });
        image.addEventListener('error', () => { URL.revokeObjectURL(url); reject(new Error('The page could not be drawn')); });
        image.src = url;
    });
}

/**
 * Creates a canvas with a loaded picture of a page drawn on paper.
 * @param {HTMLImageElement} image - the loaded picture of the page.
 * @param {number} width - the canvas width in pixels.
 * @param {number} height - the canvas height in pixels.
 * @returns {HTMLCanvasElement} the canvas.
 */
function createPaperCanvas(image, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.fillStyle = PAPER_COLOR;
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
}

/**
 * Returns a canvas as a picture file.
 * @param {HTMLCanvasElement} canvas - the canvas.
 * @param {string} type - the media type.
 * @param {number} [quality] - the quality of JPG and WebP.
 * @returns {Promise<Blob>} the picture.
 */
export function getCanvasBlob(canvas, type, quality = PICTURE_QUALITY) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

/**
 * Returns the pages as pictures. Only pages of the open document go out (another document's
 * stay on screen until this one compiles).
 * @param {string} type - "svg" or the media type of a picture ("image/png", "image/jpeg", "image/webp").
 * @param {string} which - "all" for every page, else the page in view.
 * @param {number} scale - the scale of the pictures, 1 for 96 dpi.
 * @param {string} baseName - the file name without extension.
 * @returns {Promise<ExportFile[]>} the pictures, numbered when there are several pages.
 * @throws {Error} when the document has no pages (the Promise rejects).
 */
export async function getPagePictures(type, which, scale, baseName) {
    if (state.pagesFileId !== state.fileId || !state.pages.length) throw new Error(NO_PAGES);
    const extension = type === 'svg' ? 'svg' : type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
    const indexes = which === 'all' ? state.pages.map((page, index) => index) : [getCurrentPage()];
    const pictures = [];
    for (const index of indexes) {
        const name = which === 'all' && state.pages.length > 1 ? `${baseName}-${String(index + 1).padStart(PAGE_NUMBER_DIGITS, '0')}.${extension}` : `${baseName}.${extension}`;
        pictures.push({ name, data: type === 'svg' ? getPageSvg(index) : await getCanvasBlob(await drawPageCanvas(index, scale), type) });
    }
    return pictures;
}

/**
 * Makes the PDF from the Typst compiler (real text, selectable). A command that returns a
 * Promise so the caller can wait for the PDF; its shape is what sync.js asks for.
 * @returns {Promise<{pdf: Uint8Array, pages: number}>} the PDF and the number of pages.
 * @throws {Error} when the code has errors (the Promise rejects).
 */
export async function exportPdf() {
    const pdf = await areas.compiler.exportPdf(state.code, state.assets, state.fileId);
    return { pdf, pages: state.pages.length };
}

/**
 * Prints the pages: they go into a layer of their own, with the paper size of the first page,
 * and the browser's print dialog opens.
 * @returns {void}
 */
export function showPrintDialog() {
    if (!state.pages.length || state.pagesFileId !== state.fileId) { showToast(NO_PAGES); return; }
    const size = state.sizes[0];
    const layer = document.createElement('div');
    layer.id = 'print';
    layer.innerHTML = `<style>@page { size: ${size.w}pt ${size.h}pt; margin: 0; }</style>`;
    layer.append(ui.pages.querySelector('.typst-defs').cloneNode(true));
    state.pages.forEach((page, index) => layer.append(createPrintPage(page, index)));
    document.body.append(layer);
    document.documentElement.classList.add('printing');
    /**
     * Removes the layer once printing is done.
     * @returns {void}
     */
    const removeLayer = () => { layer.remove(); document.documentElement.classList.remove('printing'); removeEventListener('afterprint', removeLayer); };
    addEventListener('afterprint', removeLayer);
    setTimeout(() => { window.print(); setTimeout(removeLayer, PRINT_CLEANUP_DELAY); }, PRINT_DELAY);
}

/**
 * Creates a page for printing: without the frame and the field of an edit, the text being
 * edited shown, at its size in points.
 * @param {HTMLElement} page - the page.
 * @param {number} index - its index.
 * @returns {HTMLElement} the copy.
 */
function createPrintPage(page, index) {
    const copy = page.cloneNode(true);
    copy.querySelectorAll('.source, .text-in-place').forEach(element => element.remove());
    copy.querySelectorAll('.typst-text').forEach(element => element.style.removeProperty('visibility'));   // the text being edited on the page
    copy.style.width = state.sizes[index].w + 'pt';
    copy.style.height = state.sizes[index].h + 'pt';
    return copy;
}

/**
 * Creates a ZIP of the .typ with the document's pictures and files.
 * @param {string} baseName - the name of the .typ without extension.
 * @returns {Promise<Blob>} the ZIP.
 */
export function createTypZip(baseName) {
    return createZip([{ name: `${baseName}.typ`, data: state.code }, ...getFileEntries()]);
}

/**
 * Returns the document's pictures and files as files of a ZIP.
 * @returns {ExportFile[]} the files with their bytes.
 */
export function getFileEntries() {
    return Object.entries(state.assets).map(([name, dataUrl]) => ({ name, data: getDataUrlBytes(dataUrl) }));
}
