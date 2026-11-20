/**
 * Editing text on the page. A click on a run found in the code opens a field over it with the
 * cursor where the click was (and puts the code's cursor on the same character); Enter writes
 * a new paragraph, Shift+Enter a new line, Ctrl+Enter or a click elsewhere writes the changed
 * part into the code (one undo step, special characters escaped, text-breaks.js), Escape
 * cancels. The field looks like the text it covers (size, weight, slant, font and color; the
 * run itself is hidden meanwhile).
 *
 * startTextEdit() runs these steps:
 *   1. check that the run is still in the code as the page shows it;
 *   2. open a field of the run's look over it, the cursor at the clicked character;
 *   3. put the code's cursor there too and frame the run;
 *   4. connect the field's keys and its blur.
 */

import { getTextStyle } from './typst-text.js?v=3';
import { state, ui, PIXELS_PER_POINT, showToast, isCompiled } from './state.js?v=2';
import { getRunPlaces, getRunOfElement, getCharacterIndex, getTextBox } from './text-runs.js?v=3';
import { getEditedCode, isInStrong } from './text-breaks.js?v=3';
import { setCode, addTypingStep } from './history.js?v=3';
import { showCodePosition } from './code-view.js?v=3';
import { showSourceMark } from './source-mark.js?v=3';

/** The fonts the pages have as web fonts (page.css); another font the code names is asked of the browser first. */
const PAGE_FONTS = { 'libertinus serif': '"Libertinus Serif"', 'new computer modern': '"New Computer Modern"', 'dejavu sans mono': '"DejaVu Sans Mono"' };
const MONO_FONTS = '"DejaVu Sans Mono", monospace';
const SERIF_FONTS = '"Libertinus Serif", Georgia, serif';
const DEFAULT_COLOR = '#000000';
/** The font size of a run without a text layer: this share of its box's height. */
const BOX_FONT_SHARE = 0.8;
/** The field's distance from the text, in pixels. */
const FIELD_SPACE_LEFT = 3;
const FIELD_SPACE_TOP = 2;
/** The field is this much higher and wider than the text, in pixels. */
const FIELD_EXTRA_HEIGHT = 4;
const FIELD_EXTRA_WIDTH = 8;
const FIELD_MIN_WIDTH = 30;
/** Room for the cursor right of the text, in pixels. */
const FIELD_CURSOR_ROOM = 4;
const CHANGED_IN_CODE = 'This text changed in the code - wait for the preview, then try again';
const CHANGED_MEANWHILE = 'The code changed meanwhile - the edit was not used';
const PARAGRAPH_IN_STRONG = 'A new paragraph inside bold or emphasis is made in the code - Shift+Enter makes a new line';
const HOW_TO_EDIT = 'Editing on the page - Enter: new paragraph, Shift+Enter: new line, Ctrl+Enter or a click elsewhere keeps it, Escape cancels';

/**
 * The text being edited on the page.
 * @typedef {object} TextEdit
 * @property {import('./state.js').TextRun} run - the run.
 * @property {HTMLTextAreaElement} input - the field over it.
 * @property {string} before - the run's text when the edit started.
 */

/** @type {TextEdit|null} */
let editing = null;
/** A pointerup has an edit coming: the click that follows does not go to the code. */
let editPending = false;
let howToEditShown = false;

/**
 * Tells whether text is being edited on the page.
 * @returns {boolean} true while the field is open.
 */
export function isTextEditing() {
    return !!editing;
}

/**
 * Tells whether an edit opens right after this pointerup.
 * @returns {boolean} true until the edit has started.
 */
export function isTextEditPending() {
    return editPending;
}

/**
 * Returns the scale from an element's units to the page's points: its transforms up to the
 * page's <svg>.
 * @param {Element} element - the element.
 * @returns {number} the scale.
 */
function getPointsPerUnit(element) {
    let scale = 1;
    for (let node = element; node && node.nodeName !== 'svg'; node = node.parentNode) {
        const transform = node.transform?.baseVal?.consolidate?.();
        if (transform) scale *= Math.hypot(transform.matrix.a, transform.matrix.b);
    }
    return scale;
}

