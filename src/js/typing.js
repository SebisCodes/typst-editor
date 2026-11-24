/**
 * Typing help in the code: Undo and Redo, bold, emphasis, underline and math around the
 * selection, a comment for the selected lines, indenting with Tab, Enter that keeps the
 * indentation and goes on with a list, brackets and quotes around a selection, the closing
 * bracket after #name( and typing over a closing bracket that is there already.
 *
 * Every edit goes through setCodeRange(), which keeps the browser's own undo of the textarea
 * and assistive technology informed.
 */

import { ui } from './state.js?v=3';
import { undo, redo } from './history.js?v=6';
import { showSourceMark } from './source-mark.js?v=6';
import { addMarkup } from './code-insert.js?v=6';

const INDENT = '  ';
/** The shortcuts with Ctrl (Cmd) that put markup around the selection. */
const MARKUP_KEYS = { b: 'strong', i: 'emph', u: 'underline', m: 'math' };
/** The keys of undo (both cases, Shift turns it into redo) and redo with Ctrl or Cmd. */
const UNDO_KEYS = ['z', 'Z'], REDO_KEY = 'y';
/** The characters that go around a selection, with their closing one. */
const PAIRS = { '[': ']', '(': ')', '{': '}', '$': '$', '*': '*', '_': '_', '"': '"', '`': '`' };
const CLOSING_BRACKETS = { '[': ']', '(': ')', '{': '}' };
/** How far back a function name before "(" or "[" is looked for. */
const NAME_LOOK_BEHIND = 40;

/**
 * Replaces a range of the code with text and moves the cursor. The browser's insertText keeps
 * the edit in its own undo and in assistive technology; without it the text is set directly.
 * @param {number} start - where the range starts.
 * @param {number} end - where it ends.
 * @param {string} text - the new text.
 * @param {number} [selectionStart] - where the cursor (or selection) goes afterwards.
 * @param {number} [selectionEnd] - the end of the selection.
 * @returns {void}
 */
export function setCodeRange(start, end, text, selectionStart, selectionEnd) {
    const textarea = ui.ta;
    if (document.activeElement !== textarea) textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    if (!document.execCommand || !document.execCommand('insertText', false, text)) {
        textarea.setRangeText(text, start, end, 'end');
        textarea.dispatchEvent(new Event('input'));
    }
    if (selectionStart != null) textarea.setSelectionRange(selectionStart, selectionEnd ?? selectionStart);
}

/**
 * Runs the typing help for a key in the code (a keydown handler).
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function handleCodeKey(event) {
    if (runShortcut(event) || editIndent(event) || addLineBreak(event) || addPair(event) || closeCall(event)) return;
    moveOverClosingBracket(event);
}

/**
 * Runs the shortcuts of the code: Undo, Redo, markup, the frame of the cursor's text on the
 * page (Ctrl+Enter), a comment (Ctrl+/) and leaving the code (Escape). Returns whether the key
 * was one of them.
 * @param {KeyboardEvent} event - the key.
 * @returns {boolean} true when the key was taken.
 */
function runShortcut(event) {
    const withModifier = event.ctrlKey || event.metaKey;
    if (withModifier && !event.altKey && UNDO_KEYS.includes(event.key)) { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return true; }
    if (withModifier && event.key === REDO_KEY) { event.preventDefault(); redo(); return true; }
    if (withModifier && Object.hasOwn(MARKUP_KEYS, event.key)) { event.preventDefault(); addMarkup(MARKUP_KEYS[event.key]); return true; }
    if (withModifier && event.key === 'Enter') { event.preventDefault(); showSourceMark(true, true); return true; }
    if (withModifier && event.key === '/') { event.preventDefault(); applyLineCommentSwitch(); return true; }
    if (event.key === 'Escape') { ui.ta.blur(); return true; }
    return false;
}

/**
 * Tab adds two spaces at the cursor, or indents the selected lines; Shift+Tab takes one level
 * of indentation away. Returns whether the key was Tab.
 * @param {KeyboardEvent} event - the key.
 * @returns {boolean} true for Tab.
 */
function editIndent(event) {
    if (event.key !== 'Tab') return false;
    event.preventDefault();
    const { value, selectionStart: start, selectionEnd: end } = ui.ta;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    if (start === end && !event.shiftKey) { setCodeRange(start, end, INDENT); return true; }
    const lastLineEnd = value.indexOf('\n', end - (end > start && value[end - 1] === '\n' ? 1 : 0));
    const linesEnd = lastLineEnd < 0 ? value.length : lastLineEnd;
    const lines = value.slice(lineStart, linesEnd).split('\n');
    const indented = lines.map(line => (event.shiftKey ? line.replace(/^ {1,2}|^\t/, '') : INDENT + line)).join('\n');
    setCodeRange(lineStart, linesEnd, indented, lineStart, lineStart + indented.length);
    return true;
}

