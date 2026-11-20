/**
 * The editor's state and the parts every module shares: the open document's code and what the
 * compiler made of it, its files, the pages, the undo history, the page elements, the areas set
 * up at start (line wrap, "My documents", sync …) and a few small helpers.
 *
 * The code is the single source of truth: the pages, the problems, the outline and the
 * document settings are made from it; every change goes through setCode() (history.js), typing
 * sets the code itself (code-view.js).
 *
 * The field names code, name, fileId, assets, problems, outline, pages, sizes, runs and zoom
 * are read by the tests through window.typstEditor.state.
 */

/** The prefix of the storage keys and messages. */
export const PREFIX = 'typsteditor';
/** The width below which the editor shows one view at a time. */
export const NARROW_SCREEN = matchMedia('(max-width: 860px)');
/** The height of a line of code in pixels. */
export const LINE_HEIGHT = 20;
/** CSS pixels per point. */
export const PIXELS_PER_POINT = 96 / 72;
/** Points per millimeter. */
export const POINTS_PER_MILLIMETER = 72 / 25.4;
/** The name of a document without one. */
export const DEFAULT_NAME = 'Document';
/** The name of a new document from an AI without one. */
export const AI_DOCUMENT_NAME = 'AI document';
/** The fields that take typing: shortcuts of the page wait while one of them has the focus. */
export const TYPING_FIELDS = 'textarea, select, [contenteditable], input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=button])';
/** How long a toast stays, in milliseconds. */
const TOAST_TIME = 2600;
let toastTimer = 0;

/**
 * A step of the undo history.
 * @typedef {object} HistoryStep
 * @property {string} code - the code.
 * @property {number} sel - the cursor in the code.
 * @property {string[]} [rename] - [old name, new name] of a file renamed with this step.
 */

/**
 * A problem the compiler found (worker.js).
 * @typedef {object} Problem
 * @property {string} kind - "error" or "warning".
 * @property {string} msg - the message.
 * @property {string[]} hints - the compiler's hints.
 * @property {number} pos - where it starts in the code.
 * @property {number} end - where it ends.
 * @property {number} line - its line, 1-based.
 * @property {number} col - its column, 1-based.
 * @property {string} file - the file it is in, "" for the document's own code.
 */

/**
 * The syntax tree as flat lists of [start, end] in the code (worker.js).
 * @typedef {object} SyntaxLists
 * @property {Array<[number, number, string]>} text - plain markup text with its kind: T text, Q smart quote, H shorthand, E escape.
 * @property {Array<[number, number]>} headings - the headings.
 * @property {Array<[number, number]>} math - the formulas.
 * @property {Array<[number, number, string]>} marks - strong, emph, raw and other parts with their kind.
 */

/**
 * A run of text on a page and, when it is found in the code, its place there (text-runs.js).
 * @typedef {object} TextRun
 * @property {Element} element - the run's .typst-text group on the page.
 * @property {number} page - the index of its page.
 * @property {string} text - its text as the page shows it.
 * @property {number} lead - how many spaces it starts with.
 * @property {string} core - its text without spaces at both ends (and without a hyphen at a line's end).
 * @property {number|null} start - where it starts in the code, null when it is not found.
 * @property {number|null} end - where it ends in the code.
 * @property {number[]|null} places - for each character of core (and its end) the place in the code.
 * @property {boolean} editable - true when it can be edited on the page.
 */

