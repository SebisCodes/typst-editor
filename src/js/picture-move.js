/**
 * Moving pictures on the page. A picture dragged on the page moves in the code: its #figure(…)
 * (or #image(…)) goes to its own paragraph before or after the block under the pointer, which a
 * line on the page shows. Over another picture it goes directly before or after that one's code
 * (a line at its edge: left or right, or top or bottom for pictures stacked in one paragraph);
 * two pictures that are cells of their own in #grid, #table or #stack swap when one is dropped
 * on the middle of the other (a frame around it).
 *
 * A click without moving stays a click; Escape cancels; the move is one undo step. Mouse and pen
 * drag after 4 px; a finger after resting on the picture a moment (a swipe that starts on it
 * scrolls the page, a tap stays a click). A click selects a picture; its X or the Delete key
 * removes its code (picture-remove.js).
 */

import { findPictures, getPictureMovedTo, getPictureMovedBeside, getPicturesSwapped, getPictureRemoved } from './typst-pictures.js?v=4';
import { state, ui, NARROW_SCREEN, showToast, getNumberInRange, isCompiled } from './state.js?v=3';
import { getPictureElements, getPictureCode, getPicturePlaces, getDropPlaces, getDropTarget } from './picture-places.js?v=5';
import { setCode, addTypingStep } from './history.js?v=6';
import { showCodePosition } from './code-view.js?v=6';
import { isTextEditing } from './text-edit.js?v=6';
import { showPane } from './layout.js?v=6';
import { getCopiedCodeRange } from './template-expansion.js?v=2';
import { getElementPlace } from './text-runs.js?v=4';
import { showSourceMark } from './source-mark.js?v=6';
import { VIEWER } from './sync.js?v=24';
import { startPictureRemover } from './picture-remove.js?v=1';

/** How far a mouse or pen moves before the drag starts, in pixels. */
const MOUSE_DRAG_DISTANCE = 4;
/** How far a finger moves before it scrolls instead, in pixels. */
const TOUCH_SCROLL_DISTANCE = 8;
/** How long a finger rests on a picture before it drags, in milliseconds. */
const TOUCH_HOLD_TIME = 400;
/** Near the top or bottom edge of the preview within this many pixels it scrolls. */
const EDGE_SIZE = 40;
const MAX_EDGE_SCROLL = 40;
const EDGE_SCROLL_DIVISOR = 2;
/** How far the line stands from a picture's edge, in pixels: before it, after it to the right, below it. */
const LINE_OFFSET_BEFORE = 4;
const LINE_OFFSET_AFTER = 1;
const LINE_OFFSET_BELOW = 2;
/** The frame around a picture to swap with, in pixels. */
const SWAP_FRAME_SPACE = 3;
const MIN_LINE_WIDTH = 20;
/** The line between blocks is drawn this far above its place, in pixels (half its thickness). */
const LINE_HALF_THICKNESS = 1;
const CHANGED_MEANWHILE = 'The code changed meanwhile - the edit was not used';
/** Pictures that the examples repeat or leave out are moved and removed in the template view. */
const MOVED_IN_TEMPLATE_VIEW = 'This picture moves in the template view - the examples repeat or leave out pictures here';
const REMOVED_IN_TEMPLATE_VIEW = 'This picture is removed in the template view - the examples repeat or leave out pictures here';

/**
 * A drag of a picture, from the press on.
 * @typedef {object} MoveState
 * @property {Element} el - the picture's element.
 * @property {number} id - the pointer's id.
 * @property {boolean} touch - true for a finger.
 * @property {number} x0 - where the press was.
 * @property {number} y0 - where the press was.
 * @property {number} x - where the pointer is.
 * @property {number} y - where the pointer is.
 * @property {boolean} dragging - true once the drag has started.
 * @property {string} code - the code when it was pressed.
 * @property {number} [timer] - the timer of a finger's rest.
 * @property {number} [raf] - the animation frame of the edge scroll.
 * @property {import('./typst-pictures.js').PictureCode} [pic] - the picture's code.
 * @property {Map<HTMLElement, import('./picture-places.js').BlockPlace[]>} [places] - the blocks of each page.
 * @property {import('./picture-places.js').PicturePlace[]} [pics] - the pictures on the pages.
 * @property {import('./picture-places.js').DropTarget|null} [target] - where it would go.
 */

