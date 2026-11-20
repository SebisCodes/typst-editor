/**
 * Where a picture dragged on the page can go: the pictures on the pages with their code and
 * box, the blocks of the code with their box on each page, and the target under the pointer.
 *
 * The pictures on the pages are the image( calls of the code in order (when there are as
 * many), else the one after the place getElementPlace() finds. Boxes are in page pixels at
 * zoom 1.
 */

import { getBlocks } from './typst-code.js?v=3';
import { isPlaceableBeside } from './typst-pictures.js?v=3';
import { state, getElements } from './state.js?v=2';
import { getElementPlace, getTextBox } from './text-runs.js?v=3';

/** Over another picture, its middle from this share to 1 minus it swaps two cells. */
const SWAP_SHARE = 0.25;
/** Over another picture, from this share of its width (or height) on the picture goes after it. */
const AFTER_SHARE = 0.5;
/** The line of a target between blocks stands this far from the block, in pixels. */
const TARGET_LINE_SPACE = 3;

/**
 * A picture on a page with its code and box.
 * @typedef {object} PicturePlace
 * @property {Element} el - the picture's element.
 * @property {import('./typst-pictures.js').PictureCode} pic - its code.
 * @property {HTMLElement} page - its page.
 * @property {number} top - its box.
 * @property {number} bottom - its box.
 * @property {number} left - its box.
 * @property {number} right - its box.
 * @property {string} axis - "x" when it stands beside its neighbours in the code, "y" when one is below the other.
 */

/**
 * A block of the code with its box on a page.
 * @typedef {object} BlockPlace
 * @property {number} a - where the block starts in the code.
 * @property {number} b - where it ends.
 * @property {number} top - its box.
 * @property {number} bottom - its box.
 * @property {number} left - its box.
 * @property {number} right - its box.
 */

/**
 * Where a dragged picture would go.
 * @typedef {object} DropTarget
 * @property {HTMLElement} page - the page.
 * @property {PicturePlace} [over] - the picture under the pointer.
 * @property {boolean} [swap] - true to swap with it.
 * @property {boolean} [after] - true to go after it.
 * @property {number} [to] - the place between blocks in the code.
 * @property {number} [y] - the line's height on the page.
 * @property {number} [left] - where the line starts.
 * @property {number} [right] - where it ends.
 */

/**
 * The drag of a picture (picture-move.js).
 * @typedef {object} PictureMove
 * @property {Element} el - the picture's element.
 * @property {import('./typst-pictures.js').PictureCode} pic - its code.
 * @property {Map<HTMLElement, BlockPlace[]>} places - the blocks of each page.
 * @property {PicturePlace[]} pics - the pictures on the pages.
 */

/**
 * Returns the pictures on the pages.
 * @returns {Element[]} the image elements in page order.
 */
export function getPictureElements() {
    return getElements('#pages .sheet image.typst-image');
}

/**
 * Returns the code of a picture element, when it can move.
 * @param {Element} element - the picture's element.
 * @param {import('./typst-pictures.js').PictureCode[]} calls - the pictures of the code.
 * @param {Element[]} elements - the pictures on the pages.
 * @returns {import('./typst-pictures.js').PictureCode|null} its code, null when it does not move.
 */
export function getPictureCode(element, calls, elements) {
    const place = calls.length === elements.length ? null : getElementPlace(element, null);
    const call = calls.length === elements.length ? calls[elements.indexOf(element)] : place == null ? null : calls.find(item => item.at >= place);
    return call?.move ? call : null;
}

/**
 * Returns the box of an element on its page, in page pixels at zoom 1.
 * @param {Element} element - the element.
 * @param {HTMLElement} page - its page.
 * @returns {{top: number, bottom: number, left: number, right: number}} the box.
 */
function getPageBox(element, page) {
    const zoom = state.zoom || 1;
    const box = element.getBoundingClientRect(), pageBox = page.getBoundingClientRect();
    return { top: (box.top - pageBox.top) / zoom, bottom: (box.bottom - pageBox.top) / zoom, left: (box.left - pageBox.left) / zoom, right: (box.right - pageBox.left) / zoom };
}

/**
 * Returns the pictures on the pages with their code and box, and which way they stand to their
 * neighbours in the code (only white space or commas between, no blank line): x (side by side)
 * or y (one below the other).
 * @param {import('./typst-pictures.js').PictureCode[]} calls - the pictures of the code.
 * @param {Element[]} elements - the pictures on the pages.
 * @returns {PicturePlace[]} the pictures that can move.
 */
export function getPicturePlaces(calls, elements) {
    const list = [];
    elements.forEach(element => {
        const pic = getPictureCode(element, calls, elements), page = element.closest('.sheet');
        if (!pic || !page) return;
        list.push({ el: element, pic, page, ...getPageBox(element, page), axis: 'x' });
    });
    const order = list.slice().sort((p, q) => p.pic.move[0] - q.pic.move[0]);
    order.forEach((place, index) => {
        const near = [order[index - 1], order[index + 1]].filter(other => isNeighbourInCode(place, other));
        if (near.length && !near.some(other => other.top < place.bottom && other.bottom > place.top)) place.axis = 'y';
    });
    return list;
}

/**
 * Tells whether another picture is a neighbour in the code on the same page: only white space
 * or commas between them, no blank line.
 * @param {PicturePlace} place - the picture.
 * @param {PicturePlace|undefined} other - the picture before or after it in the code.
 * @returns {boolean} true for a neighbour.
 */
