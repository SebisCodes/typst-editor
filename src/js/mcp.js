/**
 * WebMCP: the editor offers its functions as tools to an AI agent that runs in the browser
 * (document.modelContext, in Chrome as an early preview). The tools run in this page only -
 * no server, no connector. Browsers without WebMCP skip this. Every change is a normal undo
 * step.
 *
 * The text tools work on the open document; list_files, open_file and new_file reach the
 * user's other documents ("My documents"). The tool names, descriptions and parameters are the
 * contract with the agents and stay as they are.
 *
 * createMcp() runs these steps:
 *   1. find WebMCP; without it, return null;
 *   2. wrap every tool so a call notes its time and tells the editor;
 *   3. register the tools;
 *   4. return { last() }, when an agent last used a tool (for the AI status in aistatus.js).
 */

/** The characters of an ISO time stamp list_files shows, YYYY-MM-DDTHH:MM. */
const STAMP_LENGTH = 16;

/**
 * What the editor hands to createMcp(); the functions throw an Error with a message for
 * the agent when a call cannot be done.
 * @typedef {object} McpEditor
 * @property {function(): void} [onUse] - a tool was called.
 * @property {function(): object} getState - what the agent sees: name, sel, pictures and code.
 * @property {function(): Promise<Array<{line: number, kind: string, msg: string}>>} getProblems - the
 *   compiler's problems once the code as it is has been compiled.
 * @property {function(): Array<{level: number, title: string, line: number}>} getOutline - the headings.
 * @property {function(): Array<{name: string, updated: number, open: boolean}>} getFiles - the documents.
 * @property {function(string): boolean} openFileByName - opens a document by name; false when there is none.
 * @property {function(string, string): (string|null)} createFile - makes and opens a document; its name, null when storage is full.
 * @property {function(string, string, object): Promise<void>} receiveDocument - takes a whole document.
 * @property {function(string, string): boolean} addCode - adds Typst code at the end, the cursor or after a heading; false when the heading is missing.
 * @property {function(string, string, boolean): number} updateText - replaces exact text (every match, or the
 *   first); returns how many times it did.
 * @property {function(number): void} showLine - shows a line of the code.
 * @property {function(): void} undo - undoes the last change.
 */

/**
 * What createMcp() returns, read by the AI status.
 * @typedef {object} McpStatus
 * @property {function(): number} last - when an agent last used a tool (milliseconds since 1970), 0 for never.
 */

/**
 * Registers the editor's WebMCP tools (an initializeX: it returns the status object).
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {McpStatus|null} the status, null without WebMCP.
 */
export function createMcp(editor) {
    const modelContext = document.modelContext || navigator.modelContext;
    if (!modelContext || typeof modelContext.registerTool !== 'function') return null;
    let lastCall = 0;
    for (const tool of createTools(editor)) {
        const run = tool.execute;
        /**
         * Notes the agent's call for the AI status, then runs the tool (the tool's execute).
         * @param {...*} args - the tool's arguments from the agent.
         * @returns {Promise<*>} the tool's answer, passed on unchanged.
         */
        const runTool = async (...args) => { lastCall = Date.now(); editor.onUse?.(); return run(...args); };
        tool.execute = runTool;
        addTool(modelContext, tool);
    }
    /**
     * Returns when an agent last used a tool (McpStatus.last).
     * @returns {number} milliseconds since 1970, 0 for never.
     */
    const getLastCall = () => lastCall;
    return { last: getLastCall };
}

/**
 * Registers one tool; a tool the browser refuses is left out.
 * @param {object} modelContext - the browser's WebMCP object.
 * @param {object} tool - the tool.
 * @returns {void}
 */
function addTool(modelContext, tool) {
    try {
        const result = modelContext.registerTool(tool);
        if (result && typeof result.catch === 'function') result.catch(() => { /* not available on this page */ });
    } catch (e) { /* the browser refused this tool */ }
}

/**
 * Creates the tools with their descriptions, input schemas and functions.
 * @param {McpEditor} editor - what the tools need of the editor.
 * @returns {object[]} the tools in the order they are registered.
 */
