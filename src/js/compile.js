/**
 * Compiling the open document and showing what the compiler returns: the pages, the problems,
 * the outline, the document settings and the frame of the code cursor's text.
 *
 * The compiler (compiler.js) runs one compile at a time; a result is shown only for the
 * document that is open, and when the code changed meanwhile it is compiled again. A crash
 * keeps the last good pages, dimmed, with the error as the problem.
 *
 * With template placeholders (?template=) the compiler reads the text of the view chosen
 * (preview-views.js): the example view, or the template view with the tags as their text. A
 * compile of the example view with errors is made again in the template view, which the pages
 * then show with a note. The result is led back to the code (typst-examples.js), and the
 * problems of the placeholders join the compiler's.
 */

import { createCompiler } from './compiler.js?v=7';
import { state, ui, areas } from './state.js?v=3';
import { renderStatus, renderProblemMarks } from './code-view.js?v=5';
import { showPages } from './pages.js?v=5';
import { updateRuns } from './text-runs.js?v=4';
import { showSourceMark } from './source-mark.js?v=5';
import { renderProblems } from './problems.js?v=5';
import { renderFilesTab } from './files-tab.js?v=5';
import { renderOutline } from './outline.js?v=5';
import { renderSettingsPanel } from './settings-panel.js?v=5';
import { TEMPLATE_SYNTAX, getTemplateProblems } from './typst-template.js?v=1';
import { getCompileInput, getCompileView, setExampleViewFailed, EXAMPLE_VIEW } from './preview-views.js?v=1';
import { convertCompileResult } from './typst-examples.js?v=1';
import { renderTemplateControls } from './template-panel.js?v=2';

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
    areas.compiler = createCompiler({ onState: showCompilerState, onResult: showCompileResult, getCompileInput });
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
 * waited for it go on when it is a result of the code and view of now, and else compiles again.
 * @param {import('./compiler.js').CompileResult} result - the result.
 * @param {import('./compiler.js').CompileRequest|null} request - the request it answers.
 * @returns {void}
 */
function showCompileResult(result, request) {
    if (!request || request.doc !== state.fileId) return;
    if (isExampleCompileFailed(result, request)) {
        setExampleViewFailed(request.code, request.view.examples);
        if (state.code === request.code) { startCompile(); return; }
    } else if (result.crashed) {
        state.problems = [createProblem(result.error)];
        state.compiledCode = request.code;
        state.compiledViewKey = getViewKey(request);
        ui.stage.classList.add('stale');
    } else showResult(result, request);
    const isCurrent = state.code === request.code && getCompileView(state.code).key === getViewKey(request);
    if (isCurrent) { afterCompile.forEach(resolve => resolve()); afterCompile.length = 0; }
    else startCompileSoon(RECOMPILE_DELAY);
}

/**
 * Tells whether a compile of the example view gave no pages (errors), so the template view is
 * compiled in its place.
 * @param {import('./compiler.js').CompileResult} result - the result.
 * @param {import('./compiler.js').CompileRequest} request - the request it answers.
 * @returns {boolean} true for an example view without pages.
 */
function isExampleCompileFailed(result, request) {
    return !result.crashed && !result.svg && request.view?.mode === EXAMPLE_VIEW;
}

/**
 * Returns the key of the view a request was compiled for.
 * @param {import('./compiler.js').CompileRequest} request - the request.
 * @returns {string} the key, "" for the code as written.
 */
function getViewKey(request) {
    return request.view ? request.view.key : '';
}

/**
 * Waits until the code as it is has been compiled. A command that returns a Promise so the
 * caller can wait: it starts a compile when one is needed.
 * @returns {Promise<void>} settles once the code has been compiled.
 */
export function waitForCompile() {
    return new Promise(resolve => {
        if (state.compiledCode === state.code && state.compiledViewKey === getCompileView(state.code).key) resolve();
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
    areas.compiler.startCompileJob(state.code, state.assets, state.fileId, getCompileView(state.code));
}

/**
 * Returns the problems of a compile result in the code, with the problems of the template
 * placeholders in the order of the code.
 * @param {import('./state.js').Problem[]} problems - the compiler's problems at their places in the code.
 * @param {string} code - the code it was made from.
 * @returns {import('./state.js').Problem[]} the problems.
 */
function getProblems(problems, code) {
    const templateProblems = getTemplateProblems(code, TEMPLATE_SYNTAX);
    if (!templateProblems.length) return problems;
    return [...problems, ...templateProblems].sort((first, second) => first.pos - second.pos);
}

/**
 * Notes the text the compiler read for a request and leads the result back to the code: the
 * problems, the syntax lists and the outline.
 * @param {import('./compiler.js').CompileResult} result - the result.
 * @param {import('./compiler.js').CompileRequest} request - the request it answers.
 * @returns {void}
 */
function setCompiledView(result, request) {
    const input = request.input || { code: request.code, map: null };
    state.compiledCode = request.code;
    state.compiledViewKey = getViewKey(request);
    state.viewText = input.code;
    state.viewMap = input.map;
    state.viewAst = result.ast || state.viewAst;
    const converted = convertCompileResult({ problems: result.problems, ast: state.viewAst }, state.viewText, state.viewMap, request.code);
    state.problems = getProblems(converted.problems, request.code);
    state.ast = converted.ast;
    state.outline = converted.outline;
}

/**
 * Shows a compile result: the pages (an error keeps the last good pages, dimmed), the text runs
 * found in the code, the problems, the status, the files tab when open, the outline, the
 * document settings, the template's controls and the frame of the code cursor's text.
 * @param {import('./compiler.js').CompileResult} result - the result.
 * @param {import('./compiler.js').CompileRequest} request - the request it answers.
 * @returns {void}
 */
function showResult(result, request) {
    setCompiledView(result, request);
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
    renderTemplateControls(Boolean(result.svg));
    showSourceMark(false);
}
