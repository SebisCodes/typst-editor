/**
 * The compiler's problems above the code: the number of errors and warnings, and a list with
 * line, column, message and hints that can be hidden. A problem in the list leads to its place
 * in the code.
 */

import { escapeHtml } from './typst.js?v=8';
import { state, ui, NARROW_SCREEN } from './state.js?v=3';
import { showCodePosition } from './code-view.js?v=5';
import { showSourceMark } from './source-mark.js?v=5';
import { showPane } from './layout.js?v=5';

/** The most problems the list shows. */
const MAX_LISTED_PROBLEMS = 60;

/**
 * Draws the problems above the code, or hides the box when there are none.
 * @returns {void}
 */
export function renderProblems() {
    const problems = state.problems;
    const box = ui.error;
    if (!problems.length) { box.hidden = true; return; }
    const errors = problems.filter(problem => problem.kind === 'error').length, warnings = problems.length - errors;
    const parts = [];
    if (errors) parts.push(`<b>${errors} ${errors === 1 ? 'error' : 'errors'}</b>`);
    if (warnings) parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
    const items = problems.slice(0, MAX_LISTED_PROBLEMS).map(formatProblem).join('');
    box.innerHTML = `<div class="pr-header"><span>${parts.join(' · ')}</span><button type="button" class="button small" data-toggle-probs>${state.showProblems ? 'Hide' : 'Show'}</button></div>${state.showProblems ? `<ul>${items}</ul>` : ''}`;
    box.classList.toggle('only-warnings', !errors);
    box.hidden = false;
}

/**
 * Returns the list item of a problem: its kind, file, line and column, message and hints.
 * @param {import('./state.js').Problem} problem - the problem.
 * @param {number} index - its index in the problems.
 * @returns {string} the HTML of the item.
 */
function formatProblem(problem, index) {
    return `<li class="${problem.kind === 'error' ? 'err' : 'warn'}"><div class="pr-row" role="button" tabindex="0" data-prob="${index}"><span class="kind">${problem.kind === 'error' ? '✕' : '!'}</span><span class="line-number">${problem.file ? `<span data-no-i18n>${escapeHtml(problem.file)}</span> ` : ''}Line ${problem.line}, column ${problem.col}</span><span class="pr-text">${problem.isEditorText ? `<span>${escapeHtml(problem.msg)}</span>` : `<span data-no-i18n>${escapeHtml(problem.msg)}</span>`}${problem.hints.map(hint => `<span class="pr-hint">Hint: <span data-no-i18n>${escapeHtml(hint)}</span></span>`).join('')}</span></div></li>`;
}

/**
 * Runs a click in the problems: Hide / Show, or a problem's place in the code (a click handler);
 * a click that ends a selection of the text is left alone.
 * @param {MouseEvent} event - the click.
 * @returns {void}
 */
function showProblemOnClick(event) {
    if (event.target.closest('[data-prob]') && String(getSelection())) return;
    if (event.target.closest('[data-toggle-probs]')) { state.showProblems = !state.showProblems; renderProblems(); return; }
    const row = event.target.closest('[data-prob]');
    if (!row) return;
    const problem = state.problems[+row.dataset.prob];
    if (NARROW_SCREEN.matches) showPane('code');
    showCodePosition(Math.min(problem.pos, state.code.length), true, Math.min(Math.max(problem.end, problem.pos), state.code.length));
    showSourceMark();
}

/**
 * Connects the problems: Enter and Space on a problem work like a click.
 * @returns {void}
 */
export function startProblems() {
    ui.error.addEventListener('keydown', event => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-prob]')) { event.preventDefault(); event.target.click(); }
    });
    ui.error.addEventListener('click', showProblemOnClick);
}