/**
 * Enter keeps the line's indentation: in a list item the next item follows (the next number),
 * an empty item ends the list; after an opening bracket the next line is indented (and the
 * closing bracket goes on a line of its own). Returns whether the key was Enter.
 * @param {KeyboardEvent} event - the key.
 * @returns {boolean} true for Enter without Ctrl and outside a composition.
 */
function addLineBreak(event) {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.isComposing) return false;
    event.preventDefault();
    const { value, selectionStart: start, selectionEnd: end } = ui.ta;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const indent = /^[ \t]*/.exec(value.slice(lineStart))[0];
    const before = value.slice(lineStart, start);
    const item = /^(\s*)([-+]|\d+\.|\/)( +)(.*)$/.exec(before);
    if (item && start === end) {
        if (!item[4].trim()) { setCodeRange(lineStart, end, item[1]); return true; }
        const marker = /^\d+\.$/.test(item[2]) ? (parseInt(item[2], 10) + 1) + '.' : item[2];
        setCodeRange(start, end, '\n' + item[1] + marker + item[3]);
        return true;
    }
    if (/[[({]\s*$/.test(before) && start === end) {
        const close = CLOSING_BRACKETS[before.trim().slice(-1)];
        const rest = value.slice(start, value.indexOf('\n', start) < 0 ? value.length : value.indexOf('\n', start));
        if (rest.trim().startsWith(close)) { setCodeRange(start, end, '\n' + indent + INDENT + '\n' + indent, start + 1 + indent.length + INDENT.length); return true; }
        setCodeRange(start, end, '\n' + indent + INDENT);
        return true;
    }
    setCodeRange(start, end, '\n' + indent);
    return true;
}

/**
 * A bracket, quote or markup character typed over a selection goes around it. Returns whether
 * it did.
 * @param {KeyboardEvent} event - the key.
 * @returns {boolean} true when the selection got the pair.
 */
function addPair(event) {
    const { value, selectionStart: start, selectionEnd: end } = ui.ta;
    if (!PAIRS[event.key] || start === end || event.isComposing) return false;
    event.preventDefault();
    setCodeRange(start, end, event.key + value.slice(start, end) + PAIRS[event.key], start + 1, end + 1);
    return true;
}

/**
 * "(" or "[" right after #name gets its closing bracket at once. Returns whether it did.
 * @param {KeyboardEvent} event - the key.
 * @returns {boolean} true when both brackets were added.
 */
function closeCall(event) {
    const { value, selectionStart: start, selectionEnd: end } = ui.ta;
    if ((event.key !== '(' && event.key !== '[') || start !== end) return false;
    if (!/#[\p{L}_][\p{L}\p{N}_.-]*$/u.test(value.slice(Math.max(0, start - NAME_LOOK_BEHIND), start)) || /^[\p{L}\p{N}]/u.test(value.slice(start, start + 1))) return false;
    event.preventDefault();
    setCodeRange(start, end, event.key + (event.key === '(' ? ')' : ']'), start + 1);
    return true;
}

/**
 * Typing a closing bracket that is there already moves over it, when an opening one waits for it.
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function moveOverClosingBracket(event) {
    const { value, selectionStart: start, selectionEnd: end } = ui.ta;
    if ((event.key !== ')' && event.key !== ']') || start !== end || value[start] !== event.key) return;
    const open = event.key === ')' ? '(' : '[';
    const before = value.slice(0, start);
    if (before.split(open).length > before.split(event.key).length) { event.preventDefault(); ui.ta.setSelectionRange(start + 1, start + 1); }
}

/**
 * Comments the selected lines out with //, or in again when all of them are comments (empty
 * lines stay as they are).
 * @returns {void}
 */
function applyLineCommentSwitch() {
    const { value, selectionStart: start, selectionEnd: end } = ui.ta;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lastLineEnd = value.indexOf('\n', end - (end > start && value[end - 1] === '\n' ? 1 : 0));
    const linesEnd = lastLineEnd < 0 ? value.length : lastLineEnd;
    const lines = value.slice(lineStart, linesEnd).split('\n');
    const allComments = lines.every(line => !line.trim() || /^\s*\/\//.test(line));
    const switched = lines.map(line => (!line.trim() ? line : allComments ? line.replace(/^(\s*)\/\/ ?/, '$1') : line.replace(/^(\s*)/, '$1// '))).join('\n');
    setCodeRange(lineStart, linesEnd, switched, lineStart, lineStart + switched.length);
}

/**
 * Connects the typing help to the code.
 * @returns {void}
 */
export function startTyping() {
    ui.ta.addEventListener('keydown', handleCodeKey);
}