function isNeighbourInCode(place, other) {
    if (!other || other.page !== place.page) return false;
    const code = state.compiledCode;
    const between = other.pic.move[0] > place.pic.move[0] ? code.slice(place.pic.move[1], other.pic.move[0]) : code.slice(other.pic.move[1], place.pic.move[0]);
    return /^[\s,]*$/.test(between) && !/\n[ \t]*\n/.test(between);
}

/**
 * Returns the blocks of the code on each page, with their box there: the boxes of the text
 * runs and the pictures of each block, joined.
 * @param {import('./typst-pictures.js').PictureCode[]} calls - the pictures of the code.
 * @param {Element[]} elements - the pictures on the pages.
 * @returns {Map<HTMLElement, BlockPlace[]>} the blocks of each page.
 */
export function getDropPlaces(calls, elements) {
    const blocks = getBlocks(state.compiledCode);
    const byPage = new Map();
    for (const run of state.runs) if (run.start != null) addBlockBox(byPage, blocks, run.start, getTextBox(run), run.element.closest('.sheet'));
    elements.forEach(element => { const pic = getPictureCode(element, calls, elements); if (pic) addBlockBox(byPage, blocks, pic.move[0], element, element.closest('.sheet')); });
    return new Map([...byPage].map(([page, places]) => [page, [...places.values()]]));
}

/**
 * Adds the box of an element to the box of the block its place is in, on its page.
 * @param {Map<HTMLElement, Map<object, BlockPlace>>} byPage - the blocks of each page so far.
 * @param {import('./typst-code.js').CodeBlock[]} blocks - the blocks of the code.
 * @param {number} place - the element's place in the code.
 * @param {Element} element - the element whose box counts.
 * @param {HTMLElement|null} page - its page.
 * @returns {void}
 */
function addBlockBox(byPage, blocks, place, element, page) {
    let low = 0, high = blocks.length - 1, index = -1;
    while (low <= high) { const middle = (low + high) >> 1; if (blocks[middle].a <= place) { index = middle; low = middle + 1; } else high = middle - 1; }
    const block = blocks[index];
    if (!block || place > block.b || !page) return;
    const box = element.getBoundingClientRect();
    if (!box.width && !box.height) return;
    const { top, bottom, left, right } = getPageBox(element, page);
    if (!byPage.has(page)) byPage.set(page, new Map());
    const places = byPage.get(page), known = places.get(block);
    if (known) Object.assign(known, { top: Math.min(known.top, top), bottom: Math.max(known.bottom, bottom), left: Math.min(known.left, left), right: Math.max(known.right, right) });
    else places.set(block, { a: block.a, b: block.b, top, bottom, left, right });
}

/**
 * Returns the place under the pointer: another picture under it (its nearer edge, or its middle
 * half to swap), else the block on that page nearest to it, before or after it by the nearer half.
 * @param {PictureMove} move - the drag.
 * @param {number} x - the pointer's x on the screen.
 * @param {number} y - the pointer's y on the screen.
 * @returns {DropTarget|null} the target, null when the page under the pointer has no blocks.
 */
export function getDropTarget(move, x, y) {
    const page = getNearestPage(y);
    const list = page && move.places.get(page);
    if (!list?.length) return null;
    const zoom = state.zoom || 1, pageBox = page.getBoundingClientRect();
    const pageX = (x - pageBox.left) / zoom, pageY = (y - pageBox.top) / zoom;
    const over = move.pics.find(place => place.page === page && place.el !== move.el && pageX >= place.left && pageX <= place.right && pageY >= place.top && pageY <= place.bottom
        && isPlaceableBeside(state.compiledCode, move.pic, place.pic));
    if (over) {
        const share = over.axis === 'x' ? (pageX - over.left) / Math.max(1, over.right - over.left) : (pageY - over.top) / Math.max(1, over.bottom - over.top);
        if (move.pic.cell && over.pic.cell && share > SWAP_SHARE && share < 1 - SWAP_SHARE) return { page, over, swap: true };
        return { page, over, after: share >= AFTER_SHARE };
    }
    return getBlockTarget(page, list, pageY);
}

/**
 * Returns the page nearest to a height on the screen.
 * @param {number} y - the height on the screen.
 * @returns {HTMLElement|null} the page, null without pages.
 */
function getNearestPage(y) {
    let page = null, best = Infinity;
    for (const candidate of state.pages) {
        const box = candidate.getBoundingClientRect();
        const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
        if (distance < best) { best = distance; page = candidate; }
    }
    return page;
}

/**
 * Returns the target between blocks: before or after the block nearest to the pointer (the
 * smallest one when it is inside several), by the nearer half.
 * @param {HTMLElement} page - the page.
 * @param {BlockPlace[]} list - the blocks on the page.
 * @param {number} pageY - the pointer's height on the page at zoom 1.
 * @returns {DropTarget} the target.
 */
function getBlockTarget(page, list, pageY) {
    let block = null, best = Infinity;
    for (const place of list) {
        const distance = pageY < place.top ? place.top - pageY : pageY > place.bottom ? pageY - place.bottom : -1 / (1 + place.bottom - place.top);
        if (distance < best) { best = distance; block = place; }
    }
    const before = pageY < (block.top + block.bottom) / 2;
    return {
        page, to: before ? block.a : block.b, y: before ? block.top - TARGET_LINE_SPACE : block.bottom + TARGET_LINE_SPACE,
        left: Math.min(...list.map(place => place.left)), right: Math.max(...list.map(place => place.right)),
    };
}
