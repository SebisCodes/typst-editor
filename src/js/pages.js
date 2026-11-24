/**
 * The compiled pages: the renderer's SVG is cleaned (no scripts, no event attributes, links do
 * not navigate) and split into one <svg> per page; the glyphs and other shared definitions sit
 * once in a hidden <svg> the pages refer to.
 *
 * showPages() runs these steps:
 *   1. read the renderer's SVG without its scripts and event attributes, with the addresses of
 *      its links escaped as XML;
 *   2. move the shared definitions into one hidden <svg>;
 *   3. make an element of each page with its size;
 *   4. take the addresses of the links away;
 *   5. put them in place of the old pages, keeping the scroll, and zoom them.
 * createPageSet() runs steps 1 to 4 for pages kept apart from the screen (the pictures of the
 * template view, export.js).
 */

import { state, ui, PIXELS_PER_POINT } from './state.js?v=3';
import { updateZoom, updatePageLabel } from './zoom.js?v=5';
import { isTextEditing, stopTextEdit } from './text-edit.js?v=5';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
/** The size of a page the renderer gives none for: A4 in points. */
const DEFAULT_PAGE_WIDTH = 595;
const DEFAULT_PAGE_HEIGHT = 842;

/**
 * The size of a page in points.
 * @typedef {object} PageSize
 * @property {number} w - its width.
 * @property {number} h - its height.
 */

/**
 * A set of pages made from one SVG of the renderer.
 * @typedef {object} PageSet
 * @property {SVGSVGElement} definitions - the hidden <svg> with the shared definitions.
 * @property {HTMLDivElement[]} pages - one element per page.
 * @property {PageSize[]} sizes - the size of each page in points.
 * @property {string} defs - the shared definitions as SVG text.
 */

/**
 * Shows the compiled pages (the steps in the header).
 * @param {string} svgText - the renderer's SVG of all pages.
 * @param {PageSize[]} sizes - the size of each page.
 * @returns {void}
 * @throws {Error} when the renderer gave no SVG.
 */
export function showPages(svgText, sizes) {
    const pageSet = createPageSet(svgText, sizes);
    if (isTextEditing()) stopTextEdit(false);
    const scrollTop = ui.scroller.scrollTop, scrollLeft = ui.scroller.scrollLeft;
    ui.pages.replaceChildren(pageSet.definitions, ...pageSet.pages);
    state.defs = pageSet.defs;
    state.pages = pageSet.pages;
    state.pagesFileId = state.fileId;
    state.sizes = pageSet.sizes;
    updateZoom();
    ui.scroller.scrollTop = scrollTop;
    ui.scroller.scrollLeft = scrollLeft;
    updatePageLabel();
}

/**
 * Creates the elements of the pages of a renderer's SVG (steps 1 to 4 in the header), kept
 * apart from the pages on screen.
 * @param {string} svgText - the renderer's SVG of all pages.
 * @param {PageSize[]} sizes - the size of each page.
 * @returns {PageSet} the definitions, the pages and their sizes.
 * @throws {Error} when the renderer gave no SVG.
 */
export function createPageSet(svgText, sizes) {
    const root = parseRendererSvg(svgText);
    const children = [...root.children];
    const pageGroups = children.filter(child => child.classList.contains('typst-page'));
    const definitions = createDefinitions(getSharedElements(children, pageGroups));
    const pages = pageGroups.map((group, index) => createPage(group, index, sizes));
    // Links on the pages do not navigate; a click on one goes to the code like any other text.
    for (const element of [definitions, ...pages]) for (const link of element.querySelectorAll('a')) link.removeAttribute('href');
    return {
        definitions, pages, defs: definitions.innerHTML,
        sizes: pages.map((page, index) => ({ w: +(sizes[index]?.w || DEFAULT_PAGE_WIDTH), h: +(sizes[index]?.h || DEFAULT_PAGE_HEIGHT) })),
    };
}

/**
 * Reads the renderer's SVG without scripts, event attributes and script addresses: the pages
 * never run code. The renderer's viewer script (no valid XML) and the click handlers of its
 * links go before parsing.
 * @param {string} svgText - the renderer's SVG.
 * @returns {Element} the root <svg>.
 * @throws {Error} when the text holds no SVG.
 */
function parseRendererSvg(svgText) {
    const clean = escapeLinkAddresses(svgText.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, ''));
    const root = new DOMParser().parseFromString(clean, 'image/svg+xml').documentElement;
    if (root.nodeName !== 'svg') throw new Error('no SVG from the renderer');
    root.querySelectorAll('script').forEach(script => script.remove());
    for (const element of root.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
            if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && /^\s*(javascript|vbscript):/i.test(attribute.value))) element.removeAttribute(attribute.name);
        }
    }
    return root;
}

/**
 * Escapes < and & in the addresses of the renderer's SVG, which it writes as the document gives
 * them (a link to "a&b" or to a template placeholder such as <<link>>), so the SVG reads as XML.
 * @param {string} svgText - the renderer's SVG.
 * @returns {string} the SVG with every href value as valid XML.
 */
function escapeLinkAddresses(svgText) {
    return svgText.replace(/(\s(?:xlink:)?href=")([^"]*)"/g, (whole, start, address) => start + address.replace(/&(?!(?:[A-Za-z]+|#\d+|#x[0-9A-Fa-f]+);)/g, '&amp;').replace(/</g, '&lt;') + '"');
}

/**
 * Returns the elements the pages share: everything but the pages and the renderer's first
 * <style> (its own viewer styles; page.css has what the pages need).
 * @param {Element[]} children - the children of the renderer's root.
 * @param {Element[]} pageGroups - the pages among them.
 * @returns {Element[]} the shared elements.
 */
function getSharedElements(children, pageGroups) {
    let firstStyle = true;
    return children.filter(child => {
        if (pageGroups.includes(child)) return false;
        if (child.nodeName === 'style' && firstStyle) { firstStyle = false; return false; }
        return true;
    });
}

/**
 * Creates the hidden <svg> with the shared definitions.
 * @param {Element[]} shared - the shared elements.
 * @returns {SVGSVGElement} the element.
 */
function createDefinitions(shared) {
    const definitions = document.createElementNS(SVG_NAMESPACE, 'svg');
    definitions.setAttribute('class', 'typst-defs');
    definitions.setAttribute('aria-hidden', 'true');
    for (const element of shared) definitions.append(document.importNode(element, true));
    return definitions;
}

/**
 * Creates the element of one page: a .sheet of the page's size with its own <svg>.
 * @param {Element} group - the page's group in the renderer's SVG.
 * @param {number} index - the page's index.
 * @param {PageSize[]} sizes - the size of each page.
 * @returns {HTMLDivElement} the page.
 */
function createPage(group, index, sizes) {
    const width = +(sizes[index]?.w || group.getAttribute('data-page-width') || DEFAULT_PAGE_WIDTH);
    const height = +(sizes[index]?.h || group.getAttribute('data-page-height') || DEFAULT_PAGE_HEIGHT);
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.dataset.page = index + 1;
    sheet.style.width = (width * PIXELS_PER_POINT).toFixed(2) + 'px';
    sheet.style.height = (height * PIXELS_PER_POINT).toFixed(2) + 'px';
    const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'typst-page');
    const page = document.importNode(group, true);
    page.removeAttribute('transform');
    svg.append(page);
    sheet.append(svg);
    return sheet;
}
