/**
 * The editor's side of the compiler worker (worker.js): one compile at a time, the newest code
 * wins; the document's files are sent only when they are new or changed. A compile that runs
 * longer than 20 seconds (an endless loop in the document) or crashes the compiler ends the
 * worker, and a new one starts.
 *
 * A request for a PDF waits until the code it is for has been compiled with exactly its
 * files; a newer PDF request takes the place of one still waiting, and both are answered with
 * the newer PDF.
 */

import { getDataUrlBytes } from './assets.js?v=6';

/** The longest a compile may take, in milliseconds. */
const TIME_LIMIT = 20000;
const WORKER_URL = './worker.js?v=5';

/**
 * What the worker returns for a compile (worker.js), or a crash.
 * @typedef {object} CompileResult
 * @property {string|null} [svg] - the pages as one SVG, null when the code has errors.
 * @property {Array<{w: number, h: number}>} [pages] - the size of each page in points.
 * @property {Array<object>} [problems] - the compiler's problems.
 * @property {object} [ast] - the syntax tree's lists.
 * @property {number} [ms] - how long the compile took.
 * @property {boolean} [crashed] - true when the worker crashed or took too long.
 * @property {string} [error] - why, when it crashed.
 */

/**
 * A request to the worker.
 * @typedef {object} CompileRequest
 * @property {number} id - its number.
 * @property {string} code - the Typst code.
 * @property {Object<string, string>} files - the document's files: name -> data URI.
 * @property {string} doc - the document's id.
 * @property {boolean} [pdf] - true for a PDF.
 * @property {number[]} [also] - the older PDF requests this one answers too.
 * @property {boolean} [silent] - true for the compile that comes before a PDF.
 */

/**
 * What createCompiler() gets.
 * @typedef {object} CompilerHandlers
 * @property {function(CompileResult, CompileRequest|null): void} onResult - a compile is done (or crashed).
 * @property {function(string, string=): void} onState - "loading", "ready" or "failed" with the error.
 */

/**
 * The compiler as the editor sees it.
 * @typedef {object} Compiler
 * @property {function(string, Object<string, string>, string): void} startCompileJob - compiles code with the files of a document.
 * @property {function(string, Object<string, string>, string): Promise<Uint8Array>} exportPdf - the PDF of the code.
 * @property {function(): boolean} isReady - true once the compiler has started.
 * @property {function(): string} getFailure - why the compiler could not start, "" when it could.
 */

/**
 * The worker's answer to a PDF request.
 * @typedef {object} PdfAnswer
 * @property {number} id - the request it answers.
 * @property {Uint8Array} [pdf] - the PDF.
 * @property {string} [error] - why there is none.
 */

/**
 * Creates the compiler and starts its worker.
 * @param {CompilerHandlers} handlers - what runs when a compile is done and when the state changes.
 * @returns {Compiler} the compiler.
 */
