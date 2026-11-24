/**
 * Adding code at the cursor: markup around the selection (the toolbar and Ctrl+B, I, U, M) and
 * the snippets of the toolbar and of the Insert tab. In a snippet "|" marks where the cursor
 * goes and "§" stands for the selected text; block snippets start on a line of their own.
 * Math snippets outside math go into $…$.
 */

import { findSetRule, getCodeWithArgument, formatString } from './typst-rules.js?v=3';
import { state, ui, getElements, getLineStart } from './state.js?v=3';
import { addHistoryStep } from './history.js?v=7';
import { setCodeRange } from './typing.js?v=7';
import { showSourceMark } from './source-mark.js?v=7';
import { getFileKind } from './document-files.js?v=7';
import { setSettingCode } from './settings-panel.js?v=7';

/** The markup that goes around the selection, by kind. */
const WRAPS = { strong: ['*', '*'], emph: ['_', '_'], underline: ['#underline[', ']'], raw: ['`', '`'], math: ['$', '$'] };
const CURSOR = '|';
const SELECTION = '§';
/** The snippets by key: [code, true for a block]. */
const SNIPPETS = {
    h1: ['= |§', true], h2: ['== |§', true], h3: ['=== |§', true],
    list: ['- |§\n- ', true], enum: ['+ |§\n+ ', true], terms: ['/ |Term: Explanation', true],
    table: ['#figure(\n  table(\n    columns: 3,\n    table.header[*|Left*][*Center*][*Right*],\n    [1], [2], [3],\n    [4], [5], [6],\n  ),\n  caption: [Caption],\n) <tab:name>', true],
    figure: ['#figure(\n  image("|example.png", width: 60%),\n  caption: [Caption],\n) <fig:name>', true],
    columns: ['#columns(2)[\n  |Left column\n  #colbreak()\n  Right column\n]', true],
    quote: ['#quote(block: true)[\n  |§\n]', true], center: ['#align(center)[\n  |§\n]', true],
    code: ['```python\n|§\n```', true], outline: ['#outline()\n|', true], title: ['#title()\n|', true],
    pagebreak: ['#pagebreak()\n|', true], vspace: ['#v(1cm)\n|', true],
    bibliography: ['#bibliography("|refs.bib")', true],
    footnote: ['#footnote[|§]', false], link: ['#link("https://|")[§]', false], label: ['<|>', false], ref: ['@|', false],
    color: ['#text(fill: blue)[|§]', false], highlight: ['#highlight[|§]', false], box: ['#box(fill: yellow, inset: 4pt)[|§]', false],
    cite: ['@|', false], hfill: ['#h(1fr) |', false],
    'inline-math': ['$|§$', false], display: ['$ |§ $', true],
    equation: ['$ |§ $ <eq:name>', true], align: ['$ a &= |b \\\\\n  c &= d $', true],
    frac: ['(|§)/()', false], sqrt: ['sqrt(|§)', false], sup: ['^(|§)', false], sub: ['_(|§)', false],
    sum: ['sum_(i=1)^n |', false], int: ['integral_a^b | dif x', false], lim: ['lim_(x -> oo) |', false],
    matrix: ['mat(|a, b; c, d)', false], cases: ['f(x) = cases(|1 "if" x > 0, 0 "otherwise")', false],
};
/** The snippets that are math. */
const MATH_SNIPPETS = new Set(['frac', 'sqrt', 'sup', 'sub', 'sum', 'int', 'lim', 'matrix', 'cases']);

/**
 * Puts markup around the selection (*selection*, _selection_, #underline[selection] …), as one
 * undo step; without a selection the cursor lands inside.
 * @param {string} kind - "strong", "emph", "underline", "raw" or "math".
 * @returns {void}
 */
export function addMarkup(kind) {
    const [open, close] = WRAPS[kind];
    const start = ui.ta.selectionStart, end = ui.ta.selectionEnd;
    const selected = state.code.slice(start, end);
    setCodeRange(start, end, open + selected + close, start + open.length, start + open.length + selected.length);
    addHistoryStep();
}

