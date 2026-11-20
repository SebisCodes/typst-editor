/**
 * Compiling the open document and showing what the compiler returns: the pages, the problems,
 * the outline, the document settings and the frame of the code cursor's text.
 *
 * The compiler (compiler.js) runs one compile at a time; a result is shown only for the
 * document that is open, and when the code changed meanwhile it is compiled again. A crash
 * keeps the last good pages, dimmed, with the error as the problem.
 */

import { createCompiler } from './compiler.js?v=6';
import { getOutline } from './typst-code.js?v=3';
import { state, ui, areas } from './state.js?v=2';
import { renderStatus, renderProblemMarks } from './code-view.js?v=3';
import { showPages } from './pages.js?v=3';
import { updateRuns } from './text-runs.js?v=3';
import { showSourceMark } from './source-mark.js?v=3';
import { renderProblems } from './problems.js?v=3';
import { renderFilesTab } from './files-tab.js?v=3';
import { renderOutline } from './outline.js?v=3';
import { renderSettingsPanel } from './settings-panel.js?v=3';

/** How long the compile waits after a change, in milliseconds. */
export const COMPILE_DELAY = 220;
/** How long a compile waits that follows one for older code, in milliseconds. */
const RECOMPILE_DELAY = 120;
/** What runs once the code as it is has been compiled. */
const afterCompile = [];
let compileTimer = 0;

/**
 * Creates the compiler and starts its worker.
 * @returns {void}
 */
export function startCompilerWorker() {
    areas.compiler = createCompiler({ onState: showCompilerState, onResult: showCompileResult });
}

/**
 * Shows the compiler's state: the stage loading, a compile once it is ready, the error when it
 * cannot start.
 * @param {string} compilerState - "loading", "ready" or "failed".
 * @param {string} [error] - why it failed.
 * @returns {void}
 */
function showCompilerState(compilerState, error) {
    state.compilerState = compilerState;
    ui.stage.classList.toggle('loading', compilerState === 'loading');
    if (compilerState === 'ready') startCompile();
    if (compilerState === 'failed') {
        state.problems = [createProblem('The Typst compiler could not be started: ' + error)];
        renderProblems();
    }
}

/**
 * Returns a problem of the whole document at its start.
 * @param {string} message - the message.
 * @returns {import('./state.js').Problem} the problem.
 */
function createProblem(message) {
    return { kind: 'error', msg: message, hints: [], pos: 0, end: 0, line: 1, col: 1, file: '' };
}

/**
 * Shows a result of the compiler for the open document (a crash as its problem), lets what
 * waited for it go on, and compiles again when the code changed meanwhile.
 * @param {import('./compiler.js').CompileResult} result - the result.
 * @param {import('./compiler.js').CompileRequest|null} request - the request it answers.
 * @returns {void}
 */
function showCompileResult(result, request) {
    if (!request || request.doc !== state.fileId) return;
    if (result.crashed) {
        state.problems = [createProblem(result.error)];
        state.compiledCode = request.code;
        ui.stage.classList.add('stale');
    } else showResult(result, request.code);
    afterCompile.forEach(resolve => resolve());
    afterCompile.length = 0;
    if (state.code !== request.code) startCompileSoon(RECOMPILE_DELAY);
}

/**
 * Waits until the code as it is has been compiled. A command that returns a Promise so the
 * caller can wait: it starts a compile when one is needed.
 * @returns {Promise<void>} settles once the code has been compiled.
 */
export function waitForCompile() {
    return new Promise(resolve => {
        if (state.compiledCode === state.code) resolve();
        else { afterCompile.push(resolve); startCompile(); }
    });
}

/**
 * Compiles a moment later; the stage shows that it is computing.
 * @param {number} [delay] - how long to wait, in milliseconds.
 * @returns {void}
 */
export function startCompileSoon(delay = COMPILE_DELAY) {
    clearTimeout(compileTimer);
    ui.stage.classList.add('computing');
    compileTimer = setTimeout(startCompile, delay);
}

/**
 * Compiles the open document's code with its files now.
 * @returns {void}
 */
export function startCompile() {
    clearTimeout(compileTimer);
    if (!state.fileId && state.fileId !== '') return;
    ui.stage.classList.add('computing');
    areas.compiler.startCompileJob(state.code, state.assets, state.fileId);
}

/**
 * Shows a compile result: the pages (an error keeps the last good pages, dimmed), the text runs
 * found in the code, the problems, the status, the files tab when open, the outline, the
 * document settings and the frame of the code cursor's text.
 * @param {import('./compiler.js').CompileResult} result - the result.
 * @param {string} code - the code it was made from.
 * @returns {void}
 */
function showResult(result, code) {
    state.compiledCode = code;
    state.problems = result.problems || [];
    state.ast = result.ast || state.ast;
    state.outline = getOutline(code, state.ast.headings);
    state.compileMs = result.ms || 0;
    ui.stage.classList.remove('computing');
    ui.stage.classList.toggle('stale', !result.svg);
    if (result.svg) {
        try { showPages(result.svg, result.pages); } catch (e) { console.error(e); }
        updateRuns();
    }
    renderProblems();
    renderProblemMarks();
    renderStatus();
    if (!ui.pictures.hidden) renderFilesTab();
    renderOutline();
    renderSettingsPanel();
    showSourceMark(false);
}
