/**
 * The Outline tab: the headings of the document, indented by level. A click puts the code's
 * cursor on the heading and scrolls the pages to its text.
 */

import { escapeHtml } from './typst.js?v=8';
import { state, ui, NARROW_SCREEN } from './state.js?v=3';
import { showCodePosition } from './code-view.js?v=7';
import { updatePageLabel } from './zoom.js?v=7';
import { showSourceMark } from './source-mark.js?v=7';
import { showPane } from './layout.js?v=7';

/** The space left above a heading scrolled into view, in pixels. */
const HEADING_TOP_SPACE = 30;

/**
 * Draws the outline, or a hint when the document has no headings.
 * @returns {void}
 */
export function renderOutline() {
    const outline = state.outline;
    if (!outline.length) { ui.tree.innerHTML = '<li class="muted" style="padding:8px">No headings yet - add one with = Heading.</li>'; return; }
    ui.tree.innerHTML = outline.map(heading => `<li class="lv${heading.level}"><button type="button" class="choice" style="--t:${Math.max(0, heading.level - 1)}" data-pos="${heading.pos}" data-no-i18n><span>${escapeHtml(heading.title)}</span></button></li>`).join('');
}

/**
 * Shows a clicked heading in the code and on the pages (a click handler).
 * @param {MouseEvent} event - the click.
 * @returns {void}
 */
function showHeadingOnClick(event) {
    const button = event.target.closest('[data-pos]');
    if (!button) return;
    const place = +button.dataset.pos;
    if (NARROW_SCREEN.matches) showPane('draw');
    showCodePosition(place, !NARROW_SCREEN.matches);
    const run = (state.sourceRuns || []).find(item => item.start >= place);
    if (run) requestAnimationFrame(() => showRunAtTop(run));
}

/**
 * Scrolls the pages so that a run is near the top, and frames it.
 * @param {import('./state.js').TextRun} run - the run.
 * @returns {void}
 */
function showRunAtTop(run) {
    const view = ui.scroller.getBoundingClientRect();
    ui.scroller.scrollTop += run.element.getBoundingClientRect().top - view.top - HEADING_TOP_SPACE;
    updatePageLabel();
    showSourceMark(false, true);
}

/**
 * Connects clicks on the headings.
 * @returns {void}
 */
export function startOutline() {
    ui.tree.addEventListener('click', showHeadingOnClick);
}
