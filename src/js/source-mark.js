/**
 * Code and pages point at each other: the text at the code's cursor gets a frame on the page
 * while the code has the focus, and a click on the page puts the code's cursor where the
 * clicked text (or the code that made the clicked element) is.
 */

import { state, ui, NARROW_SCREEN, isCompiled } from './state.js?v=2';
import { getRunAtPlace, getRunOfElement, getElementPlace, getTextBox } from './text-runs.js?v=3';
import { showCodePosition } from './code-view.js?v=3';
import { updatePageLabel, VIEW_LINE_DIVISOR } from './zoom.js?v=3';
import { isTextEditing, isTextEditPending } from './text-edit.js?v=3';
import { showPane } from './layout.js?v=3';

/** The frame is not shown when the cursor is this far past the end of the run before it. */
const MAX_MARK_DISTANCE = 400;
/** The frame's distance from the text, in pixels. */
const FRAME_SPACE = 2;
/** The frame stays in view this far from the top and bottom of the preview, in pixels. */
const VIEW_MARGIN_TOP = 20;
const VIEW_MARGIN_BOTTOM = 40;
const frame = createFrame();

/**
 * Frames the text at the code's cursor on the page, while the code has the focus (or always).
 * @param {boolean} [scroll] - true to scroll the frame into view.
 * @param {boolean} [always] - true to frame it also when the code has no focus.
 * @returns {void}
 */
export function showSourceMark(scroll = true, always = false) {
    hideSourceMark();
    if (document.activeElement !== ui.ta && !always) return;
    const place = ui.ta.selectionStart;
    const run = getRunAtPlace(place);
    if (!run || !run.element.isConnected || place > run.end + MAX_MARK_DISTANCE) return;
    const page = run.element.closest('.sheet');
    const box = getTextBox(run).getBoundingClientRect(), pageBox = page.getBoundingClientRect();
    const zoom = state.zoom || 1;
    Object.assign(frame.style, {
        left: (box.left - pageBox.left) / zoom - FRAME_SPACE + 'px', top: (box.top - pageBox.top) / zoom - FRAME_SPACE + 'px',
        width: box.width / zoom + 2 * FRAME_SPACE + 'px', height: box.height / zoom + 2 * FRAME_SPACE + 'px',
    });
    page.append(frame);
    state.markedRun = run;
    if (scroll) showFrameInView(box);
}

/**
 * Scrolls the preview so that the frame is in view, and shows the page it is on.
 * @param {DOMRect} box - the framed text's box on the screen.
 * @returns {void}
 */
function showFrameInView(box) {
    const view = ui.scroller.getBoundingClientRect();
    if (box.bottom < view.top + VIEW_MARGIN_TOP || box.top > view.bottom - VIEW_MARGIN_BOTTOM) ui.scroller.scrollTop += box.top - view.top - view.height / VIEW_LINE_DIVISOR;
    updatePageLabel();
}

/**
 * Removes the frame from the page.
 * @returns {void}
 */
export function hideSourceMark() {
    frame.remove();
    state.markedRun = null;
}

/**
 * Puts the code's cursor at the clicked text or element (a click handler); text that can be
 * edited on the page, a selection and the field of an edit are left alone.
 * @param {MouseEvent} event - the click on the pages.
 * @returns {void}
 */
function showCodeOnClick(event) {
    if (event.target.closest('.text-in-place') || isTextEditPending() || isTextEditing()) return;
    const selection = getSelection();
    if (selection && !selection.isCollapsed && ui.pages.contains(selection.anchorNode)) return;
    const group = event.target.closest('.typst-text');
    const run = group && getRunOfElement(group);
    if (run && run.editable && isCompiled()) return;
    if (!event.target.closest('.sheet')) return;
    const place = getElementPlace(event.target, event.clientX);
    if (place == null) return;
    if (NARROW_SCREEN.matches) showPane('code');
    showCodePosition(place);
    showSourceMark(false, true);
}

/**
 * Creates the frame of the code cursor's text.
 * @returns {HTMLDivElement} the frame, not yet on a page.
 */
function createFrame() {
    const element = document.createElement('div');
    element.className = 'source';
    element.setAttribute('aria-hidden', 'true');
    return element;
}

/**
 * Connects clicks on the pages.
 * @returns {void}
 */
export function startSourceMark() {
    ui.pages.addEventListener('click', showCodeOnClick);
}
