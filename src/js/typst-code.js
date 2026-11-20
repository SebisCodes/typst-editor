/**
 * Reading Typst code without the compiler: the code with comments and strings blanked out, the
 * end of a bracket or a "#" expression, the files the code reads, the blocks of the markup and
 * the outline. The document settings (typst-rules.js) and moving pictures (typst-pictures.js)
 * build on these.
 */

/** The functions that read a file of the document by its name. */
const FILE_FUNCTIONS = 'image|read|csv|json|yaml|toml|xml|cbor|bibliography|plugin';
/** Keywords after # that take the rest of their line (definitions and control flow). */
export const STATEMENTS = new Set('let set show import include if for while context return'.split(' '));
const BRACKET_PAIRS = { '(': ')', '[': ']', '{': '}' };
const NAME = /^[\p{L}_][\p{L}\p{N}_-]*/u;
/** How far ahead a name is looked for. */
const NAME_LOOK_AHEAD = 80;

/**
 * A file the code reads.
 * @typedef {object} FileReference
 * @property {string} name - the file's name, without "./" or "/" at its start.
 * @property {string} fn - the function or keyword that reads it ("image", "csv", "import" …).
 * @property {number} at - where the call starts.
 * @property {number} nameAt - where the name starts in the code (after its quote).
 * @property {number} len - the length of the name as written.
 */

/**
 * A block of the markup at the top level.
 * @typedef {object} CodeBlock
 * @property {number} a - where it starts.
 * @property {number} b - where it ends (without white space at its end).
 * @property {string} kind - "heading", "item", "code" or "text".
 */

/**
 * A heading of the outline.
 * @typedef {object} OutlineHeading
 * @property {number} level - its level, 1 for "=".
 * @property {string} title - its text without markers, label and escapes.
 * @property {number} pos - where it starts in the code.
 */

/**
 * Returns the code with comments and escapes (and strings, unless strings is false) blanked
 * out, at the same length, so that searches find nothing inside them.
 * @param {string} code - the Typst code.
 * @param {boolean} [strings] - false to keep the strings.
 * @returns {string} the blanked code: comments and escapes as spaces (line breaks kept), strings as "  ".
 */