/** @type {MoveState|null} */
let moving = null;
/** A drag just ended: the release and its click are not a click on the page (until the next press). */
let afterMove = false;
const dropLine = createDropLine();

/**
 * Creates the line (or frame) that shows where a picture would go.
 * @returns {HTMLDivElement} the line, not yet on a page.
 */
function createDropLine() {
    const line = document.createElement('div');
    line.className = 'picture-target';
    line.setAttribute('aria-hidden', 'true');
    return line;
}

/**
 * Shows where the picture would go at the pointer: a line between blocks, a line at the edge of
 * another picture, or a frame around a picture to swap with.
 * @param {number} x - the pointer's x on the screen.
 * @param {number} y - the pointer's y on the screen.
 * @returns {void}
 */
function showDropTarget(x, y) {
    const target = moving.target = getDropTarget(moving, x, y);
    if (!target) { dropLine.remove(); return; }
    const over = target.over;
    dropLine.classList.toggle('vertical', !!over && !target.swap && over.axis === 'x');
    dropLine.classList.toggle('swap', !!target.swap);
    if (target.swap) Object.assign(dropLine.style, { left: over.left - SWAP_FRAME_SPACE + 'px', top: over.top - SWAP_FRAME_SPACE + 'px', width: over.right - over.left + 2 * SWAP_FRAME_SPACE + 'px', height: over.bottom - over.top + 2 * SWAP_FRAME_SPACE + 'px' });
    else if (over && over.axis === 'x') Object.assign(dropLine.style, { left: (target.after ? over.right + LINE_OFFSET_AFTER : over.left - LINE_OFFSET_BEFORE) + 'px', top: over.top + 'px', width: '', height: over.bottom - over.top + 'px' });
    else if (over) Object.assign(dropLine.style, { left: over.left + 'px', top: (target.after ? over.bottom + LINE_OFFSET_BELOW : over.top - LINE_OFFSET_BEFORE) + 'px', width: over.right - over.left + 'px', height: '' });
    else Object.assign(dropLine.style, { left: target.left + 'px', top: target.y - LINE_HALF_THICKNESS + 'px', width: Math.max(MIN_LINE_WIDTH, target.right - target.left) + 'px', height: '' });
    if (dropLine.parentNode !== target.page) target.page.append(dropLine);
}

/**
 * Scrolls the preview while the pointer stays near its top or bottom edge, once a frame.
 * @returns {void}
 */
function moveViewAtEdge() {
    if (!moving?.dragging) return;
    const box = ui.scroller.getBoundingClientRect(), y = moving.y;
    const speed = y < box.top + EDGE_SIZE ? -(box.top + EDGE_SIZE - y) : y > box.bottom - EDGE_SIZE ? y - (box.bottom - EDGE_SIZE) : 0;
    if (speed) { ui.scroller.scrollTop += getNumberInRange(speed, -MAX_EDGE_SCROLL, MAX_EDGE_SCROLL) / EDGE_SCROLL_DIVISOR; showDropTarget(moving.x, y); }
    moving.raf = requestAnimationFrame(moveViewAtEdge);
}

/**
 * Ends the drag; with drop, moves the picture's code to the target as one undo step.
 * @param {boolean} drop - true to move it, false to cancel.
 * @returns {void}
 */
function stopMove(drop) {
    const move = moving;
    if (!move) return;
    moving = null;
    clearTimeout(move.timer);
    cancelAnimationFrame(move.raf);
    removeEventListener('keydown', stopMoveOnEscape, true);
    dropLine.remove();
    document.body.classList.remove('picture-dragging');
    move.el.classList.remove('is-moving');
    if (!move.dragging) return;
    afterMove = true;
    if (!drop || !move.target) return;
    if (state.code !== move.code || state.compiledCode !== move.code) { showToast(CHANGED_MEANWHILE); return; }
    const result = getMovedCode(move);
    if (!result) return;
    addTypingStep();
    setCode(result.code);
    if (NARROW_SCREEN.matches) showPane('code');
    showCodePosition(result.at, true, result.end);
}

