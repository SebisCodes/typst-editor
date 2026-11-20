/**
 * The Typst compiler and the SVG renderer (typst.ts, WebAssembly) in a worker, so typing stays
 * smooth while a document is compiled.
 *
 * Messages from the editor (compiler.js):
 *   { type: "compile", id, code, files: { name: bytes }, removed: [names], reset }
 *       compiles code as /main.typ; files are the document's pictures and data files, given to
 *       the compiler's file system as /<name>; reset first forgets every file (another
 *       document was opened).
 *   { type: "pdf", id }   the PDF of the last compiled code
 * Answers:
 *   { type: "ready" } once, { type: "result", id, svg, pages, problems, ast, ms },
 *   { type: "pdf", id, pdf } or { type: "pdf", id, error }, { type: "crashed", id, error } when
 *   the compiler fails, and { type: "failed", error } when the compiler cannot start.
 *
 * The fonts in src/fonts are announced with their metrics (fonts.json) and loaded only when a
 * document uses them. Packages from Typst Universe are not downloaded: such an import is
 * reported as a problem.
 *
 * Steps of a compile:
 *   1. forget the files after a reset, take the new and removed ones, the document's fonts too;
 *   2. compile the code, read its problems and its syntax tree (worker-source.js);
 *   3. render the pages as SVG and measure them.
 */

import initCompiler, { TypstCompilerBuilder, TypstFontResolverBuilder } from '../vendor/typst/typst_ts_web_compiler.mjs?v=0.7.0';
import initRenderer, { TypstRendererBuilder, CreateSessionOptions } from '../vendor/typst/typst_ts_renderer.mjs?v=0.7.0';
import { setSource, getSyntaxLists, convertDiagnostics } from './worker-source.js?v=3';

const SOURCE_FOLDER = new URL('../', import.meta.url);
const MAIN = '/main.typ';
const FONT_VERSION = '?v=0.14.2';
const MAX_ERROR_LENGTH = 300;
/** How many bytes of a font make its fingerprint. */
const FINGERPRINT_SAMPLES = 4096;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
/** The artifact kinds of the compiler: pages for the renderer, and a PDF. */
const ARTIFACT_PAGES = 0;
const ARTIFACT_PDF = 1;
/** Report problems as structured diagnostics. */
const DIAGNOSTICS_FULL = 3;

/**
 * The answer to a compile message.
 * @typedef {object} CompileAnswer
 * @property {string} type - "result".
 * @property {number} id - the message it answers.
 * @property {Array<object>} problems - the problems.
 * @property {object} ast - the syntax tree's lists.
 * @property {string|null} svg - the pages as SVG, null when the code has errors.
 * @property {Array<object>} pages - the size of each page in points (w, h).
 * @property {number} [ms] - how long the compile took.
 */

let compiler = null, renderer = null, fonts = [];
const fontBytes = new Map();
/** The names of the document's own fonts in the font book, as a key. */
let documentFontsKey = '';
/** The document's own font files: name -> bytes. */
const documentFonts = new Map();
/** The compiler's access model: files the document asks for but does not have are reported as a problem. */
const ACCESS_CONTEXT = {};
const ACCESS_MODEL = [
    () => 0,
    () => true,
    path => path,
    path => { throw new Error('not found: ' + path); },
];

/**
 * The compiler's builder first makes stand-in file and package functions from source text
 * (new Function), which the page's CSP does not allow (no 'unsafe-eval'); the access model
 * above takes their place right away. While the builder is made, those known bodies get plain
 * functions, and any other source text is refused as the CSP would.
 */
const STAND_INS = {
    'return 0': () => () => 0,
    'return true': () => () => true,
    'path\u0000return path': () => path => path,
};

const compilerReady = startCompiler().then(() => postMessage({ type: 'ready' }), error => { postMessage({ type: 'failed', error: String(error && error.message || error) }); throw error; });
onmessage = handleMessage;

/**
 * Returns the bytes of a font file, loaded the first time the compiler needs it (a worker may
 * load synchronously). A query that fills a cache.
 * @param {string} file - the font's file name in src/fonts.
 * @returns {Uint8Array} the bytes.
 * @throws {Error} when the file is not there.
 */
