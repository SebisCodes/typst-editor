/**
 * Zoom and pages of the preview: the zoom fits the width or the whole page, or is set by the
 * buttons, Ctrl + wheel and Ctrl + / -; the label shows the page in view, the arrows and
 * PageUp / PageDown go to the page before or after. The zoom is CSS zoom on the pages.
 */

import { state, ui, NARROW_SCREEN, PIXELS_PER_POINT, POINTS_PER_MILLIMETER, getElement, getNumberInRange } from './state.js?v=3';
import { saveState } from './storage.js?v=4';
import { showSourceMark } from './source-mark.js?v=4';

/** The page size before the first compile: A4 in millimeters. */
const A4_WIDTH = 210;
const A4_HEIGHT = 297;
/** The space left around the pages, in pixels. */
const PAGE_MARGIN = 44;
const NARROW_PAGE_MARGIN = 16;
const MIN_FIT_ZOOM = 0.1;
const MAX_FIT_ZOOM = 3;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
/** The step of the zoom buttons and keys. */
export const ZOOM_STEP = 1.2;
/** How strongly the wheel zooms. */
const WHEEL_ZOOM_FACTOR = 0.0022;
/** Where a page counts as in view: the preview's height divided by this, from its top (a third). */
export const VIEW_LINE_DIVISOR = 3;
/** The space left above a page shown by the arrows, in pixels. */
const PAGE_TOP_SPACE = 14;

/**
 * Returns the size of the first page in pixels at zoom 1 (A4 before the first compile).
 * @returns {{w: number, h: number}} the width and height.
 */
export function getPageSize() {
    const size = state.sizes[0];
    return size ? { w: size.w * PIXELS_PER_POINT, h: size.h * PIXELS_PER_POINT } : { w: A4_WIDTH * POINTS_PER_MILLIMETER * PIXELS_PER_POINT, h: A4_HEIGHT * POINTS_PER_MILLIMETER * PIXELS_PER_POINT };
}

/**
 * Sets the zoom the fit asks for (the width or the whole page in view) and shows it: on the
 * pages, in the label and on the fit buttons; the frame of the code cursor's text follows.
 * @returns {void}
 */
export function updateZoom() {
    const { w, h } = getPageSize();
    const availableWidth = ui.scroller.clientWidth - (NARROW_SCREEN.matches ? NARROW_PAGE_MARGIN : PAGE_MARGIN);
    const availableHeight = ui.scroller.clientHeight - PAGE_MARGIN;
    if (availableWidth > 0) {
        if (state.fit === 'width') state.zoom = getNumberInRange(availableWidth / w, MIN_FIT_ZOOM, MAX_FIT_ZOOM);
        else if (state.fit === 'page') state.zoom = getNumberInRange(Math.min(availableWidth / w, availableHeight / h), MIN_FIT_ZOOM, MAX_FIT_ZOOM);
    }
    ui.pages.style.zoom = state.zoom;
    ui.zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
    getElement('#zoom-fit').setAttribute('aria-pressed', String(state.fit === 'width'));
    getElement('#zoom-page').setAttribute('aria-pressed', String(state.fit === 'page'));
    if (state.markedRun) showSourceMark(false);
}

/**
 * Sets a zoom of its own, keeping the point under the pointer (or the middle) in place, and
 * stores it.
 * @param {number} zoom - the zoom, limited to 0.1 to 5.
 * @param {number} [x] - the pointer's x in the preview.
 * @param {number} [y] - the pointer's y in the preview.
 * @returns {void}
 */
export function setZoom(zoom, x, y) {
    const scroller = ui.scroller;
    const box = scroller.getBoundingClientRect();
    const pointX = x ?? box.width / 2, pointY = y ?? box.height / 2;
    const oldZoom = state.zoom;
    const newZoom = getNumberInRange(zoom, MIN_ZOOM, MAX_ZOOM);
    const contentX = (scroller.scrollLeft + pointX) / oldZoom, contentY = (scroller.scrollTop + pointY) / oldZoom;
    state.fit = null;
    state.zoom = newZoom;
    updateZoom();
    scroller.scrollLeft = contentX * newZoom - pointX;
    scroller.scrollTop = contentY * newZoom - pointY;
    saveState();
}

/**
 * Returns the page in view: the last one whose top is above a third of the preview's height.
 * @returns {number} its index, 0 without pages.
 */
export function getCurrentPage() {
    const box = ui.scroller.getBoundingClientRect();
    const viewLine = box.top + box.height / VIEW_LINE_DIVISOR;
    let current = 0;
    state.pages.forEach((page, index) => { if (page.getBoundingClientRect().top <= viewLine) current = index; });
    return current;
}

/**
 * Shows the page in view and the number of pages, and enables the arrows as far as there are
 * pages before and after it.
 * @returns {void}
 */
export function updatePageLabel() {
    const count = state.pages.length;
    const current = count ? getCurrentPage() + 1 : 0;
    ui.pageLabel.textContent = `${current} / ${count}`;
    getElement('#page-prev').disabled = current <= 1;
    getElement('#page-next').disabled = current >= count;
}

/**
 * Scrolls a page to the top of the preview.
 * @param {number} index - the page's index (limited to the pages there are).
 * @returns {void}
 */
export function showPage(index) {
    const page = state.pages[getNumberInRange(index, 0, state.pages.length - 1)];
    if (!page) return;
    const scroller = ui.scroller;
    scroller.scrollTop += page.getBoundingClientRect().top - scroller.getBoundingClientRect().top - PAGE_TOP_SPACE;
    updatePageLabel();
}

/**
 * Zooms with Ctrl (or Cmd) and the wheel, around the pointer (a wheel handler).
 * @param {WheelEvent} event - the wheel event.
 * @returns {void}
 */
function setZoomOnWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const box = ui.scroller.getBoundingClientRect();
    setZoom(state.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_FACTOR), event.clientX - box.left, event.clientY - box.top);
}

/**
 * Connects the preview's scrolling and wheel, its size, and the zoom and page buttons.
 * @returns {void}
 */
export function startZoom() {
    ui.scroller.addEventListener('scroll', () => { requestAnimationFrame(updatePageLabel); }, { passive: true });
    ui.scroller.addEventListener('wheel', setZoomOnWheel, { passive: false });
    new ResizeObserver(() => { if (state.fit) updateZoom(); }).observe(ui.scroller);
    getElement('#zoom-in').addEventListener('click', () => setZoom(state.zoom * ZOOM_STEP));
    getElement('#zoom-out').addEventListener('click', () => setZoom(state.zoom / ZOOM_STEP));
    getElement('#zoom-100').addEventListener('click', () => setZoom(1));
    getElement('#zoom-fit').addEventListener('click', () => { state.fit = 'width'; updateZoom(); saveState(); });
    getElement('#zoom-page').addEventListener('click', () => { const current = getCurrentPage(); state.fit = 'page'; updateZoom(); showPage(current); saveState(); });
    getElement('#page-prev').addEventListener('click', () => showPage(getCurrentPage() - 1));
    getElement('#page-next').addEventListener('click', () => showPage(getCurrentPage() + 1));
}