function createTools(editor) {
    return [
        {
            name: 'get_document',
            description: 'Returns the name and the Typst code of the document open in the editor, the selected text and the pictures and files it can use.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: getDocument,
        },
        {
            name: 'get_problems',
            description: 'Lists the errors and warnings of the Typst compiler for the document, with line numbers and hints.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
            execute: getProblems,
        },
        {
            name: 'list_sections',
            description: 'Lists the headings of the document (level, title, line).',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: getSectionList,
        },
        {
            name: 'set_document',
            description: 'Replaces the whole open document with new Typst code (it must compile with Typst 0.14; no packages from Typst Universe). Keep the user\'s existing work unless asked otherwise.',
            inputSchema: { type: 'object', properties: { typst: { type: 'string', description: 'The complete Typst code.' } }, required: ['typst'] },
            execute: setDocument,
        },
        {
            name: 'insert_text',
            description: 'Inserts Typst code into the open document: at the end, at the cursor, or right after the heading with the given title.',
            inputSchema: {
                type: 'object',
                properties: {
                    typst: { type: 'string', description: 'The Typst code to insert.' },
                    where: { type: 'string', description: '"end" (default), "cursor", or the title of a heading to insert after it.' },
                },
                required: ['typst'],
            },
            execute: addText,
        },
        {
            name: 'replace_text',
            description: 'Replaces an exact piece of the Typst code with new text (the first match, or every match with all=true).',
            inputSchema: {
                type: 'object',
                properties: {
                    find: { type: 'string', description: 'The exact text to find in the code.' },
                    replace: { type: 'string', description: 'The new text.' },
                    all: { type: 'boolean', description: 'Replace every match.' },
                },
                required: ['find', 'replace'],
            },
            execute: setText,
        },
        {
            name: 'show_line',
            description: 'Moves the cursor to a line of the code and shows that place on the pages, so the user sees it.',
            inputSchema: { type: 'object', properties: { line: { type: 'number', description: 'Line number (1 = first line).' } }, required: ['line'] },
            execute: showLine,
        },
        {
            name: 'list_files',
            description: 'Lists the user\'s documents stored in the editor ("My documents"), most recently changed first, and which one is open.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: getFileList,
        },
        {
            name: 'open_file',
            description: 'Opens one of the user\'s documents by name; the other tools then work on it.',
            inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'The name from list_files.' } }, required: ['name'] },
            execute: openFile,
        },
        {
            name: 'new_file',
            description: 'Creates a new document and opens it; the user\'s other documents stay unchanged. Without typst it starts from an empty A4 page.',
            inputSchema: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'A short name for the document.' },
                    typst: { type: 'string', description: 'Optional: the complete Typst code.' },
                },
                required: ['name'],
            },
            execute: createFile,
        },
        {
            name: 'undo',
            description: 'Undoes the last change in the editor.',
            inputSchema: { type: 'object', properties: {} },
            execute: undo,
        },
    ];

    /**
     * get_document: the open document, the selection and its files.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function getDocument() {
        const state = editor.getState();
        return `Document: "${state.name}"\n${state.sel ? `Selected: ${state.sel}\n` : ''}${state.pictures.length ? `Files: ${state.pictures.join(', ')}\n` : ''}\n${state.code}`;
    }

    /**
     * get_problems: the problems with their lines.
     * @returns {Promise<string>} one problem per line, or "No problems.".
     */
    async function getProblems() {
        const problems = await editor.getProblems();
        return problems.length ? problems.map(problem => `line ${problem.line} (${problem.kind}): ${problem.msg}`).join('\n') : 'No problems.';
    }

    /**
     * list_sections: the headings, indented by level, with their lines.
     * @returns {Promise<string>} one heading per line, or a note that there are none.
     */
    async function getSectionList() {
        const outline = editor.getOutline();
        return outline.length ? outline.map(heading => `${'  '.repeat(Math.max(0, heading.level - 1))}${heading.num ? heading.num + ' ' : ''}${heading.title} (line ${heading.line})`).join('\n') : 'The document has no headings.';
    }

    /**
     * set_document: a whole new code for the open document.
     * @param {object} input - the tool's input.
     * @param {string} input.typst - the complete Typst code.
     * @returns {Promise<string>} the answer for the agent, once the code is compiled.
     * @throws {Error} when the code is empty.
     */
    async function setDocument({ typst }) {
        if (!String(typst || '').trim()) throw new Error('The document is empty.');
        await editor.receiveDocument(typst, 'replace', { direct: true });
        const errors = (await editor.getProblems()).filter(problem => problem.kind === 'error');
        return errors.length ? `Loaded, with ${errors.length} error(s) - see get_problems.` : 'The document is in the editor.';
    }

    /**
     * insert_text: Typst code at the end, at the cursor or after a heading.
     * @param {object} input - the tool's input.
     * @param {string} input.typst - the Typst code.
     * @param {string} [input.where] - "end", "cursor" or a heading's title.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when there is no such heading.
     */
    async function addText({ typst, where }) {
        if (!editor.addCode(String(typst || ''), String(where || 'end'))) throw new Error(`No heading "${where}" - call list_sections.`);
        return 'Inserted.';
    }

    /**
     * replace_text: an exact piece of the code replaced.
     * @param {object} input - the tool's input.
     * @param {string} input.find - the text.
     * @param {string} input.replace - its replacement.
     * @param {boolean} [input.all] - true for every match.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when the text is not found.
     */
    async function setText({ find, replace, all }) {
        const count = editor.updateText(String(find || ''), String(replace ?? ''), !!all);
        if (!count) throw new Error('The text was not found - call get_document to see the exact code.');
        return `Replaced ${count} time${count === 1 ? '' : 's'}.`;
    }

    /**
     * show_line: the cursor on a line, shown on the pages.
     * @param {object} input - the tool's input.
     * @param {number} input.line - the line number.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function showLine({ line }) {
        editor.showLine(Math.max(1, Math.round(+line || 1)));
        return `Showing line ${line}.`;
    }

    /**
     * list_files: the user's documents, the open one marked.
     * @returns {Promise<string>} one document per line.
     */
    async function getFileList() {
        return editor.getFiles().map(file => `${file.open ? '* ' : '  '}"${file.name}" (changed ${new Date(file.updated).toISOString().slice(0, STAMP_LENGTH).replace('T', ' ')})`).join('\n') + '\n(* = open now)';
    }

    /**
     * open_file: one of the user's documents.
     * @param {object} input - the tool's input.
     * @param {string} input.name - the document's name.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when there is no document of that name.
     */
    async function openFile({ name }) {
        if (!editor.openFileByName(name)) throw new Error(`No document "${name}" - call list_files.`);
        return `"${name}" is open.`;
    }

    /**
     * new_file: a new document, opened.
     * @param {object} input - the tool's input.
     * @param {string} input.name - its name.
     * @param {string} [input.typst] - its code.
     * @returns {Promise<string>} the answer for the agent.
     * @throws {Error} when the browser storage is full.
     */
    async function createFile({ name, typst }) {
        const createdName = editor.createFile(name, typst);
        if (!createdName) throw new Error('The browser storage is full.');
        return `New document "${createdName}" is open.`;
    }

    /**
     * undo: the last change undone.
     * @returns {Promise<string>} the answer for the agent.
     */
    async function undo() {
        editor.undo();
        return 'Undone.';
    }
}