/**
 * Returns the code with the picture at its target: swapped, beside the other picture, or in its
 * own paragraph between blocks.
 * @param {MoveState} move - the drag.
 * @returns {import('./typst-pictures.js').MovedCode|null} the code, null when nothing changes.
 */
function getMovedCode(move) {
    const target = move.target;
    if (target.swap) return getPicturesSwapped(state.code, move.pic, target.over.pic);
    if (target.over) return getPictureMovedBeside(state.code, move.pic, target.over.pic, target.after);
    return getPictureMovedTo(state.code, move.pic, target.to);
}

/**
 * Cancels the drag with Escape (a keydown handler).
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function stopMoveOnEscape(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    stopMove(false);
}

/**
 * Starts the drag: the picture's code and the places it can go. Returns whether it started: not when the pages are not current or the picture does not move.
 * @param {MoveState} move - the press.
 * @returns {boolean} true when the drag started.
 */
function startMove(move) {
    const calls = findPictures(state.compiledCode || ''), elements = getPictureElements();
    move.pic = findPagePictureCode(move.el, calls, elements, MOVED_IN_TEMPLATE_VIEW);
    if (!move.pic) { moving = null; return false; }
    move.places = getDropPlaces(calls, elements);
    move.pics = getPicturePlaces(calls, elements);
    move.dragging = true;
    try { ui.pages.setPointerCapture(move.id); } catch (err) { /* the pointer is gone already */ }
    document.body.classList.add('picture-dragging');
    move.el.classList.add('is-moving');
    addEventListener('keydown', stopMoveOnEscape, true);
    move.raf = requestAnimationFrame(moveViewAtEdge);
    showDropTarget(move.x, move.y);
    return true;
}

/**
 * Returns the code of a picture of the pages, when the pages show the current code and their
 * pictures stand for the code's pictures one by one; else shows why the picture stays.
 * @param {Element} element - the picture's element.
 * @param {import('./typst-pictures.js').PictureCode[]} calls - the pictures of the code.
 * @param {Element[]} elements - the pictures on the pages.
 * @param {string} templateViewText - the message for a picture that the template view repeats or leaves out.
 * @returns {import('./typst-pictures.js').PictureCode|null} its code, null when it stays.
 */
function findPagePictureCode(element, calls, elements, templateViewText) {
    const current = isPagesCurrent();
    if (current && !isPictureOrderKept(calls)) { showToast(templateViewText); return null; }
    const picture = current ? getPictureCode(element, calls, elements) : null;
    if (!picture && !current) showToast(CHANGED_MEANWHILE);
    return picture;
}

/**
 * Tells whether the pages show the current code: it is compiled, and the pages come from that
 * compile (a compile without pages keeps the earlier ones, marked as stale).
 * @returns {boolean} true when the pages show the current code.
 */
function isPagesCurrent() {
    return isCompiled() && !ui.stage.classList.contains('stale');
}

/**
 * Tells whether the pictures of the pages stand for the pictures of the code one by one: always
 * for the code as written; with template placeholders when every picture call of the text the
 * compiler read is copied text of the call at the same place in the code's order (no section left
 * one out, no list repeated one).
 * @param {object[]} calls - the picture calls of the code, each with its place (at).
 * @returns {boolean} true when the pictures of the pages are the code's, in order.
 */
function isPictureOrderKept(calls) {
    const map = state.viewMap;
    if (!map) return true;
    const viewCalls = findPictures(state.viewText);
    return viewCalls.length === calls.length && viewCalls.every((call, index) => getCopiedCodeRange(map, call.at, call.at + 1)?.start === calls[index].at);
}

/**
 * Notes a press on a picture (a pointerdown handler); a finger starts the drag after resting.
 * @param {PointerEvent} event - the press on the pages.
 * @returns {void}
 */
