/**
 * The code view: a textarea with the highlighted code, the lines with problems and the band of
 * the cursor's line in layers behind it, and the line numbers beside it (wrap.js draws them for
 * wrapped lines); the status line below it counts lines, bytes and pages.
 *
 * Typing sets the code itself (not through setCode()): it redraws the code at once; the compiler follows a little later, the undo step when
 * typing pauses, and the document is stored shortly after. The text at the code's cursor is
 * framed on the page while the code has the focus.
 */

import { highlight, escapeHtml } from './typst.js?v=8';
import { state, ui, areas, NARROW_SCREEN, LINE_HEIGHT, getLineStart } from './state.js?v=3';
import { updateHistoryButtons, addHistoryStep } from './history.js?v=7';
import { startCompileSoon, COMPILE_DELAY } from './compile.js?v=7';
import { startSaveSoon } from './storage.js?v=7';
import { showSourceMark, hideSourceMark } from './source-mark.js?v=7';
import { buildHighlightWithTemplateTags, convertTemplateTagsToLetters } from './template-tags.js?v=2';
import { TEMPLATE_SYNTAX } from './typst-template.js?v=1';

/** Code longer than this is shown without highlighting. */
const MAX_HIGHLIGHT_LENGTH = 600000;
/** Code longer than this waits longer before it is compiled. */
const LONG_CODE = 60000;
/** How long the compile of long code waits after typing, in milliseconds. */
const LONG_COMPILE_DELAY = 500;
/** How long typing pauses before it becomes an undo step, in milliseconds. */
const HISTORY_DELAY = 600;
/** The padding above the first line, in pixels. */
const CODE_PADDING_TOP = 10;
const KILOBYTE = 1024;
/** Pixels kept free right of the cursor when the code scrolls sideways to it. */
const SCROLL_MARGIN_RIGHT = 60;
/** Pixels shown left of the cursor after the code scrolled sideways to it. */
const SCROLL_MARGIN_LEFT = 40;
/** The code scrolls when the cursor's line is less than one line from the top or two from the bottom. */
const LINES_KEPT_ABOVE = 1;
const LINES_KEPT_BELOW = 2;
/** A line scrolled into view lands at the height of the code divided by this (a third). */
const VIEW_LINE_DIVISOR = 3;
/** How many characters are measured for the character width. */
const MEASURED_CHARACTERS = 100;
let lineBand = null;
let characterWidth = 0;
let lineCount = 0;

/**
 * Draws the highlighted code, the problem marks, the line numbers, the status and the state of
 * Undo and Redo.
 * @returns {void}
 */
export function renderCode() {
    const code = state.code;
    ui.hl.innerHTML = code.length < MAX_HIGHLIGHT_LENGTH ? highlightCode(code) + '\n' : escapeHtml(code) + '\n';
    renderProblemMarks();
    lineCount = code.split('\n').length;
    areas.lineWrap.update(code);
    renderStatus();
    updateHistoryButtons();
}

/**
 * Returns the code highlighted; with a template syntax the code is highlighted with each tag read
 * as plain text, and the tags are put back as written, in the colors of the text around them.
 * @param {string} code - the code.
 * @returns {string} the highlighted HTML.
 */
function highlightCode(code) {
    if (!TEMPLATE_SYNTAX) return highlight(code);
    return buildHighlightWithTemplateTags(highlight(convertTemplateTagsToLetters(code, TEMPLATE_SYNTAX)), TEMPLATE_SYNTAX, code);
}

/**
 * Shows the number of lines, the size and the number of pages below the code.
 * @returns {void}
 */
export function renderStatus() {
    const lines = lineCount || 1;
    const bytes = new Blob([state.code]).size;
    const pages = state.pages.length;
    ui.status.textContent = `${lines} lines · ${bytes < KILOBYTE ? bytes + ' B' : (bytes / KILOBYTE).toFixed(1) + ' KB'}${pages ? ` · ${pages} ${pages === 1 ? 'page' : 'pages'}` : ''}`;
}

/**
 * Draws a colored background behind each line of the document's own code with a problem.
 * @returns {void}
 */
