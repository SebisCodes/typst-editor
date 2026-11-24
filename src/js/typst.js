/**
 * Highlighting of Typst code: markup, code (after #), math and raw text, as Typst reads them.
 * Compiling is done by the real Typst compiler (worker.js); reading and changing the code is in
 * typst-code.js, typst-rules.js, typst-text.js and typst-pictures.js.
 *
 * Classes of the spans: k keyword / function, a named argument, s string / raw,
 * e number, label, reference, escape, p punctuation and markers, c comment, d math,
 * h heading text.
 *
 * The reader keeps one position in the code and its steps call each other as the brackets
 * nest, so it stays one closure in one file. The same reader also tells where markup, code,
 * strings, comments, raw text and math start (getCodeContexts), for template placeholders. The
 * stability test imports this file and calls highlight(): the name stays.
 */

const KEYWORDS = new Set('let set show if else for in while break continue return import include as context and or not none auto true false'.split(' '));
/** Keywords after # that take the rest of their line as code. */
const LINE_KEYWORDS = new Set('let set show import include if for while return context break continue'.split(' '));
/** How far ahead a name, number, marker or label is looked for. */
const LOOK_AHEAD = 80;
const SHORT_LOOK_AHEAD = 12;
/** How far ahead a number, a run of backticks, or the text after a name is looked at. */
const NEAR_LOOK_AHEAD = 40;
const SPACE_LOOK_AHEAD = 200;
const NUMBER = /^(\d*\.)?\d+(e[+-]?\d+)?(pt|mm|cm|in|em|fr|%|deg|rad)?/;
const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_-]*/u;

/**
 * Returns text with the characters of HTML escaped.
 * @param {*} text - the text.
 * @returns {string} the text with & < > " as entities.
 */
export function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Returns the code highlighted as HTML; very deep nesting (thousands of brackets) is shown as
 * plain text.
 * @param {string} code - the Typst code.
 * @returns {string} the HTML with a span per highlighted part.
 */
export function highlight(code) {
    try { return highlightCode(code); } catch (e) { return escapeHtml(code); }
}

/**
 * Where a kind of code starts, as the reader of the highlighting reads it.
 * @typedef {object} CodeContext
 * @property {number} start - the offset where it starts.
 * @property {string} context - markup, code, string, comment, raw or math.
 */

/**
 * Returns where each kind of code starts: markup, code (after # and in brackets of code),
 * strings, comments, raw text and math, in the order of the code. Here the reader reads strings,
 * raw text and comments as the compiler does: a string runs to its closing quote across lines, raw
 * text also stands in code, strings and comments also stand in math, and #"…" in markup is a
 * string (the highlighting keeps a string to its line, so an opening quote being typed colors one
 * line). Very deep nesting gives the whole code as markup.
 * @param {string} code - the Typst code.
 * @returns {CodeContext[]} the starts, in order; at one offset the last one holds.
 */
export function getCodeContexts(code) {
    const contexts = [];
    try { highlightCode(code, contexts); } catch (e) { return [{ start: 0, context: 'markup' }]; }
    return contexts;
}

/**
 * Returns the kind of code at an offset.
 * @param {CodeContext[]} contexts - the starts (getCodeContexts).
 * @param {number} offset - the offset in the code.
 * @returns {string} markup, code, string, comment, raw or math.
 */
export function getContextAt(contexts, offset) {
    let low = 0, high = contexts.length - 1, best = -1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (contexts[middle].start <= offset) { best = middle; low = middle + 1; } else high = middle - 1;
    }
    return best < 0 ? 'markup' : contexts[best].context;
}

/**
 * Returns the code highlighted as HTML: markup at the top, each stray closing bracket as text.
 * @param {string} src - the Typst code.
 * @param {?CodeContext[]} [contexts=null] - a list to add where each kind of code starts; null to skip it.
 * @returns {string} the HTML.
 * @throws {RangeError} when the nesting is too deep for the call stack.
 */