/**
 * The editor's state.
 * @typedef {object} EditorState
 * @property {string} code - the open document's code.
 * @property {string|null} compiledCode - the code the pages and problems were made from.
 * @property {Problem[]} problems - the compiler's problems.
 * @property {SyntaxLists} ast - the syntax tree of the compiled code.
 * @property {import('./typst-code.js').OutlineHeading[]} outline - the headings.
 * @property {HTMLElement[]} pages - the page elements (.sheet).
 * @property {Array<{w: number, h: number}>} sizes - the size of each page in points.
 * @property {TextRun[]} runs - the text runs of the pages in page order.
 * @property {TextRun[]} sourceRuns - the runs found in the code, in code order.
 * @property {string} defs - the shared SVG definitions of the pages (glyphs).
 * @property {string} pagesFileId - the id of the document the pages belong to.
 * @property {number} zoom - the zoom of the pages.
 * @property {string|null} fit - "width" or "page" to fit the pages, null for a zoom of its own.
 * @property {number} split - the share of the width the code takes.
 * @property {string} name - the document's name.
 * @property {string} fileId - the document's id in "My documents", "" for none.
 * @property {Object<string, string>} assets - the document's pictures and files: name -> data URI.
 * @property {HistoryStep[]} history - the undo steps; the last one is the current code.
 * @property {HistoryStep[]} future - the redo steps.
 * @property {number} historyTimer - the timer that makes an undo step of typing.
 * @property {boolean} showProblems - true when the list of problems is open.
 * @property {TextRun|null} markedRun - the run framed on the page for the code cursor.
 * @property {string} compilerState - "loading", "ready" or "failed".
 * @property {number} compileMs - how long the last compile took.
 * @property {string|null} savedCode - the code as this tab last read or stored it.
 */

/** @type {EditorState} */
export const state = {
    code: '', compiledCode: null, problems: [], ast: { text: [], headings: [], math: [], marks: [] }, outline: [],
    pages: [], sizes: [], runs: [], sourceRuns: [], defs: '', pagesFileId: '',
    zoom: 1, fit: 'width',
    split: 0.5,
    name: DEFAULT_NAME, fileId: '', assets: {},
    history: [], future: [], historyTimer: 0,
    showProblems: true, markedRun: null, compilerState: 'loading', compileMs: 0,
    savedCode: null,
};

/**
 * Returns the first element that matches a selector.
 * @param {string} selector - the CSS selector.
 * @param {ParentNode} [root] - where to search.
 * @returns {Element|null} the element.
 */
export function getElement(selector, root = document) {
    return root.querySelector(selector);
}

/**
 * Returns every element that matches a selector.
 * @param {string} selector - the CSS selector.
 * @param {ParentNode} [root] - where to search.
 * @returns {Element[]} the elements.
 */
export function getElements(selector, root = document) {
    return [...root.querySelectorAll(selector)];
}

/** The elements of the page the modules work with. */
export const ui = {
    ta: getElement('#code'), hl: getElement('#hl'), marks: getElement('#marks'), gutter: getElement('#gutter'),
    status: getElement('#code-status'), error: getElement('#code-error'),
    stage: getElement('#stage'), scroller: getElement('#scroller'), pages: getElement('#pages'), hint: getElement('#hint'),
    zoomLabel: getElement('#zoom-label'), pageLabel: getElement('#page-label'),
    inspector: getElement('#inspector-body'), insert: getElement('#insert-wrap'), tree: getElement('#tree'),
    pictures: getElement('#pics-wrap'), work: getElement('#work'), toast: getElement('#toast'),
};

/**
 * The areas set up at start; each is null until it is.
 * @type {{i18n: object|null, lineWrap: object|null, compiler: object|null, files: object|null, sync: object|null, ai: object|null, aiStatus: object|null}}
 */
export const areas = { i18n: null, lineWrap: null, compiler: null, files: null, sync: null, ai: null, aiStatus: null };

/**
 * Shows a short message at the bottom of the editor.
 * @param {string} message - the message.
 * @returns {void}
 */
export function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('shown'), TOAST_TIME);
}

/**
 * Returns a number limited to a range.
 * @param {number} value - the number.
 * @param {number} min - the smallest value.
 * @param {number} max - the largest value.
 * @returns {number} the number within [min, max].
 */
export function getNumberInRange(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Returns where the line of a place starts.
 * @param {string} code - the code.
 * @param {number} place - the place.
 * @returns {number} the place after the line break before it, 0 on the first line.
 */
export function getLineStart(code, place) {
    return code.lastIndexOf('\n', place - 1) + 1;
}

/**
 * Tells whether the pages show the code as it is (no compile is waiting).
 * @returns {boolean} true when the code has been compiled as it is.
 */
export function isCompiled() {
    return state.compiledCode === state.code;
}