function startMoveOnPress(event) {
    afterMove = false;
    const element = event.target.closest?.('image.typst-image');
    if (!element || event.button !== 0 || moving || isTextEditing() || !ui.pages.contains(element)) return;
    const touch = event.pointerType === 'touch';
    if (!touch) event.preventDefault();
    const move = moving = { el: element, id: event.pointerId, touch, x0: event.clientX, y0: event.clientY, x: event.clientX, y: event.clientY, dragging: false, code: state.code };
    if (touch) move.timer = setTimeout(() => { if (moving === move) startMove(move); }, TOUCH_HOLD_TIME);
}

/**
 * Follows the pointer (a pointermove handler): a mouse or pen starts the drag after a few
 * pixels, a finger that moves before it rests scrolls instead.
 * @param {PointerEvent} event - the move.
 * @returns {void}
 */
function moveOnPointer(event) {
    const move = moving;
    if (!move || event.pointerId !== move.id) return;
    move.x = event.clientX;
    move.y = event.clientY;
    if (!move.dragging) {
        const distance = Math.hypot(move.x - move.x0, move.y - move.y0);
        if (move.touch) { if (distance >= TOUCH_SCROLL_DISTANCE) { clearTimeout(move.timer); moving = null; } return; }
        if (distance < MOUSE_DRAG_DISTANCE || !startMove(move)) return;
    }
    showDropTarget(move.x, move.y);
}

/**
 * Connects the pointer events of the pages for moving pictures. While a finger drags a picture,
 * the page does not scroll, and holding it opens no menu and selects no text; the release and
 * the click after a drag are no edit on the page.
 * @returns {void}
 */
export function startPictureMove() {
    ui.pages.addEventListener('pointerdown', startMoveOnPress);
    ui.pages.addEventListener('pointermove', moveOnPointer);
    document.addEventListener('touchmove', event => { if (moving?.dragging) event.preventDefault(); }, { passive: false });
    ui.pages.addEventListener('contextmenu', event => { if (moving?.touch) event.preventDefault(); });
    document.addEventListener('selectstart', event => { if (moving?.touch) event.preventDefault(); });
    ui.pages.addEventListener('pointerup', event => {
        if (moving && event.pointerId === moving.id) stopMove(true);
        if (afterMove) event.stopImmediatePropagation();
    }, true);
    ui.pages.addEventListener('pointercancel', () => { stopMove(false); afterMove = false; });
    ui.pages.addEventListener('click', event => { if (afterMove) { afterMove = false; event.stopImmediatePropagation(); } }, true);
}

/**
 * Finds the picture of the pages that a clicked element belongs to.
 * @param {Element} target - the clicked element.
 * @returns {Element|null} the picture, null when the element is no picture of the pages.
 */
function findClickedPicture(target) {
    const picture = target.closest('image.typst-image');
    return picture && ui.pages.contains(picture) && !isTextEditing() ? picture : null;
}

/**
 * Leads the code to a picture's place, with the focus kept on the pages.
 * @param {Element} picture - the picture.
 * @param {boolean} openCode - true to show the code on a narrow screen.
 * @returns {void}
 */
function showPictureCode(picture, openCode) {
    if (openCode) showPane('code');
    const place = getElementPlace(picture, null) ?? (isPagesCurrent() ? getPictureCode(picture, findPictures(state.compiledCode), getPictureElements())?.at : null);
    if (place == null) return;
    showCodePosition(place, false);
    showSourceMark(false, true);
}

/**
 * Removes a picture's code as one undo step, when the pages show the current code.
 * @param {Element} picture - the picture.
 * @returns {void}
 */
function removePicture(picture) {
    const code = findPagePictureCode(picture, findPictures(state.compiledCode || ''), getPictureElements(), REMOVED_IN_TEMPLATE_VIEW);
    if (!code) return;
    const removed = getPictureRemoved(state.code, code);
    addTypingStep();
    setCode(removed.code);
    showCodePosition(removed.at, false);
}

/**
 * Starts the selection of pictures on the pages with their X and the Delete key.
 * @returns {void}
 */
export function startPictureRemoving() {
    startPictureRemover({
        layer: ui.scroller,
        findPicture: findClickedPicture,
        getPictureBox: picture => picture.getBoundingClientRect(),
        showPictureCode,
        removePicture,
        getCode: () => state.code,
        isNarrowScreen: () => NARROW_SCREEN.matches,
        isEnabled: () => !VIEWER,
    });
}