/**
 * Returns the look of a run's text for the field: size, weight, slant, font and color.
 * @param {import('./state.js').TextRun} run - the run.
 * @param {number} boxHeight - the height of its box on the page at zoom 1.
 * @returns {{fontSize: string, fontWeight: string, fontStyle: string, fontFamily: string, color: string}} the CSS values.
 */
function getRunLook(run, boxHeight) {
    const style = getTextStyle(state.compiledCode, run.start, state.ast);
    const textLayer = run.element.querySelector('.tsel'), foreignObject = run.element.querySelector('foreignObject');
    const size = textLayer && foreignObject ? parseFloat(textLayer.style.fontSize) * getPointsPerUnit(foreignObject.parentNode) * PIXELS_PER_POINT : 0;
    const ownFont = style.font && (PAGE_FONTS[style.font.toLowerCase()] || '"' + style.font.replace(/["\\]/g, '') + '"');
    const fill = run.element.getAttribute('fill') || '';
    return {
        fontSize: (size > 0 ? size : boxHeight * BOX_FONT_SHARE) + 'px',
        fontWeight: String(style.weight), fontStyle: style.italic ? 'italic' : 'normal',
        fontFamily: style.mono ? MONO_FONTS : (ownFont ? ownFont + ', ' : '') + SERIF_FONTS,
        color: /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i.test(fill) ? fill : DEFAULT_COLOR,
    };
}

/**
 * Opens a field over a run to edit its text (the steps in the header).
 * @param {import('./state.js').TextRun} run - the run.
 * @param {number} x - the click's x on the screen.
 * @returns {void}
 */
function startTextEdit(run, x) {
    if (editing) return;
    if (!isCompiled() || !getRunPlaces(run.core, run.start)) { showToast(CHANGED_IN_CODE); return; }
    const index = getCharacterIndex(run, x);
    const { input, rowHeight } = createField(run);
    editing = { run, input, before: run.core };
    input.focus({ preventScroll: true });
    input.setSelectionRange(index, index);
    showCodePosition(run.places[index], false);
    showSourceMark(false, true);
    input.addEventListener('keydown', event => handleFieldKey(event, run, input, rowHeight));
    input.addEventListener('blur', () => stopTextEdit(true));
    if (!howToEditShown) { howToEditShown = true; showToast(HOW_TO_EDIT); }
}

/**
 * Creates the field over a run, in the run's look, and hides the run: a text field of one row
 * whose width follows the text (where the browser does not do it by itself) and whose height
 * follows its lines (Enter and Shift+Enter show as typed).
 * @param {import('./state.js').TextRun} run - the run.
 * @returns {{input: HTMLTextAreaElement, rowHeight: number}} the field, on the page, and the height of one of its rows.
 */
function createField(run) {
    const page = run.element.closest('.sheet');
    const box = getTextBox(run).getBoundingClientRect(), pageBox = page.getBoundingClientRect();
    const zoom = state.zoom || 1;
    const input = document.createElement('textarea');
    input.rows = 1;
    input.wrap = 'off';
    input.className = 'text-in-place';
    input.value = run.core;
    input.spellcheck = true;
    input.setAttribute('aria-label', 'Text on the page');
    input.setAttribute('data-no-i18n', '');
    const lead = run.lead ? (box.width / run.text.length) * run.lead : 0;
    Object.assign(input.style, {
        left: (box.left - pageBox.left + lead) / zoom - FIELD_SPACE_LEFT + 'px', top: (box.top - pageBox.top) / zoom - FIELD_SPACE_TOP + 'px',
        minWidth: Math.max(FIELD_MIN_WIDTH, (box.width - lead) / zoom + FIELD_EXTRA_WIDTH) + 'px', height: box.height / zoom + FIELD_EXTRA_HEIGHT + 'px', lineHeight: box.height / zoom + FIELD_EXTRA_HEIGHT + 'px',
        ...getRunLook(run, box.height / zoom),
    });
    page.append(input);
    run.element.style.visibility = 'hidden';
    const rowHeight = box.height / zoom + FIELD_EXTRA_HEIGHT;
    resizeField(input, rowHeight);
    input.addEventListener('input', () => resizeField(input, rowHeight));
    return { input, rowHeight };
}

/**
 * Sets the field's height to its lines and, where the browser does not size it by itself, its
 * width to its text.
 * @param {HTMLTextAreaElement} input - the field.
 * @param {number} rowHeight - the height of one row in pixels.
 * @returns {void}
 */
function resizeField(input, rowHeight) {
    input.style.height = rowHeight * input.value.split('\n').length + 'px';
    if (!CSS.supports('field-sizing', 'content')) { input.style.width = '0'; input.style.width = input.scrollWidth + FIELD_CURSOR_ROOM + 'px'; }
}

/**
 * Runs the keys of the field: Ctrl+Enter keeps the edit, Enter a new paragraph (not inside
 * bold or emphasis), Shift+Enter a new line, Escape cancels (a keydown handler).
 * @param {KeyboardEvent} event - the key.
 * @param {import('./state.js').TextRun} run - the run being edited.
 * @param {HTMLTextAreaElement} input - the field.
 * @param {number} rowHeight - the height of one row of the field in pixels.
 * @returns {void}
 */
function handleFieldKey(event, run, input, rowHeight) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); stopTextEdit(true); }
    else if (event.key === 'Enter') {
        event.preventDefault();
        if (!event.shiftKey && isInStrong(run.places[Math.min(input.selectionStart, run.core.length)] ?? run.start)) { showToast(PARAGRAPH_IN_STRONG); return; }
        input.setRangeText(event.shiftKey ? '\n' : '\n\n', input.selectionStart, input.selectionEnd, 'end');
        resizeField(input, rowHeight);
    } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopTextEdit(false); }
}