export function getBlankedCode(code, strings = true) {
    let out = '', i = 0;
    const n = code.length;
    while (i < n) {
        const c = code[i];
        if (c === '/' && code[i + 1] === '/') { const lineEnd = code.indexOf('\n', i); const end = lineEnd < 0 ? n : lineEnd; out += ' '.repeat(end - i); i = end; continue; }
        if (c === '/' && code[i + 1] === '*') { const end = getBlockCommentEnd(code, i); out += code.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
        if (c === '\\') { out += code.slice(i, i + 2).replace(/[^\n]/g, ' '); i += 2; continue; }
        if (strings && c === '"') {
            let k = i + 1;
            while (k < n && code[k] !== '"' && code[k] !== '\n') k += code[k] === '\\' ? 2 : 1;
            k = Math.min(n, k + 1);
            out += '"' + ' '.repeat(Math.max(0, k - i - 2)) + (k - i >= 2 ? '"' : '');
            i = k;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

/**
 * Returns the end of a block comment; block comments nest in Typst: /* a /* b *\/ c *\/ is
 * one comment.
 * @param {string} code - the code.
 * @param {number} start - where the comment's "/*" starts.
 * @returns {number} the place after its last "*\/", the end of the code when it is not closed.
 */
function getBlockCommentEnd(code, start) {
    let end = start + 2, depth = 1;
    while (end < code.length && depth) {
        if (code[end] === '/' && code[end + 1] === '*') { depth++; end += 2; } else if (code[end] === '*' && code[end + 1] === '/') { depth--; end += 2; } else end++;
    }
    return end;
}

/**
 * Returns the end of a bracketed part.
 * @param {string} blanked - the blanked code (getBlankedCode).
 * @param {number} open - the place of "(", "[" or "{".
 * @returns {number} the place of its closing bracket, -1 when it is not closed.
 */
export function getClosingBracket(blanked, open) {
    const stack = [];
    for (let k = open; k < blanked.length; k++) {
        const c = blanked[k];
        if (BRACKET_PAIRS[c]) stack.push(BRACKET_PAIRS[c]);
        else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return k; }
    }
    return -1;
}

/**
 * Returns the end of the expression after "#": a name with its arguments and content blocks, a
 * code or content block, or a statement up to the end of its line (brackets opened on the way
 * included).
 * @param {string} blanked - the blanked code (getBlankedCode).
 * @param {number} hash - the place of "#".
 * @returns {number} the place after the expression.
 */
export function getHashEnd(blanked, hash) {
    let i = hash + 1;
    const name = NAME.exec(blanked.slice(i, i + NAME_LOOK_AHEAD));
    if (name && STATEMENTS.has(name[0])) return getStatementEnd(blanked, i);
    if (name) i += name[0].length;
    else if (blanked[i] === '{') { const close = getClosingBracket(blanked, i); return close < 0 ? blanked.length : close + 1; }
    for (;;) {
        if (blanked[i] === '(' || blanked[i] === '[') { const close = getClosingBracket(blanked, i); if (close < 0) return blanked.length; i = close + 1; continue; }
        const field = blanked[i] === '.' && NAME.exec(blanked.slice(i + 1, i + NAME_LOOK_AHEAD));
        if (field) { i += 1 + field[0].length; continue; }
        return i;
    }
}

/**
 * Returns the end of a statement: its line, with the brackets opened on it.
 * @param {string} blanked - the blanked code.
 * @param {number} start - where the statement's keyword starts.
 * @returns {number} the place of the line break that ends it, or the end of the code.
 */
function getStatementEnd(blanked, start) {
    let i = start;
    while (i < blanked.length && blanked[i] !== '\n') {
        if ('([{'.includes(blanked[i])) { const close = getClosingBracket(blanked, i); if (close < 0) return blanked.length; i = close + 1; } else i++;
    }
    return i;
}

/**
 * Returns the files the code reads: image("…"), read, csv, json, yaml, toml, xml, cbor,
 * bibliography, plugin, and the .typ files it imports or includes; packages (@…) are left out.
 * @param {string} code - the Typst code.
 * @returns {FileReference[]} the references in order.
 */
export function findFileReferences(code) {
    const blanked = getBlankedCode(code, false);
    const references = [];
    const pattern = new RegExp(`(?:\\b(${FILE_FUNCTIONS})(?:\\.decode)?\\s*\\(\\s*|#(import|include)\\s+)"([^"\\n]*)"`, 'g');
    let match;
    while ((match = pattern.exec(blanked))) {
        const name = match[3];
        if (!name || /^@/.test(name)) continue;
        references.push({ name: name.replace(/^\.?\//, ''), fn: match[1] || match[2], at: match.index, nameAt: match.index + match[0].length - 1 - name.length, len: name.length });
    }
    return references;
}

/**
 * Returns the blocks of the markup at the top level: a heading, a list item (with its indented
 * lines), a paragraph, a line that starts with "#" (with the lines its brackets take), display
 * math or raw text. Blank lines and comments separate them.
 * @param {string} code - the Typst code.
 * @returns {CodeBlock[]} the blocks in order.
 */
export function getBlocks(code) {
    const blanked = getBlankedCode(code);
    const blocks = [];
    let p = 0, current = null;
    while (p <= blanked.length) {
        let lineEnd = blanked.indexOf('\n', p);
        if (lineEnd < 0) lineEnd = blanked.length;
        const line = blanked.slice(p, lineEnd), trimmed = line.trim();
        if (!trimmed) { current = null; p = lineEnd + 1; continue; }
        const indent = line.length - line.trimStart().length;
        const kind = /^=+\s/.test(trimmed) ? 'heading' : /^([-+]|\d+\.|\/)(\s|$)/.test(trimmed) ? 'item' : /^[#$`]/.test(trimmed) ? 'code' : 'text';
        const goesOn = current && ((kind === 'text' && current.kind === 'text') || (indent > 0 && current.kind === 'item'));
        if (!goesOn) { current = { a: p + indent, b: 0, kind }; blocks.push(current); }
        lineEnd = getBlockLineEnd(blanked, p, lineEnd);
        current.b = p + blanked.slice(p, lineEnd).trimEnd().length;
        p = lineEnd + 1;
    }
    return blocks;
}

/**
 * Returns where a line of a block ends: brackets, display math and raw text that start on it
 * take the lines they go on over.
 * @param {string} blanked - the blanked code.
 * @param {number} lineStart - where the line starts.
 * @param {number} lineEnd - where it ends without them.
 * @returns {number} the place of the line break that ends it, or the end of the code.
 */
function getBlockLineEnd(blanked, lineStart, lineEnd) {
    for (let k = lineStart; k < lineEnd; k++) {
        let end = -1;
        if (blanked[k] === '#' && /[\p{L}_({[]/u.test(blanked[k + 1] || '')) end = getHashEnd(blanked, k);
        else if (blanked.startsWith('```', k)) { end = blanked.indexOf('```', k + 3); end = end < 0 ? blanked.length : end + 3; }
        else if (blanked[k] === '$') { end = blanked.indexOf('$', k + 1); end = end < 0 ? blanked.length : end + 1; }
        if (end < 0) continue;
        if (end > lineEnd) { lineEnd = blanked.indexOf('\n', end); if (lineEnd < 0) lineEnd = blanked.length; }
        k = end - 1;
    }
    return lineEnd;
}

/**
 * Returns the outline from the headings the syntax tree found.
 * @param {string} code - the Typst code.
 * @param {Array<[number, number]>} headings - [start, end] of each heading in the code.
 * @returns {OutlineHeading[]} the headings in order.
 */
export function getOutline(code, headings) {
    return headings.map(([start, end]) => getOutlineHeading(code, start, end));
}

/**
 * Returns one heading of the outline: its level and its title without label, escapes and markup.
 * @param {string} code - the Typst code.
 * @param {number} start - where the heading starts in the code.
 * @param {number} end - where it ends.
 * @returns {OutlineHeading} the heading.
 */
function getOutlineHeading(code, start, end) {
    const text = code.slice(start, end);
    const marker = /^(=+)\s*/.exec(text) || ['', ''];
    const title = text.slice(marker[0].length).replace(/\s*<[^>]*>\s*$/, '').replace(/\\(.)/g, '$1').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();
    return { level: marker[1].length || 1, title, pos: start };
}
