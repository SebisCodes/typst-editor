/**
 * The code a worker compiles, as the editor needs it back: places given as line and column turned
 * into places in the JavaScript string, the syntax tree as flat lists, and the compiler's
 * diagnostics as the editor's problems (worker.js).
 */

let code = '';
/** Where each line of the code starts, for places given as line and column. */
let lineStarts = [0];

/** Code longer than this gets no syntax tree (the text on the pages is then not found in it). */
const MAX_SYNTAX_LENGTH = 400000;
const MAX_MESSAGE_LENGTH = 400;
const MAX_HINT_LENGTH = 300;
/**
 * Some syntax nodes of the tree as the compiler prints it, with their range (line:column~line:column).
 */
const SYNTAX_NODE = /(?:Marked|Escape)::(Text|SmartQuote|Shorthand|Escape|Heading|HeadingMarker|Equation|Raw|Strong|Emph|Link|Ref|Label|ListItem|EnumItem|TermItem)(?:<\/span>)? &lt;(\d+):(\d+)~(\d+):(\d+)&gt;/g;
/** The kinds of plain text in markup: Text, smart Quote, sHorthand, Escape. */
const TEXT_KIND = { Text: 'T', SmartQuote: 'Q', Shorthand: 'H', Escape: 'E' };

/**
 * Sets the code being compiled and notes where each of its lines starts.
 * @param {string} text - the code.
 * @returns {void}
 */
export function setSource(text) {
    code = text;
    lineStarts = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
}

/**
 * Returns the place in the JavaScript string (UTF-16) of a line and column.
 * @param {number} line - the line, 0-based.
 * @param {number} column - the column in code points, 0-based.
 * @returns {number} the place, at most the end of the line.
 */
function getOffset(line, column) {
    const lineStart = lineStarts[Math.min(line, lineStarts.length - 1)] ?? 0;
    let i = lineStart;
    for (let c = 0; c < column && i < code.length && code[i] !== '\n'; c++) i += code.codePointAt(i) > 0xffff ? 2 : 1;
    return i;
}

/**
 * Returns the syntax tree as flat lists: plain text in markup (with smart quotes, shorthands
 * and escapes, for finding the text of the pages in the code), headings, math, and the marks
 * (strong, emph, raw …).
 * @param {function(): string} readTree - returns the compiler's syntax tree of the code as text.
 * @returns {{text: Array<[number, number, string]>, headings: Array<[number, number]>, math: Array<[number, number]>, marks: Array<[number, number, string]>}}
 *   [start, end] in the code of each, with the kind of text or mark; empty for long code.
 */
export function getSyntaxLists(readTree) {
    const lists = { text: [], headings: [], math: [], marks: [] };
    if (code.length > MAX_SYNTAX_LENGTH) return lists;
    let tree = '';
    try { tree = readTree(); } catch (e) { return lists; }
    let match;
    SYNTAX_NODE.lastIndex = 0;
    while ((match = SYNTAX_NODE.exec(tree))) {
        const start = getOffset(+match[2] - 1, +match[3]), end = getOffset(+match[4] - 1, +match[5]);
        const kind = match[1];
        if (TEXT_KIND[kind]) lists.text.push([start, end, TEXT_KIND[kind]]);
        else if (kind === 'Heading') lists.headings.push([start, end]);
        else if (kind === 'Equation') lists.math.push([start, end]);
        else lists.marks.push([start, end, kind]);
    }
    return lists;
}

/**
 * Returns the compiler's diagnostics as the editor's problems, with places, hints and plain
 * messages for missing files and packages.
 * @param {Array<object>|undefined} diagnostics - the compiler's diagnostics.
 * @param {string} main - the path of the compiled code in the compiler's file system.
 * @returns {Array<{kind: string, msg: string, hints: string[], pos: number, end: number, line: number, col: number, file: string}>}
 *   the problems.
 */
export function convertDiagnostics(diagnostics, main) {
    return (diagnostics || []).map(diagnostic => convertDiagnostic(diagnostic, main));
}

/**
 * Returns one diagnostic of the compiler as a problem of the editor.
 * @param {object} diagnostic - the compiler's diagnostic.
 * @param {string} main - the path of the compiled code in the compiler's file system.
 * @returns {{kind: string, msg: string, hints: string[], pos: number, end: number, line: number, col: number, file: string}}
 *   the problem.
 */
function convertDiagnostic(diagnostic, main) {
    const [, line1, column1, line2, column2] = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(diagnostic.range || '') || [0, 0, 0, 0, 0];
    const inMain = !diagnostic.package && diagnostic.path === main;
    const pos = inMain ? getOffset(+line1, +column1) : 0, end = inMain ? getOffset(+line2, +column2) : 0;
    const { msg, hints } = getMessage(diagnostic, inMain ? code.slice(pos, end) : '');
    return {
        kind: diagnostic.severity === 'warning' ? 'warning' : 'error',
        msg: msg.slice(0, MAX_MESSAGE_LENGTH), hints: hints.map(hint => hint.slice(0, MAX_HINT_LENGTH)),
        pos, end, line: +line1 + 1, col: +column1 + 1, file: inMain ? '' : (diagnostic.package ? diagnostic.package + ' ' : '') + String(diagnostic.path || '').replace(/^\//, ''),
    };
}

/**
 * Returns the message and hints of a diagnostic; a missing file or package gets a plain message.
 * @param {object} diagnostic - the compiler's diagnostic.
 * @param {string} literal - the code it points at.
 * @returns {{msg: string, hints: string[]}} the message and the hints.
 */
function getMessage(diagnostic, literal) {
    const parts = String(diagnostic.message || '').split(', hints: ');
    const message = parts.shift();
    if (/^failed to load file/.test(message)) {
        const name = (/^"([^"]*)"$/.exec(literal) || [])[1];
        return { msg: name ? `file not found: ${name}` : 'a file of the document is missing', hints: ['add it in the Pictures tab'] };
    }
    if (/^failed to load package/.test(message)) {
        const spec = (/^"(@[^"]*)"$/.exec(literal) || [])[1];
        return { msg: `packages from Typst Universe are not downloaded${spec ? ': ' + spec : ''}`, hints: ['add the package\'s .typ files to the document (Pictures tab) and import them by file name'] };
    }
    return { msg: message, hints: parts };
}