/**
 * Closes the field and shows the run again; with keep, writes the changed text into the code
 * as one undo step and puts the code's cursor after it.
 * @param {boolean} keep - true to keep the edit, false to cancel it.
 * @returns {void}
 */
export function stopTextEdit(keep) {
    const edit = editing;
    if (!edit) return;
    editing = null;
    const { run, input, before } = edit;
    const edited = input.value.replace(/\u00a0/g, ' ');
    input.remove();
    run.element.style.visibility = '';
    if (!keep || edited === before) return;
    if (!isCompiled() || !getRunPlaces(before, run.start)) { showToast(CHANGED_MEANWHILE); return; }
    const result = getEditedCode(run, before, edited);
    if (!result) return;
    addTypingStep();
    setCode(result.code);
    ui.ta.setSelectionRange(result.cursor, result.cursor);
    showCodePosition(result.cursor, false);
}

/**
 * Returns the run at a point: the one under it, or the nearest editable one on that line of
 * its page (a click right of a line's end edits that line, the cursor at its end).
 * @param {number} x - the x on the screen.
 * @param {number} y - the y on the screen.
 * @returns {import('./state.js').TextRun|null} the run, null off the pages.
 */
function getRunAt(x, y) {
    const element = document.elementFromPoint(x, y);
    const group = element?.closest('.typst-text');
    if (group && getRunOfElement(group)) return getRunOfElement(group);
    const page = element?.closest('.sheet');
    if (!page) return null;
    let best = null, bestDistance = Infinity;
    for (const text of page.querySelectorAll('.typst-text')) {
        const run = getRunOfElement(text);
        if (!run || !run.editable) continue;
        const box = getTextBox(run).getBoundingClientRect();
        if (y < box.top - box.height / 2 || y > box.bottom + box.height / 2) continue;
        const distance = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
        if (distance < bestDistance) { bestDistance = distance; best = run; }
    }
    return best;
}

/**
 * Opens the edit of the run under the pointer once the click is done (a pointerup handler);
 * a selection on the page and pages that are not current are left to the click handler.
 * @param {PointerEvent} event - the pointerup on the pages.
 * @returns {void}
 */
function startTextEditOnPointerUp(event) {
    if (event.button !== 0 || editing) return;
    const selection = getSelection();
    if (selection && !selection.isCollapsed && ui.pages.contains(selection.anchorNode)) return;
    const run = getRunAt(event.clientX, event.clientY);
    if (!run || !run.editable || !ui.pages.contains(run.element)) return;
    if (!isCompiled()) return;
    event.preventDefault();
    editPending = true;
    setTimeout(() => { editPending = false; startTextEdit(run, event.clientX); }, 0);
}

/**
 * Connects editing on the page.
 * @returns {void}
 */
export function startTextEditing() {
    ui.pages.addEventListener('pointerup', startTextEditOnPointerUp);
}