/**
 * Adds a snippet at the cursor (without a cursor in the code: at the end, after a blank line),
 * as one undo step, and frames the place on the page.
 * @param {string} text - the snippet, with "|" for the cursor and "§" for the selected text.
 * @param {boolean} [block] - true to put it on a line of its own, indented like the line.
 * @returns {void}
 */
export function addSnippet(text, block = false) {
    let start = ui.ta.selectionStart, end = ui.ta.selectionEnd;
    if (document.activeElement !== ui.ta && start === 0 && end === 0) {
        start = end = state.code.replace(/\s*$/, '').length;
        if (start) { text = '\n\n' + text; block = false; }
    }
    let snippet = text.replace(SELECTION, state.code.slice(start, end) || '');
    if (block) snippet = formatBlock(snippet, start, end);
    let cursor = snippet.indexOf(CURSOR);
    snippet = snippet.replace(CURSOR, '');
    if (cursor < 0) cursor = snippet.length;
    setCodeRange(start, end, snippet, start + cursor);
    addHistoryStep();
    showSourceMark();
}

/**
 * Returns a block snippet for its place: every line after the first indented like the line of
 * the cursor, a line break before it when text stands before the cursor, and after it when
 * text follows the selection on its line.
 * @param {string} snippet - the snippet.
 * @param {number} start - where it goes.
 * @param {number} end - the end of the selection it replaces.
 * @returns {string} the snippet with its line breaks and indentation.
 */
function formatBlock(snippet, start, end) {
    const code = state.code;
    const lineStart = getLineStart(code, start);
    const indent = /^[ \t]*/.exec(code.slice(lineStart))[0];
    let block = snippet.split('\n').map((line, index) => (index ? indent + line : line)).join('\n');
    if (code.slice(lineStart, start).trim()) block = '\n' + indent + block;
    const lineEnd = code.indexOf('\n', end);
    if (code.slice(end, lineEnd < 0 ? code.length : lineEnd).trim()) block += '\n' + indent;
    return block;
}

/**
 * Tells whether a place is inside math ($…$).
 * @param {number} place - the place in the code.
 * @returns {boolean} true inside a formula of the syntax tree, or after an odd number of unescaped $.
 */
export function isInMath(place) {
    return state.ast.math.some(([start, end]) => start < place && place < end) || (state.code.slice(0, place).replace(/\\\$/g, '').match(/\$/g) || []).length % 2 === 1;
}

/**
 * Adds a snippet by its key: a figure shows the document's first picture, math outside math
 * goes into $…$, and a numbered equation sets the numbering of equations when the code has none.
 * @param {string} key - the snippet's key.
 * @returns {void}
 */
export function addSnippetByKey(key) {
    const [code, block] = SNIPPETS[key];
    let text = code;
    const pictures = Object.keys(state.assets).filter(name => getFileKind(name) === 'image');
    if (key === 'figure' && pictures.length) text = code.replace('|example.png', '|' + pictures[0]);
    if (MATH_SNIPPETS.has(key) && !isInMath(ui.ta.selectionStart)) text = '$' + text + '$';
    addSnippet(text, block);
    if (key === 'equation' && !findSetRule(state.code, 'math.equation')) setSettingCode(getCodeWithArgument(state.code, 'math.equation', 'numbering', formatString('(1)')), false);
}

/**
 * Connects the markup and snippet buttons of the toolbar; they keep the cursor in the code
 * (a press would move the focus).
 * @returns {void}
 */
export function startToolbar() {
    getElements('[data-wrap], [data-snippet]').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
    getElements('[data-wrap]').forEach(button => button.addEventListener('click', () => addMarkup(button.dataset.wrap)));
    getElements('[data-snippet]').forEach(button => button.addEventListener('click', () => addSnippetByKey(button.dataset.snippet)));
}
