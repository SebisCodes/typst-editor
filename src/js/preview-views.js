/**
 * The two views of a template's pages (?template=): the example view, the template filled with
 * the page's examples (the default), and the template view, the tags shown as their text.
 *
 * getCompileView() picks the view a compile makes:
 *   1. without a template syntax, the code as written;
 *   2. the view chosen; the example view stands back for the template view while its compile
 *      failed for the same code and examples (compile.js notes that with setExampleViewFailed);
 * getCompileInput() then gives the compiler the text of that view with its map and files
 * (typst-examples.js). Saving, the .typ and the ZIP are the code as written; the pictures of the
 * pages are made of the template view (getTemplateCompileView); the PDF and print follow the view
 * shown and name it.
 */

import { areas } from './state.js?v=3';
import { buildViewTitle } from './template-controls.js?v=2';
import { TEMPLATE_SYNTAX } from './typst-template.js?v=1';
import { buildTypstView, EXAMPLE_VIEW, TEMPLATE_VIEW } from './typst-examples.js?v=1';

export { TEMPLATE_SYNTAX, EXAMPLE_VIEW, TEMPLATE_VIEW };

/**
 * The view a compile makes.
 * @typedef {object} CompileView
 * @property {?string} mode - EXAMPLE_VIEW or TEMPLATE_VIEW; null without a template syntax.
 * @property {string} key - tells views apart for the compiler: the mode and the examples' revision.
 * @property {?import('./template-examples.js').TemplateExamples} examples - the page's examples, or null.
 */

/**
 * The state of the views.
 * @typedef {object} ViewState
 * @property {string} mode - the view chosen.
 * @property {?string} failedCode - the code whose example view could not be compiled, or null.
 * @property {?object} failedExamples - the examples it was compiled with.
 */

/** @type {ViewState} */
const views = { mode: EXAMPLE_VIEW, failedCode: null, failedExamples: null };
/** The revision of each examples object, counted as they come. */
const revisions = new WeakMap();
let revisionCount = 0;

/**
 * Returns the view chosen.
 * @returns {string} EXAMPLE_VIEW or TEMPLATE_VIEW.
 */
export function getViewMode() {
    return views.mode;
}

/**
 * Sets the view chosen.
 * @param {string} mode - EXAMPLE_VIEW or TEMPLATE_VIEW.
 * @returns {void}
 */
export function setViewMode(mode) {
    views.mode = mode === TEMPLATE_VIEW ? TEMPLATE_VIEW : EXAMPLE_VIEW;
}

/**
 * Returns the page's examples for the open document.
 * @returns {?import('./template-examples.js').TemplateExamples} the examples, null without a page or away from its document.
 */
export function getTemplateExamples() {
    return areas.sync?.getTemplate() || null;
}

/**
 * Returns the revision of an examples object, given once per object. A query that fills a cache.
 * @param {?object} examples - the examples, or null.
 * @returns {number} the revision, 0 for null.
 */
function getExamplesRevision(examples) {
    if (!examples) return 0;
    if (!revisions.has(examples)) revisions.set(examples, ++revisionCount);
    return revisions.get(examples);
}

/**
 * Notes that the example view of a code could not be compiled with these examples: the template
 * view stands in until the code or the examples change.
 * @param {string} code - the code.
 * @param {?object} examples - the examples it was compiled with.
 * @returns {void}
 */
export function setExampleViewFailed(code, examples) {
    views.failedCode = code;
    views.failedExamples = examples;
}

/**
 * Tells whether the example view of a code failed with the examples of now.
 * @param {string} code - the code.
 * @returns {boolean} true while the template view stands in for it.
 */
export function isExampleViewFailed(code) {
    return Boolean(TEMPLATE_SYNTAX) && views.mode === EXAMPLE_VIEW && views.failedCode === code && views.failedExamples === getTemplateExamples();
}

/**
 * Returns the view a compile of a code makes (the steps in the header).
 * @param {string} code - the code.
 * @returns {CompileView} the view.
 */
export function getCompileView(code) {
    if (!TEMPLATE_SYNTAX) return { mode: null, key: '', examples: null };
    const examples = getTemplateExamples();
    const mode = isExampleViewFailed(code) ? TEMPLATE_VIEW : views.mode;
    return { mode, key: `${mode}:${getExamplesRevision(examples)}`, examples };
}

/**
 * Returns the template view of a code, for the pictures of the pages.
 * @param {string} code - the code.
 * @returns {CompileView} the view; the code as written without a template syntax.
 */
export function getTemplateCompileView(code) {
    if (!TEMPLATE_SYNTAX) return getCompileView(code);
    const examples = getTemplateExamples();
    return { mode: TEMPLATE_VIEW, key: `${TEMPLATE_VIEW}:${getExamplesRevision(examples)}`, examples };
}

/**
 * Returns what the compiler reads for a code, its files and a view: the view's text, its map to
 * the code and the files with the example and placeholder pictures.
 * @param {string} code - the code as written.
 * @param {Object<string, string>} files - the document's files: name -> data URI.
 * @param {CompileView} view - the view.
 * @returns {{code: string, files: Object<string, string>, map: ?import('./template-expansion.js').ViewSegment[]}} the input; the code
 *     and files as they are, without a map, when there is no template syntax.
 */
export function getCompileInput(code, files, view) {
    if (!view || !view.mode) return { code, files, map: null };
    try {
        const built = buildTypstView(code, TEMPLATE_SYNTAX, view.examples, view.mode, files);
        return { code: built.text, files: built.files, map: built.map };
    } catch (error) {
        console.error(error);
        if (view.mode === EXAMPLE_VIEW) setExampleViewFailed(code, view.examples);
        const built = buildTypstView(code, TEMPLATE_SYNTAX, null, TEMPLATE_VIEW, files);
        return { code: built.text, files: built.files, map: built.map };
    }
}

/**
 * Returns the title of a print or PDF of the pages shown: the document's name, with a template
 * syntax followed by the view it shows.
 * @param {string} name - the document's name.
 * @param {string} code - the code the pages were made from.
 * @returns {string} the title, e.g. "Letter (example view)".
 */
export function getViewTitle(name, code) {
    if (!TEMPLATE_SYNTAX) return name;
    return buildViewTitle(name, getCompileView(code).mode, text => areas.i18n?.translate(text) ?? text);
}

/**
 * Returns the title of the pictures of the pages: the name, with a template syntax followed by
 * the template view.
 * @param {string} name - the name.
 * @returns {string} the title, e.g. "2 pages (template view)".
 */
export function getTemplateViewTitle(name) {
    if (!TEMPLATE_SYNTAX) return name;
    return buildViewTitle(name, TEMPLATE_VIEW, text => areas.i18n?.translate(text) ?? text);
}
