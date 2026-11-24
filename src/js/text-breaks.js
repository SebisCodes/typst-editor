/**
 * Text typed on the page as Typst code: the changed part of a run with its line breaks. Two
 * breaks or more are a new paragraph (a blank line; in a list item a new item with the same
 * marker, the next number, and the items after it numbered on), one a line break (\ at the end
 * of the line; in a heading, which ends at its line, a new paragraph). Special characters are
 * escaped (escapeMarkup in typst-text.js).
 */

import { escapeMarkup } from './typst-text.js?v=3';
import { state, getLineStart } from './state.js?v=3';

/** A list item with a number at the start of a line (quote markers and indentation first). */
const NUMBERED_ITEM = /^([ \t]*(?:>[ \t]?)*[ \t]*)(\d+)([.)])(?=[ \t])/;

/**
 * The code after an edit on the page.
 * @typedef {object} EditedCode
 * @property {string} code - the changed code.
 * @property {number} cursor - where the cursor goes: after the written text.
 */

/**
 * Returns the code with the text of a run changed: only the part that differs is written, with
 * its line breaks in the format's way; a new paragraph or line starts without the space that
 * stood at the split, and the numbered items after new ones are numbered on.
 * @param {import('./state.js').TextRun} run - the run that was edited.
 * @param {string} before - the run's text when the edit started.
 * @param {string} edited - the text as edited.
 * @returns {EditedCode|null} the code and the cursor, null when only empty paragraphs were added.
 */
export function getEditedCode(run, before, edited) {
    const code = state.code;
    let a = 0, b = 0;
    while (a < before.length && a < edited.length && before[a] === edited[a]) a++;
    while (b < before.length - a && b < edited.length - a && before[before.length - 1 - b] === edited[edited.length - 1 - b]) b++;
    const from = run.places[a], to = run.places[before.length - b];
    const lineStart = !code.slice(getLineStart(code, from), from).trim();
    const written = formatBreaks(edited.slice(a, edited.length - b), from, to, lineStart);
    if (written === '' && from === to) return null;
    let end = to;
    if (/\n[ \t]*(?:(?:[-+]|\d+\.)[ \t]+)?$/.test(written)) while (code[end] === ' ' || code[end] === '\t') end++;
    const changed = code.slice(0, from) + written + code.slice(end);
    return { code: written.includes('\n') ? getNumberedOn(changed, from + written.lastIndexOf('\n') + 1) : changed, cursor: from + written.length };
}

/**
 * Returns the code with the numbered items after new ones numbered on: after new items were
 * added to a numbered list (the last one starts at a place), the items after them at the same
 * level get the next numbers, until the list ends or an item has a higher number already. A
 * list that numbers every item alike (1. 1. 1.) stays so.
 * @param {string} code - the code with the new items.
 * @param {number} place - where the last new item starts.
 * @returns {string} the code with the items numbered on.
 */
export function getNumberedOn(code, place) {
    const item = NUMBERED_ITEM.exec(getLineAt(code, place));
    if (!item || hasSameNumberBefore(code, place, item)) return code;
    let number = +item[2], at = code.indexOf('\n', place);
    if (at < 0) return code;
    at++;
    let numbered = code.slice(0, at);
    const [, indent, , marker] = item;
    while (at < code.length) {
        let lineEnd = code.indexOf('\n', at);
        if (lineEnd < 0) lineEnd = code.length;
        const line = code.slice(at, lineEnd);
        const next = NUMBERED_ITEM.exec(line);
        if (next && next[1] === indent && next[3] === marker) {
            if (+next[2] > number) break;
            number++;
            numbered += indent + number + marker + line.slice(next[0].length) + code.slice(lineEnd, lineEnd + 1);
        } else if (!line.trim() || (line.startsWith(indent) && /^[ \t]/.test(line.slice(indent.length)))) numbered += code.slice(at, lineEnd + 1);
        else break;
        at = lineEnd + 1;
    }
    return numbered + code.slice(at);
}

/**
 * Returns the line that starts at a place.
 * @param {string} code - the code.
 * @param {number} place - where the line starts.
 * @returns {string} the line without its line break.
 */
function getLineAt(code, place) {
    const end = code.indexOf('\n', place);
    return code.slice(place, end < 0 ? code.length : end);
}

/**
 * Tells whether the item before the new ones at the same level has the same number: then the
 * list numbers every item alike.
 * @param {string} code - the code.
 * @param {number} place - where the last new item starts.
 * @param {RegExpExecArray} item - the new item's match of NUMBERED_ITEM.
 * @returns {boolean} true when that item has the same number.
 */
function hasSameNumberBefore(code, place, item) {
    for (let p = code.lastIndexOf('\n', place - 2) + 1, q = place; q > 0; q = p, p = code.lastIndexOf('\n', p - 2) + 1) {
        const previous = NUMBERED_ITEM.exec(getLineAt(code, p));
        if (previous && previous[1] === item[1] && previous[3] === item[3]) return previous[2] === item[2];
        if (p === 0) break;
    }
    return false;
}