export function renderProblemMarks() {
    const code = state.code;
    const ranges = [];
    const seen = new Set();
    for (const problem of state.problems) {
        if (problem.file) continue;
        const lineStart = getLineStart(code, problem.pos);
        if (seen.has(lineStart) || lineStart > code.length) continue;
        seen.add(lineStart);
        let lineEnd = code.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = code.length;
        ranges.push([lineStart, Math.max(lineEnd, lineStart + 1), problem.kind === 'error' ? 'err' : 'warn']);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    let html = '', last = 0;
    for (const [start, end, className] of ranges) {
        if (start < last) continue;
        html += escapeHtml(code.slice(last, start)) + `<mark class="${className}">` + escapeHtml(code.slice(start, end) || ' ') + '</mark>';
        last = end;
    }
    ui.marks.innerHTML = html + escapeHtml(code.slice(last)) + '\n';
}

/**
 * Moves the layers and the line numbers with the textarea's scroll.
 * @returns {void}
 */
export function moveCodeLayers() {
    const offset = `translate(${-ui.ta.scrollLeft}px, ${-ui.ta.scrollTop}px)`;
    ui.hl.style.transform = offset;
    ui.marks.style.transform = offset;
    ui.gutter.style.transform = `translateY(${-ui.ta.scrollTop}px)`;
    showCursorLine();
}

/**
 * Puts the band behind the cursor's line, so the cursor is easy to find; hidden while text is
 * selected.
 * @returns {void}
 */
function showCursorLine() {
    const textarea = ui.ta;
    lineBand.hidden = textarea.selectionStart !== textarea.selectionEnd;
    const lineIndex = getLineIndex(textarea.selectionStart);
    lineBand.style.transform = `translateY(${CODE_PADDING_TOP + areas.lineWrap.getLineTop(lineIndex) - textarea.scrollTop}px)`;
    lineBand.style.height = areas.lineWrap.getLineHeight(lineIndex) + 'px';
}

/**
 * Returns the line a place of the code is on.
 * @param {number} place - the place.
 * @returns {number} the line index, 0-based.
 */
export function getLineIndex(place) {
    let count = 0;
    for (let i = state.code.indexOf('\n'); i >= 0 && i < place; i = state.code.indexOf('\n', i + 1)) count++;
    return count;
}

/**
 * Returns where a line starts; past the last line the end of the code (also for a huge or
 * endless number).
 * @param {number} lineNumber - the line number, 1-based.
 * @returns {number} the place of its first character.
 */
export function getLineStartPlace(lineNumber) {
    let place = 0;
    for (let line = 1; line < lineNumber; line++) {
        const lineEnd = state.code.indexOf('\n', place);
        if (lineEnd < 0) return state.code.length;
        place = lineEnd + 1;
    }
    return place;
}

/**
 * Puts the cursor (or a selection) at a place and scrolls the code there.
 * @param {number} place - where the cursor goes.
 * @param {boolean} [focus] - true to focus the code (not on narrow screens).
 * @param {number} [selectionEnd] - the end of the selection.
 * @returns {void}
 */
export function showCodePosition(place, focus = true, selectionEnd = place) {
    const textarea = ui.ta;
    if (focus && !NARROW_SCREEN.matches) textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(place, selectionEnd);
    const top = areas.lineWrap.getLineTop(getLineIndex(place)), height = textarea.clientHeight;
    if (top < textarea.scrollTop + LINE_HEIGHT * LINES_KEPT_ABOVE || top > textarea.scrollTop + height - LINE_HEIGHT * LINES_KEPT_BELOW) textarea.scrollTop = Math.max(0, top - height / VIEW_LINE_DIVISOR);
    const column = place - getLineStart(state.code, place);
    const x = column * getCharacterWidth();
    if (x < textarea.scrollLeft || x > textarea.scrollLeft + textarea.clientWidth - SCROLL_MARGIN_RIGHT) textarea.scrollLeft = Math.max(0, x - SCROLL_MARGIN_LEFT);
    moveCodeLayers();
}

/**
 * Returns the width of a character of the code's font. A query that fills a cache:
 * it is measured once.
 * @returns {number} the width in pixels.
 */
function getCharacterWidth() {
    if (!characterWidth) {
        const probe = document.createElement('span');
        probe.textContent = 'x'.repeat(MEASURED_CHARACTERS);
        probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
        probe.style.font = getComputedStyle(ui.ta).font;
        document.body.appendChild(probe);
        characterWidth = probe.getBoundingClientRect().width / MEASURED_CHARACTERS;
        probe.remove();
    }
    return characterWidth;
}

/**
 * Reads what is typed into the code: draws the code at once, compiles a little later, makes an
 * undo step when typing pauses and stores the document shortly after.
 * @returns {void}
 */
function readTypedCode() {
    state.code = ui.ta.value;
    renderCode();
    startCompileSoon(state.code.length > LONG_CODE ? LONG_COMPILE_DELAY : COMPILE_DELAY);
    clearTimeout(state.historyTimer);
    state.historyTimer = setTimeout(addHistoryStep, HISTORY_DELAY);
    startSaveSoon();
    areas.sync?.handleChange();
}

/**
 * Creates the band of the cursor's line and follows the cursor while the code has the focus.
 * @returns {void}
 */
export function startCursorLine() {
    lineBand = document.createElement('div');
    lineBand.className = 'line-band';
    lineBand.setAttribute('aria-hidden', 'true');
    ui.marks.before(lineBand);
    document.addEventListener('selectionchange', () => { if (document.activeElement === ui.ta) showCursorLine(); });
}

/**
 * Connects the textarea: typing, scrolling, the cursor's moves and leaving the code.
 * @returns {void}
 */
export function startCodeView() {
    ui.ta.addEventListener('input', readTypedCode);
    ui.ta.addEventListener('scroll', moveCodeLayers);
    ui.ta.addEventListener('click', () => showSourceMark());
    ui.ta.addEventListener('keyup', event => { if (/Arrow|Home|End|Page/.test(event.key)) showSourceMark(); });
    ui.ta.addEventListener('blur', hideSourceMark);
}
