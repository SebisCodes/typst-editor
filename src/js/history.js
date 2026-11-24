/**
 * Changing the code and the undo history. Every change of the code but typing (code-view.js)
 * goes through setCode(): the
 * code view is drawn again, the compiler starts, the change becomes an undo step, the document
 * is stored and sync.js hears of it. Typing becomes an undo step when it pauses (code-view.js).
 * Each document keeps its own history while the page is open (documents.js).
 */

import { assets } from './assets.js?v=6';
import { state, ui, areas, getElement, showToast } from './state.js?v=3';
import { renderCode } from './code-view.js?v=4';
import { startCompile } from './compile.js?v=4';
import { saveState } from './storage.js?v=4';
import { renderFilesTab } from './files-tab.js?v=4';

/** The most undo steps kept per document. */
const MAX_HISTORY = 300;

/**
 * Sets the code: the textarea keeps its scroll and cursor, the code view is drawn again and the
 * compiler starts, the change is an undo step (unless history is false), stored and reported
 * to sync.js. Typing still waiting for its undo step gets it first, so Undo after this change
 * goes back to that text.
 * @param {string} code - the new code.
 * @param {object} [options] - how the change is made.
 * @param {boolean} [options.history] - false for a change that is no undo step of its own (Undo, Redo, opening a document).
 * @returns {void}
 */
export function setCode(code, { history = true } = {}) {
    const textarea = ui.ta;
    const scrollTop = textarea.scrollTop, scrollLeft = textarea.scrollLeft, selectionStart = textarea.selectionStart, selectionEnd = textarea.selectionEnd;
    if (history && state.historyTimer) { clearTimeout(state.historyTimer); state.historyTimer = 0; addHistoryStep(); }
    state.code = code;
    if (textarea.value !== code) {
        textarea.value = code;
        textarea.scrollTop = scrollTop;
        textarea.scrollLeft = scrollLeft;
        if (document.activeElement === textarea) textarea.setSelectionRange(Math.min(selectionStart, code.length), Math.min(selectionEnd, code.length));
    }
    renderCode();
    startCompile();
    if (history) addHistoryStep();
    saveState();
    areas.sync?.handleChange();
}

/**
 * Enables Undo and Redo as far as there is something to undo or redo.
 * @returns {void}
 */
export function updateHistoryButtons() {
    const last = state.history[state.history.length - 1];
    getElement('#btn-undo').disabled = !(state.history.length > 1 || (last && last.code !== state.code));
    getElement('#btn-redo').disabled = !state.future.length;
}

/**
 * Makes the current code an undo step; when it is the last step already, only its cursor is
 * updated. A new step clears the redo steps.
 * @returns {void}
 */
export function addHistoryStep() {
    const last = state.history[state.history.length - 1];
    const selection = ui.ta.selectionStart;
    if (last && last.code === state.code) { last.sel = selection; return; }
    state.history.push({ code: state.code, sel: selection });
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future = [];
    updateHistoryButtons();
}

/**
 * Ends the undo step of typing that waits for its pause: the code typed so far becomes a step,
 * so the next change is an undo step of its own.
 * @returns {void}
 */
export function addTypingStep() {
    clearTimeout(state.historyTimer);
    if (state.history[state.history.length - 1]?.code !== state.code) addHistoryStep();
}

/**
 * Renames a file back or forth with the code of an undo step (a rename is one undo step with
 * its references): the file under "from" gets the name "to".
 * @param {string} from - the file's present name.
 * @param {string} to - the name it gets.
 * @returns {void}
 */
function renameFileWithStep(from, to) {
    if (!Object.hasOwn(state.assets, from) || Object.hasOwn(state.assets, to)) return;
    const files = {};
    for (const [name, dataUrl] of Object.entries(state.assets)) files[name === from ? to : name] = dataUrl;
    state.assets = files;
    assets.set(state.fileId, files);
    renderFilesTab();
}

/**
 * Goes back one undo step.
 * @returns {void}
 */
export function undo() {
    addTypingStep();
    if (state.history.length < 2) { showToast('Nothing to undo'); return; }
    const undone = state.history.pop();
    state.future.push(undone);
    if (undone.rename) renameFileWithStep(undone.rename[1], undone.rename[0]);
    const step = state.history[state.history.length - 1];
    setCode(step.code, { history: false });
    if (step.sel != null) ui.ta.setSelectionRange(Math.min(step.sel, state.code.length), Math.min(step.sel, state.code.length));
}

/**
 * Goes forward one undo step.
 * @returns {void}
 */
export function redo() {
    const step = state.future.pop();
    if (!step) { showToast('Nothing to redo'); return; }
    state.history.push(step);
    if (step.rename) renameFileWithStep(step.rename[0], step.rename[1]);
    setCode(step.code, { history: false });
}
