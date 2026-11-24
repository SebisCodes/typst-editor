/**
 * The controls of template placeholders (?template=) in the Typst editor: the switch between the
 * example view and the template view in the bar of the pages, the note when the example view could
 * not be made, and the "Placeholders" box at the bottom of the code (template-controls.js).
 * Without a template syntax none of them is there.
 */

import { state, ui, getElement } from './state.js?v=3';
import { setCodeRange } from './typing.js?v=6';
import { addHistoryStep } from './history.js?v=6';
import { startCompile } from './compile.js?v=6';
import { startViewSwitch, showViewSwitch, showViewNote, createPlaceholderBox, getListedPlaceholders } from './template-controls.js?v=2';
import { TEMPLATE_SYNTAX, getViewMode, setViewMode, isExampleViewFailed, getTemplateExamples } from './preview-views.js?v=1';

/** The box, once connected. */
let placeholderBox = null;
/** What the box lists: the examples it was drawn for, or the document's tags. */
let listedKey = null;

/**
 * Connects the switch of the views and the box; without a template syntax nothing.
 * @returns {void}
 */
export function startTemplateControls() {
    if (!TEMPLATE_SYNTAX) return;
    startViewSwitch(getElement('#view-switch'), showChosenView);
    placeholderBox = createPlaceholderBox(getElement('#placeholder-box'), {
        syntax: TEMPLATE_SYNTAX, textarea: ui.ta,
        insertText: editCodeText,
    });
}

/**
 * Puts a text into the code as one undo step, with the selection given (the box's insertion).
 * @param {number} start - where the replaced stretch starts in the code.
 * @param {number} end - where it ends.
 * @param {string} text - the text put in its place.
 * @param {number} selectionStart - where the selection starts afterwards.
 * @param {number} selectionEnd - where it ends afterwards.
 * @returns {void}
 */
function editCodeText(start, end, text, selectionStart, selectionEnd) {
    setCodeRange(start, end, text, selectionStart, selectionEnd);
    addHistoryStep();
}

/**
 * Shows a view chosen with the switch.
 * @param {string} mode - EXAMPLE_VIEW or TEMPLATE_VIEW.
 * @returns {void}
 */
function showChosenView(mode) {
    setViewMode(mode);
    startCompile();
}

/**
 * Shows the view chosen, the note when the example view could not be made (only while the
 * template view in its place has pages), and the placeholders in the box: the page's list, else
 * the tags of the document.
 * @param {boolean} hasPages - true when the last compile gave pages.
 * @returns {void}
 */
export function renderTemplateControls(hasPages) {
    if (!placeholderBox) return;
    showViewSwitch(getElement('#view-switch'), getViewMode());
    showViewNote(getElement('#view-note'), hasPages && isExampleViewFailed(state.compiledCode));
    const listed = getListedPlaceholders(getTemplateExamples(), state.code, TEMPLATE_SYNTAX);
    if (listed.key === listedKey) return;
    listedKey = listed.key;
    placeholderBox.render(listed.placeholders);
}

/**
 * Takes the page's template placeholders as they come: the box lists them at once, and the pages
 * are compiled with them; a template that comes with a document (or before it) shows in the box
 * from the first paint.
 * @returns {void}
 */
export function updateTemplateView() {
    renderTemplateControls(state.pages.length > 0 && state.pagesFileId === state.fileId);
    startCompile();
}