export function createCompiler({ onResult, onState }) {
    let worker = null, ready = false, failure = '';
    /** The request in the worker. */
    let running = null;
    /** The newest request waiting. */
    let next = null;
    /** The files the worker has: name -> data URI. */
    let sentFiles = new Map();
    let sentDocument = null;
    let watchTimer = 0, requestCount = 0;
    const pdfWaiters = new Map();
    let lastCode = null;

    startWorker();

    return {
        /**
         * Compiles code with the files of a document; a PDF still waiting goes first.
         * @param {string} code - the Typst code.
         * @param {Object<string, string>} files - the document's files: name -> data URI.
         * @param {string} doc - the document's id.
         * @returns {void}
         */
        startCompileJob(code, files, doc) {
            if (next && next.pdf) return;
            next = { id: ++requestCount, code, files, doc };
            sendNextRequest();
        },
        /**
         * Makes the PDF of code, compiled first when needed. A command that returns a Promise
         * so the caller can wait for the PDF.
         * @param {string} code - the Typst code.
         * @param {Object<string, string>} files - the document's files: name -> data URI.
         * @param {string} doc - the document's id.
         * @returns {Promise<Uint8Array>} the PDF.
         * @throws {Error} when the compiler cannot start or the code has errors (the Promise rejects).
         */
        exportPdf(code, files, doc) {
            return new Promise((resolve, reject) => {
                if (failure) { reject(new Error(failure)); return; }
                const id = ++requestCount;
                pdfWaiters.set(id, { resolve, reject });
                // A PDF still waiting is made from the newest code: its requests are answered with it.
                const also = next && next.pdf ? [...(next.also || []), next.id] : [];
                next = { id, code, files, doc, pdf: true, also };
                sendNextRequest();
            });
        },
        /**
         * Tells whether the compiler is ready for code.
         * @returns {boolean} true once the worker has loaded the compiler.
         */
        isReady: () => ready,
        /**
         * Returns why the compiler could not start.
         * @returns {string} the error, empty while nothing failed.
         */
        getFailure: () => failure,
    };

    /**
     * Starts a worker with an empty file system.
     * @returns {void}
     */
    function startWorker() {
        ready = false;
        sentFiles = new Map();
        sentDocument = null;
        lastCode = null;
        onState('loading');
        worker = new Worker(new URL(WORKER_URL, import.meta.url), { type: 'module' });
        worker.onmessage = receiveWorkerMessage;
        worker.onerror = setFailureOnError;
    }

    /**
     * Passes a message of the worker on to handleMessage (the worker's message handler).
     * @param {MessageEvent} event - the worker's message.
     * @returns {void}
     */
    function receiveWorkerMessage(event) {
        handleMessage(event.data || {});
    }

    /**
     * Notes that the worker failed to load the compiler (the worker's error handler).
     * @param {ErrorEvent} event - the worker's error.
     * @returns {void}
     */
    function setFailureOnError(event) {
        event.preventDefault?.();
        setFailure(event.message || 'the compiler could not be loaded');
    }

    /**
     * Notes that the compiler could not start.
     * @param {string} error - why.
     * @returns {void}
     */
    function setFailure(error) {
        failure = error;
        ready = false;
        onState('failed', error);
    }

    /**
     * Ends the worker after a crash or a compile that took too long, answers what waited with
     * the error, and starts a new worker.
     * @param {string} error - why.
     * @returns {void}
     */
    function startWorkerAnew(error) {
        clearTimeout(watchTimer);
        try { worker.terminate(); } catch (e) { /* gone already */ }
        const request = running;
        running = null;
        for (const [, waiter] of pdfWaiters) waiter.reject(new Error(error));
        pdfWaiters.clear();
        if (request) onResult({ crashed: true, error }, request);
        startWorker();
    }

    /**
     * Routes a message of the worker (a message handler).
     * @param {object} message - the worker's message: ready, failed, crashed, pdf or result.
     * @returns {void}
     */
    function handleMessage(message) {
        if (message.type === 'ready') { ready = true; failure = ''; onState('ready'); sendNextRequest(); return; }
        if (message.type === 'failed') { setFailure(message.error); return; }
        if (message.type === 'crashed') { startWorkerAnew(message.error || 'the compiler stopped'); return; }
        if (message.type === 'pdf') { receivePdf(message); return; }
        if (message.type === 'result') {
            clearTimeout(watchTimer);
            const request = running;
            running = null;
            onResult(message, request);
            sendNextRequest();
        }
    }

    /**
     * Answers every request the PDF stands for (a newer request took the place of older ones)
     * and sends the next request.
     * @param {PdfAnswer} message - the worker's answer.
     * @returns {void}
     */
    function receivePdf(message) {
        clearTimeout(watchTimer);
        const ids = [message.id, ...((running && running.id === message.id && running.also) || [])];
        running = null;
        for (const id of ids) {
            const waiter = pdfWaiters.get(id);
            pdfWaiters.delete(id);
            if (waiter) { if (message.pdf) waiter.resolve(message.pdf); else waiter.reject(new Error(message.error || 'no PDF')); }
        }
        sendNextRequest();
    }

    /**
     * Returns what the worker needs of a document's files: the new or changed ones as bytes,
     * the names it has that are gone, and whether it forgets all files first (another document).
     * @param {CompileRequest} request - the request.
     * @returns {{files: Object<string, Uint8Array>, removed: string[], reset: boolean, known: Map<string, string>}}
     *   the message parts, and the files the worker has after it.
     */
    function getPayload(request) {
        const files = {}, removed = [];
        const reset = sentDocument !== request.doc;
        const known = reset ? new Map() : new Map(sentFiles);
        for (const [name, dataUrl] of Object.entries(request.files || {})) {
            if (known.get(name) === dataUrl) continue;
            try { files[name] = getDataUrlBytes(dataUrl); } catch (e) { continue; }
            known.set(name, dataUrl);
        }
        for (const name of [...known.keys()]) if (!(name in (request.files || {}))) { removed.push(name); known.delete(name); }
        return { files, removed, reset, known };
    }

    /**
     * Sends a compile of a request's code with its changed files.
     * @param {number} id - the number the worker answers with.
     * @param {CompileRequest} request - the request.
     * @returns {void}
     */
    function sendCompile(id, request) {
        const { files, removed, reset, known } = getPayload(request);
        sentFiles = known;
        sentDocument = request.doc;
        worker.postMessage({ type: 'compile', id, code: request.code, files, removed, reset });
        lastCode = request.code;
    }

    /**
     * Tells whether the worker has a request's files exactly.
     * @param {CompileRequest} request - the request.
     * @returns {boolean} true when it has the same document and the same files.
     */
    function hasSameFiles(request) {
        const files = Object.entries(request.files || {});
        return sentDocument === request.doc && files.length === sentFiles.size && files.every(([name, dataUrl]) => sentFiles.get(name) === dataUrl);
    }

    /**
     * Sends the request that waits, when the worker is ready and free. A PDF is made right away
     * when the worker has its code with exactly its files; else that code is compiled first and
     * the PDF request waits for it. A watch restarts the worker after the time limit.
     * @returns {void}
     */
    function sendNextRequest() {
        if (!ready || running || !next) return;
        const request = next;
        next = null;
        running = request;
        if (!request.pdf) sendCompile(request.id, request);
        else if (lastCode !== request.code || !hasSameFiles(request)) {
            next = request;
            running = { ...request, pdf: false, silent: true, id: ++requestCount };
            sendCompile(running.id, request);
        } else worker.postMessage({ type: 'pdf', id: request.id });
        clearTimeout(watchTimer);
        watchTimer = setTimeout(() => startWorkerAnew('the compiler took longer than 20 seconds (an endless loop?) and was restarted'), TIME_LIMIT);
    }
}