/**
 * Returns typed text as Typst markup with its line breaks (see the header). The indentation of
 * the line goes on. Breaks where the paragraph's text starts or ends make no empty paragraph
 * and are left out.
 * @param {string} text - the typed text.
 * @param {number} from - where the changed text starts in the code.
 * @param {number} to - where it ends.
 * @param {boolean} lineStart - true when it starts a line of the code.
 * @returns {string} the markup.
 */
export function formatBreaks(text, from, to, lineStart) {
    if (!text.includes('\n')) return escapeMarkup(text, lineStart);
    const code = state.code;
    const lineBegin = getLineStart(code, from);
    let lineEnd = code.indexOf('\n', to);
    if (lineEnd < 0) lineEnd = code.length;
    const line = code.slice(lineBegin, lineEnd);
    const listItem = /^([ \t]*)([-+]|(\d+)\.)([ \t]+)/.exec(line);
    const heading = /^[ \t]*=+[ \t]/.test(line);
    const { paragraph, lineBreak } = getBreakMarkup(code, line, lineEnd, listItem, heading);
    let breaks = text.replace(/\n{3,}/g, '\n\n');
    if (hasNoTextBefore(code, lineBegin, from, listItem, heading)) breaks = breaks.replace(/^\n+/, '');
    if (hasNoTextAfter(code, to, lineEnd, heading)) breaks = breaks.replace(/\n+$/, '');
    return breaks.split(/(\n+)/).map((part, i) => (!(i % 2) ? escapeMarkup(i ? part.replace(/^[ \t]+/, '') : part, i ? true : lineStart) : part.length > 1 ? paragraph : lineBreak)).join('');
}

/**
 * Returns what a new paragraph and a line break are on a line: a blank line with the line's
 * indentation, or in a list item a new item (the next number; the same number when the list
 * numbers every item alike); a line break is \ with the indentation, in a heading a new paragraph.
 * @param {string} code - the code.
 * @param {string} line - the line of the edit.
 * @param {number} lineEnd - where the line ends.
 * @param {RegExpExecArray|null} listItem - the line's list marker, null when it is no list item.
 * @param {boolean} heading - true for a heading.
 * @returns {{paragraph: string, lineBreak: string}} the markup of both.
 */
function getBreakMarkup(code, line, lineEnd, listItem, heading) {
    const indent = listItem ? listItem[1] : /^[ \t]*/.exec(line)[0];
    const sameNumber = listItem && listItem[3] && (NUMBERED_ITEM.exec(code.slice(lineEnd + 1).split('\n')[0]) || [])[2] === listItem[3];
    const paragraph = listItem ? '\n' + indent + (listItem[3] ? (sameNumber ? listItem[3] : +listItem[3] + 1) + '.' : listItem[2]) + listItem[4] : '\n\n' + indent;
    const lineBreak = heading ? paragraph : '\\\n' + indent + (listItem ? ' '.repeat(listItem[2].length + listItem[4].length) : '');
    return { paragraph, lineBreak };
}

/**
 * Tells whether a break at the start of the edit would make an empty paragraph: no text of
 * the paragraph before it on its line (after a marker) and no paragraph line above.
 * @param {string} code - the code.
 * @param {number} lineBegin - where the line starts.
 * @param {number} from - where the edit starts.
 * @param {RegExpExecArray|null} listItem - the line's list marker.
 * @param {boolean} heading - true for a heading.
 * @returns {boolean} true when the breaks at the start are left out.
 */
function hasNoTextBefore(code, lineBegin, from, listItem, heading) {
    const previousLine = code.slice(code.lastIndexOf('\n', lineBegin - 2) + 1, Math.max(0, lineBegin - 1));
    return !code.slice(lineBegin, from).replace(/^[ \t]*(?:[-+]|\d+\.|=+)?[ \t]*/, '') && (lineBegin === 0 || !previousLine.trim() || !!listItem || heading);
}

/**
 * Tells whether a break at the end of the edit would make an empty paragraph: no text after it
 * on its line and no paragraph line below.
 * @param {string} code - the code.
 * @param {number} to - where the edit ends.
 * @param {number} lineEnd - where the line ends.
 * @param {boolean} heading - true for a heading.
 * @returns {boolean} true when the breaks at the end are left out.
 */
function hasNoTextAfter(code, to, lineEnd, heading) {
    const nextLine = code.slice(lineEnd + 1, (code.indexOf('\n', lineEnd + 1) + 1 || code.length + 1) - 1);
    return !code.slice(to, lineEnd).trim() && (lineEnd >= code.length || !nextLine.trim() || heading || /^[ \t]*([-+]|\d+\.)[ \t]/.test(nextLine));
}

/**
 * Tells whether a place is inside *strong* or _emphasis_ of its line (an odd number of
 * unescaped markers before it): a new paragraph there would leave the marker open.
 * @param {number} place - the place in the code.
 * @returns {boolean} true inside strong or emphasis.
 */
export function isInStrong(place) {
    const before = state.code.slice(getLineStart(state.code, place), place).replace(/\\./g, '');
    return (before.match(/\*/g) || []).length % 2 === 1 || (before.match(/(^|[^A-Za-z0-9])_|_(?=[^A-Za-z0-9]|$)/g) || []).length % 2 === 1;
}