function highlightCode(src, contexts = null) {
    let i = 0;
    const n = src.length;
    let out = '';
    /** The kinds of code the reader is in, innermost last. */
    const openContexts = [];
    while (i < n) {
        out += readMarkup(null);
        if (i < n) { out += escapeHtml(src[i]); i++; }   // a stray closing bracket at the top
    }
    return out;

    /**
     * Notes that a kind of code starts at the position.
     * @param {string} context - markup, code, string, comment, raw or math.
     * @returns {void}
     */
    function addContextStart(context) {
        if (!contexts) return;
        openContexts.push(context);
        contexts.push({ start: i, context });
    }

    /**
     * Notes that the innermost kind of code ends at the position: the one around it goes on.
     * @returns {void}
     */
    function addContextEnd() {
        if (!contexts) return;
        openContexts.pop();
        contexts.push({ start: i, context: openContexts[openContexts.length - 1] || 'markup' });
    }

    /**
     * Returns text in a span of a class.
     * @param {string} className - the class.
     * @param {string} text - the text.
     * @returns {string} the span.
     */
    function formatSpan(className, text) {
        return `<span class="${className}">${escapeHtml(text)}</span>`;
    }

    /**
     * Tells whether a character can start a name.
     * @param {string|undefined} character - the character.
     * @returns {boolean} true for a letter or "_".
     */
    function isNameStart(character) {
        return /[\p{L}_]/u.test(character || '');
    }

    /**
     * Returns the name that starts at a place, without "-" at its end.
     * @param {number} place - the place.
     * @returns {string} the name, "" when none starts there.
     */
    function getNameAt(place) {
        const match = IDENTIFIER.exec(src.slice(place, place + LOOK_AHEAD));
        return match ? match[0].replace(/-+$/, '') : '';
    }

    /**
     * Reads a comment at the position: // to the end of the line, or /* … *\/ with the
     * comments nested in it.
     * @returns {string} the highlighted comment.
     */
    function readComment() {
        addContextStart('comment');
        if (src[i + 1] === '/') {
            const lineEnd = src.indexOf('\n', i);
            const end = lineEnd < 0 ? n : lineEnd;
            const text = src.slice(i, end);
            i = end;
            addContextEnd();
            return formatSpan('c', text);
        }
        let depth = 0, k = i;
        while (k < n) {
            if (src.startsWith('/*', k)) { depth++; k += 2; continue; }
            if (src.startsWith('*/', k)) { depth--; k += 2; if (!depth) break; continue; }
            k++;
        }
        const text = src.slice(i, k);
        i = k;
        addContextEnd();
        return formatSpan('c', text);
    }

    /**
     * Reads a string at the position, to its closing quote or the end of its line (for the kinds
     * of code: to its closing quote).
     * @returns {string} the highlighted string.
     */
    function readString() {
        addContextStart('string');
        let k = i + 1;
        while (k < n && src[k] !== '"' && (contexts || src[k] !== '\n')) k += src[k] === '\\' ? 2 : 1;
        k = Math.min(n, k + 1);
        const text = src.slice(i, k);
        i = k;
        addContextEnd();
        return formatSpan('s', text);
    }

    /**
     * Reads math at the position, from $ to $ (for the kinds of code also the strings and comments
     * in it, where a $ stays inside).
     * @returns {string} the highlighted math.
     */
    function readMath() {
        addContextStart('math');
        const start = i;
        i++;
        while (i < n && src[i] !== '$') {
            if (contexts && src[i] === '"') { readString(); continue; }
            if (contexts && src[i] === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { readComment(); continue; }
            i += src[i] === '\\' ? 2 : 1;
        }
        i = Math.min(n, i + 1);
        addContextEnd();
        return formatSpan('d', src.slice(start, i));
    }

    /**
     * Reads raw text at the position: a block in three or more backticks, `` as empty raw
     * text, or `…` inline.
     * @returns {string} the highlighted raw text.
     */
    function readRaw() {
        addContextStart('raw');
        const ticks = /^`+/.exec(src.slice(i, i + NEAR_LOOK_AHEAD))[0];
        let k;
        if (ticks.length >= 3) { k = src.indexOf(ticks, i + ticks.length); k = k < 0 ? n : k + ticks.length; }
        else if (ticks.length === 2) k = i + 2;
        else { k = src.indexOf('`', i + 1); k = k < 0 ? n : k + 1; }
        const text = src.slice(i, k);
        i = k;
        addContextEnd();
        return formatSpan('s', text);
    }

    /**
     * Reads code up to a closing bracket at this level.
     * @param {string|null} close - ")" or "}", null for none.
     * @param {boolean} line - true when the code also ends at a line break (after a keyword).
     * @returns {string} the highlighted code.
     */
    function readCode(close, line) {
        let part = '';
        addContextStart('code');
        while (i < n) {
            const c = src[i];
            if (c === close) break;
            if (line && (c === '\n' || c === ';' || c === ']')) break;
            if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { part += readComment(); continue; }
            if (c === '"') { part += readString(); continue; }
            if (c === '$') { part += readMath(); continue; }
            if (c === '`' && contexts) { part += readRaw(); continue; }
            if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || ''))) {
                const number = NUMBER.exec(src.slice(i, i + NEAR_LOOK_AHEAD));
                part += formatSpan('e', number[0]);
                i += number[0].length;
                continue;
            }
            if (isNameStart(c)) { part += readName(line); continue; }
            // The brackets are read here, without a step of their own, so deep nesting takes as few calls as it can.
            if (c === '(') { i++; part += formatSpan('p', '(') + readCode(')', false); if (src[i] === ')') { part += formatSpan('p', ')'); i++; } continue; }
            if (c === '{') { i++; part += formatSpan('p', '{') + readCode('}', false); if (src[i] === '}') { part += formatSpan('p', '}'); i++; } continue; }
            if (c === '[') { i++; part += formatSpan('p', '[') + readMarkup(']'); if (src[i] === ']') { part += formatSpan('p', ']'); i++; } continue; }
            if (/\s/.test(c)) {
                const space = /^\s+/.exec(src.slice(i, i + SPACE_LOOK_AHEAD))[0];
                const kept = line ? space.split('\n')[0] : space;
                if (!kept.length) break;
                part += kept;
                i += kept.length;
                continue;
            }
            part += formatSpan('p', c);
            i++;
        }
        addContextEnd();
        return part;
    }

    /**
     * Reads a name in code: a keyword, a named argument (before ":"), a function (before a
     * bracket) or a plain name.
     * @param {boolean} line - true inside a keyword's line, where no named arguments are.
     * @returns {string} the highlighted name.
     */
    function readName(line) {
        const name = getNameAt(i);
        const after = src.slice(i + name.length, i + name.length + NEAR_LOOK_AHEAD);
        i += name.length;
        if (KEYWORDS.has(name)) return formatSpan('k', name);
        if (/^\s*:(?!:)/.test(after) && !line) return formatSpan('a', name);
        if (/^[([]/.test(after)) return formatSpan('k', name);
        return escapeHtml(name);
    }

    /**
     * Reads "#" in markup: a keyword line, a function call with its arguments and content, or
     * a block.
     * @returns {string} the highlighted expression.
     */
    function readEmbedded() {
        const name = getNameAt(i + 1);
        if (name && LINE_KEYWORDS.has(name)) { addContextStart('code'); i += 1 + name.length; const part = formatSpan('k', '#' + name) + readCode(null, true); addContextEnd(); return part; }
        let part = '';
        if (name) { addContextStart('code'); part += formatSpan('k', '#' + name); i += 1 + name.length; }
        else if (src[i + 1] === '(' || src[i + 1] === '{' || src[i + 1] === '[') { addContextStart('code'); part += formatSpan('k', '#'); i++; }
        else { i++; return '#'; }
        for (;;) {
            const c = src[i];
            if (c === '(') { i++; part += formatSpan('p', '(') + readCode(')', false); if (src[i] === ')') { part += formatSpan('p', ')'); i++; } continue; }
            if (c === '{') { i++; part += formatSpan('p', '{') + readCode('}', false); if (src[i] === '}') { part += formatSpan('p', '}'); i++; } continue; }
            if (c === '[') { i++; part += formatSpan('p', '[') + readMarkup(']'); if (src[i] === ']') { part += formatSpan('p', ']'); i++; } continue; }
            if (c === '.' && isNameStart(src[i + 1])) {
                const field = getNameAt(i + 1);
                i += 1 + field.length;
                part += '.' + (/^[([]/.test(src[i] || '') ? formatSpan('k', field) : escapeHtml(field));
                continue;
            }
            addContextEnd();
            return part;
        }
    }

    /**
     * Reads markup up to a closing bracket: headings and list markers at the start of a line,
     * comments, escapes, embedded code, math, raw text, labels, references and strong /
     * emphasis markers; plain text between them.
     * @param {string|null} close - "]", null at the top.
     * @returns {string} the highlighted markup.
     */
    function readMarkup(close) {
        let part = '', heading = false, text = '';
        addContextStart('markup');
        /**
         * Adds the plain text read so far to the part.
         * @returns {void}
         */
        const addText = () => { if (text) { part += escapeHtml(text); text = ''; } };
        let lineStart = i === 0 || src[i - 1] === '\n';
        while (i < n) {
            const c = src[i];
            if (close && c === close) break;
            if (c === '\n') { addText(); if (heading) { part += '</span>'; heading = false; } part += '\n'; i++; lineStart = true; continue; }
            if (lineStart && (c === ' ' || c === '\t')) { text += c; i++; continue; }
            if (lineStart) {
                lineStart = false;
                const headingMarker = /^(=+)(?=[ \t])/.exec(src.slice(i, i + SHORT_LOOK_AHEAD));
                if (headingMarker) { addText(); part += formatSpan('k', headingMarker[1]) + '<span class="h">'; heading = true; i += headingMarker[1].length; continue; }
                const listMarker = /^([-+/]|\d+\.)(?=[ \t])/.exec(src.slice(i, i + SHORT_LOOK_AHEAD));
                if (listMarker) { addText(); part += formatSpan('p', listMarker[1]); i += listMarker[1].length; continue; }
            }
            if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { addText(); part += readComment(); continue; }
            if (c === '\\') {
                addText();
                const escape = /^\\(u\{[0-9a-fA-F]+\}|[\s\S])/.exec(src.slice(i, i + SHORT_LOOK_AHEAD));
                if (escape && escape[1] !== '\n') { part += formatSpan('e', escape[0]); i += escape[0].length; } else { part += '\\'; i++; }
                continue;
            }
            if (c === '#' && (isNameStart(src[i + 1]) || /[([{]/.test(src[i + 1] || ''))) { addText(); part += readEmbedded(); continue; }
            if (c === '#' && src[i + 1] === '"' && contexts) { addText(); addContextStart('code'); i++; readString(); addContextEnd(); continue; }
            if (c === '$') { addText(); part += readMath(); continue; }
            if (c === '`') { addText(); part += readRaw(); continue; }
            if (c === '<') { const label = /^<[\p{L}\p{N}_:.-]+>/u.exec(src.slice(i, i + LOOK_AHEAD)); if (label) { addText(); part += formatSpan('e', label[0]); i += label[0].length; continue; } }
            if (c === '@') { const reference = /^@[\p{L}\p{N}_:.-]*[\p{L}\p{N}_]/u.exec(src.slice(i, i + LOOK_AHEAD)); if (reference) { addText(); part += formatSpan('e', reference[0]); i += reference[0].length; continue; } }
            if (c === '*' || c === '_') { addText(); part += formatSpan('p', c); i++; continue; }
            text += c;
            i++;
        }
        addText();
        if (heading) part += '</span>';
        addContextEnd();
        return part;
    }
}