function getFontBytes(file) {
    if (fontBytes.has(file)) return fontBytes.get(file);
    const request = new XMLHttpRequest();
    request.open('GET', new URL('fonts/' + file + FONT_VERSION, SOURCE_FOLDER).href, false);
    request.responseType = 'arraybuffer';
    request.send();
    if (request.status !== 200) throw new Error('font ' + file + ' not found');
    const bytes = new Uint8Array(request.response);
    fontBytes.set(file, bytes);
    return bytes;
}

/**
 * Runs a function while new Function gives plain functions for the known stand-in bodies and
 * refuses any other source text.
 * @param {function(): *} run - the function.
 * @returns {*} what it returns.
 */
function runWithoutEval(run) {
    const real = self.Function;
    self.Function = new Proxy(real, {
        /**
         * Returns the function for a stand-in body (the construct trap of the Proxy).
         * @param {Function} target - the real Function.
         * @param {Array<*>} args - the parameter names and the body.
         * @returns {Function} the plain function.
         * @throws {EvalError} for any other source text.
         */
        construct(target, args) {
            const key = args.map(String).join('\u0000');
            if (STAND_INS[key]) return STAND_INS[key]();
            if (/^throw new Error\('Dummy [A-Za-z]+, please initialize/.test(key)) return () => { throw new Error('not set up'); };
            throw new EvalError('code from text is not run');
        },
    });
    try { return run(); } finally { self.Function = real; }
}

/**
 * Starts the compiler and the renderer: loads both WebAssembly modules and the font metrics,
 * and announces the fonts.
 * @returns {Promise<void>} settles when both are ready.
 */
async function startCompiler() {
    await initCompiler({ module_or_path: new URL('vendor/typst/typst_ts_web_compiler_bg.wasm?v=0.7.0', SOURCE_FOLDER) });
    await initRenderer({ module_or_path: new URL('vendor/typst/typst_ts_renderer_bg.wasm?v=0.7.0', SOURCE_FOLDER) });
    fonts = await (await fetch(new URL('fonts/fonts.json?v=1', SOURCE_FOLDER))).json();
    const builder = runWithoutEval(() => new TypstCompilerBuilder());
    await builder.set_access_model(ACCESS_CONTEXT, ...ACCESS_MODEL);
    await builder.set_package_registry(ACCESS_CONTEXT, () => { throw new Error('packages are not downloaded'); });
    for (const font of fonts) await builder.add_lazy_font(font.info, () => getFontBytes(font.file));
    compiler = await builder.build();
    renderer = await new TypstRendererBuilder().build();
}

/**
 * Tells whether a file of the document is a font.
 * @param {string} name - the file name.
 * @returns {boolean} true for .otf, .ttf and .ttc files.
 */
function isFont(name) {
    return /\.(otf|ttf|ttc)$/i.test(name);
}

/**
 * Returns a cheap fingerprint of a font's bytes (4096 bytes spread over it): another font of
 * the same size differs.
 * @param {Uint8Array} bytes - the font's bytes.
 * @returns {string} the fingerprint.
 */
function getFingerprint(bytes) {
    let hash = FNV_OFFSET;
    const step = Math.max(1, Math.floor(bytes.length / FINGERPRINT_SAMPLES));
    for (let i = 0; i < bytes.length; i += step) hash = Math.imul(hash ^ bytes[i], FNV_PRIME);
    return (hash >>> 0).toString(36);
}

/**
 * Gives the compiler the document's own fonts next to the shipped ones, when they changed.
 * @returns {Promise<void>} settles when the compiler has them.
 */
async function updateDocumentFonts() {
    const own = [...documentFonts];
    const key = own.map(([name, bytes]) => name + ':' + bytes.length + ':' + getFingerprint(bytes)).join('|');
    if (key === documentFontsKey) return;
    documentFontsKey = key;
    const resolver = new TypstFontResolverBuilder();
    for (const font of fonts) resolver.add_lazy_font(font.info, () => getFontBytes(font.file));
    for (const [, bytes] of own) { try { resolver.add_raw_font(bytes); } catch (e) { /* not a font the compiler can read */ } }
    compiler.set_fonts(await resolver.build());
}

/**
 * Gives the compiler a compile message's files and code: removed files out, new ones in.
 * @param {object} message - the compile message.
 * @returns {void}
 */
function updateCompilerSource(message) {
    for (const name of message.removed || []) { try { compiler.unmap_shadow('/' + name); } catch (e) { /* it was not there */ } }
    for (const [name, bytes] of Object.entries(message.files || {})) compiler.map_shadow('/' + name, bytes);
    setSource(message.code);
    compiler.add_source(MAIN, message.code);
}

/**
 * Compiles the code the compiler holds and renders the pages.
 * @param {object} message - the compile message, for its id.
 * @returns {CompileAnswer} the result for the editor.
 */
function getCompileAnswer(message) {
    const startTime = performance.now();
    const world = compiler.snapshot(null, MAIN, null);
    let artifact;
    try { artifact = world.get_artifact(ARTIFACT_PAGES, DIAGNOSTICS_FULL) || {}; } finally { world.free(); }
    const result = { type: 'result', id: message.id, problems: convertDiagnostics(artifact.diagnostics, MAIN), ast: getSyntaxLists(() => compiler.get_ast(MAIN)), svg: null, pages: [] };
    if (artifact.result) renderPages(artifact.result, result);
    result.ms = Math.round(performance.now() - startTime);
    return result;
}

/**
 * Renders the compiled document as SVG and notes the size of each page.
 * @param {*} content - the compiler's artifact for the renderer.
 * @param {CompileAnswer} result - the result to fill.
 * @returns {void}
 */
function renderPages(content, result) {
    const options = new CreateSessionOptions();
    options.format = 'vector';
    options.artifact_content = content;
    const session = renderer.create_session(options);
    try {
        result.svg = renderer.svg_data(session);
        const pagesInfo = session.pages_info;
        for (let i = 0; i < pagesInfo.page_count; i++) { const page = pagesInfo.page(i); result.pages.push({ w: page.width_pt, h: page.height_pt }); }
    } finally { session.free(); }
}

/**
 * Returns the PDF of the last compiled code.
 * @param {object} message - the pdf message.
 * @returns {{type: string, id: number, pdf?: Uint8Array, error?: string}} the answer for the editor.
 */
function exportPdf(message) {
    const world = compiler.snapshot(null, MAIN, null);
    try {
        const artifact = world.get_artifact(ARTIFACT_PDF, DIAGNOSTICS_FULL) || {};
        if (!artifact.result) return { type: 'pdf', id: message.id, error: 'the document has errors - see the problems above the code' };
        return { type: 'pdf', id: message.id, pdf: artifact.result };
    } finally { world.free(); }
}

/**
 * Answers a message of the editor once the compiler is ready (the worker's message handler); a
 * failure inside the compiler is reported, and the editor starts a new worker.
 * @param {MessageEvent} event - the editor's message.
 * @returns {Promise<void>} settles when the answer is sent.
 */
async function handleMessage(event) {
    const message = event.data || {};
    try { await compilerReady; } catch (err) { return; }
    try {
        if (message.type === 'compile') {
            if (message.reset) { compiler.reset_shadow(); documentFonts.clear(); }
            for (const name of message.removed || []) documentFonts.delete(name);
            for (const [name, bytes] of Object.entries(message.files || {})) if (isFont(name)) documentFonts.set(name, bytes);
            await updateDocumentFonts();
            updateCompilerSource(message);
            postMessage(getCompileAnswer(message));
        } else if (message.type === 'pdf') {
            const answer = exportPdf(message);
            postMessage(answer, answer.pdf ? [answer.pdf.buffer] : []);
        }
    } catch (err) {
        postMessage({ type: 'crashed', id: message.id, error: String(err && err.message || err).slice(0, MAX_ERROR_LENGTH) });
    }
}
