/**
 * Pictures moved on the page, in the code: the code of each picture (what moves) and the code
 * after a move to a place between blocks, beside another picture, or a swap of two cells.
 */

import { getBlankedCode, getClosingBracket, getHashEnd, STATEMENTS } from './typst-code.js?v=3';

/** A call of grid, table or stack right before an argument list. */
const CELLS = /(?:^|[^\p{L}\p{N}_.-])(?:grid|table|stack)\s*$/u;
/** How far around a place the code is read to know the call or argument list it is in. */
const CALL_LOOK_BEHIND = 40;
/** How far after "#" a statement's name is looked for. */
const NAME_LOOK_AHEAD = 40;
const ARGUMENT_LOOK_AROUND = 200;
const LABEL_LOOK_AHEAD = 120;

/**
 * A range of the code: where a call or a "#" expression starts and ends.
 * @typedef {object} CodeRange
 * @property {number} a - where it starts.
 * @property {number} e - where it ends.
 * @property {number} [at] - where the function's name starts.
 */

/**
 * A picture in the code.
 * @typedef {object} PictureCode
 * @property {number} at - where "image(" starts.
 * @property {number[]|null} move - [start, end] of the code that moves with it, null when it does not move.
 * @property {string} [mode] - "code" for an argument of #grid, #table or #stack (written without "#"), else "markup".
 * @property {boolean} [cell] - true when it is a cell of its own there.
 * @property {number} [list] - where that argument list starts, -1 in markup.
 */

/**
 * The code after a move.
 * @typedef {object} MovedCode
 * @property {string} code - the changed code.
 * @property {number} at - where the moved picture's code starts.
 * @property {number} end - where it ends.
 */

/**
 * What leaves the code when a picture goes elsewhere.
 * @typedef {object} PictureCut
 * @property {number} x - where the cut starts.
 * @property {number} y - where it ends.
 * @property {string} repl - what takes its place.
 */

/**
 * Returns the pictures in the code, in order. A picture moves with the whole #figure(…) (and
 * its label) when it is in one, else with its #image(…); a picture in other code moves with
 * the "#" expression around it, and not at all when that is a definition (#let, #show …).
 * @param {string} code - the Typst code.
 * @returns {PictureCode[]} the pictures.
 */
export function findPictures(code) {
    const blanked = getBlankedCode(code);
    const hashes = [];
    for (let k = blanked.indexOf('#'); k >= 0; k = blanked.indexOf('#', k + 1)) if (/[\p{L}_({[]/u.test(blanked[k + 1] || '')) hashes.push({ a: k, e: getHashEnd(blanked, k) });
    const figures = findCalls(blanked, /(?<![\p{L}\p{N}_.-])figure(?=\s*[(\[])/gu);
    return findCalls(blanked, /(?<![\p{L}\p{N}_.-])image(?=\s*\()/gu).map(image => getPictureCode(code, blanked, image, figures, hashes));
}

/**
 * Returns the calls of a function in the code with the "#" expression they make.
 * @param {string} blanked - the blanked code.
 * @param {RegExp} pattern - the function's name (global).
 * @returns {CodeRange[]} where each name starts, where its expression starts and ends.
 */
function findCalls(blanked, pattern) {
    const calls = [];
    for (const match of blanked.matchAll(pattern)) calls.push({ at: match.index, a: blanked[match.index - 1] === '#' ? match.index - 1 : match.index, e: getHashEnd(blanked, match.index - 1) });
    return calls;
}

/**
 * Returns the innermost of some ranges that holds a range.
 * @param {CodeRange[]} ranges - the ranges.
 * @param {number} start - where the range starts.
 * @param {number} end - where it ends.
 * @returns {CodeRange|undefined} the shortest range around it.
 */
function getInnermostAround(ranges, start, end) {
    return ranges.filter(range => range.a <= start && range.e >= end).sort((x, y) => (x.e - x.a) - (y.e - y.a))[0];
}

/**
 * Returns the bracket that holds a place.
 * @param {string} blanked - the blanked code.
 * @param {number} place - the place.
 * @returns {number} the place of the opening bracket, -1 at the top level.
 */
function getHoldingBracket(blanked, place) {
    for (let k = place - 1, depth = 0; k >= 0; k--) {
        const c = blanked[k];
        if (')]}'.includes(c)) depth++;
        else if ('([{'.includes(c)) { if (!depth) return k; depth--; }
    }
    return -1;
}

/**
 * Tells whether a range is a whole argument of an argument list (a "(" or "," before it, a ","
 * or ")" after it).
 * @param {string} blanked - the blanked code.
 * @param {number} start - where it starts.
 * @param {number} end - where it ends.
 * @returns {boolean} true for a whole argument.
 */
function isWholeArgument(blanked, start, end) {
    return /[(,]\s*$/.test(blanked.slice(Math.max(0, start - ARGUMENT_LOOK_AROUND), start)) && /^\s*[,)]/.test(blanked.slice(end, end + ARGUMENT_LOOK_AROUND));
}

/**
 * Returns the code of one picture: what moves with it and how it stands there.
 * @param {string} code - the Typst code.
 * @param {string} blanked - the blanked code.
 * @param {CodeRange} image - the image call.
 * @param {CodeRange[]} figures - the figure calls.
 * @param {CodeRange[]} hashes - the "#" expressions.
 * @returns {PictureCode} the picture.
 */
function getPictureCode(code, blanked, image, figures, hashes) {
    let { a, e } = image;
    const figure = getInnermostAround(figures, a, e);
    if (figure) {
        ({ a, e } = figure);
        const label = /^[ \t]*<[\p{L}\p{N}_:.-]+>/u.exec(code.slice(e, e + LABEL_LOOK_AHEAD));
        if (label) e += label[0].length;
    }
    if (blanked[a] !== '#') {
        const holder = getHoldingBracket(blanked, a);
        if (holder >= 0 && blanked[holder] === '(' && CELLS.test(blanked.slice(Math.max(0, holder - CALL_LOOK_BEHIND), holder)) && isWholeArgument(blanked, a, e)) return { at: image.at, move: [a, e], mode: 'code', cell: true, list: holder };
        const hash = getInnermostAround(hashes, a, e);
        if (!hash) return { at: image.at, move: null };
        ({ a, e } = hash);
    }
    const name = /^#([\p{L}_][\p{L}\p{N}_-]*)/u.exec(blanked.slice(a, a + NAME_LOOK_AHEAD));
    if (name && STATEMENTS.has(name[1])) return { at: image.at, move: null };
    return { at: image.at, move: [a, e], mode: 'markup', cell: isOwnCell(blanked, a, e), list: -1 };
}

/**
 * Tells whether a picture in markup is the only thing in a [ ] argument of #grid, #table or
 * #stack, a cell of its own.
 * @param {string} blanked - the blanked code.
 * @param {number} start - where the picture's code starts.
 * @param {number} end - where it ends.
 * @returns {boolean} true for a cell of its own.
 */
function isOwnCell(blanked, start, end) {
    const holder = getHoldingBracket(blanked, start), close = holder >= 0 ? getClosingBracket(blanked, holder) : -1, call = holder >= 0 ? getHoldingBracket(blanked, holder) : -1;
    return blanked[holder] === '[' && close > 0 && !blanked.slice(holder + 1, start).trim() && !blanked.slice(end, close).trim()
        && isWholeArgument(blanked, holder, close + 1) && blanked[call] === '(' && CELLS.test(blanked.slice(Math.max(0, call - CALL_LOOK_BEHIND), call));
}

/**
 * Returns a picture's code as an argument ("code", without "#") or in markup (with "#").
 * @param {string} text - the picture's code.
 * @param {string} mode - "code" or "markup".
 * @returns {string} the code for that place.
 */
function convertToMode(text, mode) {
    return mode === 'code' ? text.replace(/^#/, '') : text[0] === '#' ? text : '#' + text;
}

/**
 * Returns what leaves the code when a picture goes elsewhere: its whole lines when it has them
 * to itself (one blank line is left between its neighbours), else one space beside it; a cell
 * of #grid, #table or #stack stays as an empty cell; an argument that moves within its own
 * list goes with its comma.
 * @param {string} code - the Typst code.
 * @param {PictureCode} picture - the picture.
 * @param {boolean} [inList] - true when it moves within its own argument list.
 * @returns {PictureCut} the cut.
 */
function getCut(code, picture, inList = false) {
    const [a, e] = picture.move;
    const lineStart = code.lastIndexOf('\n', a - 1) + 1;
    const alone = !code.slice(lineStart, a).trim();
    if (picture.mode === 'code') {
        if (!inList) return { x: a, y: e, repl: '[]' };
        const next = /^\s*,[ \t]*/.exec(code.slice(e));
        if (next) { const y = e + next[0].length; return alone && code[y] === '\n' ? { x: lineStart, y: y + 1, repl: '' } : { x: a, y, repl: '' }; }
        return { x: a - (/,\s*$/.exec(code.slice(0, a))?.[0].length || 0), y: e, repl: '' };
    }
    let lineEnd = code.indexOf('\n', e);
    lineEnd = lineEnd < 0 ? code.length : lineEnd + 1;
    let x = a, y = e;
    if (alone && !code.slice(e, lineEnd).trim()) { x = lineStart; y = lineEnd; }
    else if (code[a - 1] === ' ' && /^[ \n]?$/.test(code[e] || '')) x--;
    const left = code.slice(0, x);
    if (x === lineStart && (!left || /\n[ \t]*\n$/.test(left))) y += /^[ \t]*\n/.exec(code.slice(y))?.[0].length || 0;
    return { x, y, repl: '' };
}

/**
 * Returns the code with a cut made and text put in at a place (a place of the code before the
 * cut, outside of it).
 * @param {string} code - the Typst code.
 * @param {PictureCut} cut - the cut.
 * @param {number} place - where the text goes.
 * @param {string} before - what goes before the text.
 * @param {string} text - the text.
 * @param {string} after - what goes after it.
 * @returns {MovedCode|null} the code and where the text is, null when nothing changes.
 */
function getCodeWithCut(code, cut, place, before, text, after) {
    const { x, y, repl } = cut;
    const rest = code.slice(0, x) + repl + code.slice(y);
    const target = place <= x ? place : place >= y ? place - (y - x) + repl.length : x;
    const changed = rest.slice(0, target) + before + text + after + rest.slice(target);
    return changed === code ? null : { code: changed, at: target + before.length, end: target + before.length + text.length };
}

/**
 * Returns the code with a picture moved to its own paragraph at a place between blocks.
 * @param {string} code - the Typst code.
 * @param {PictureCode} picture - the picture.
 * @param {number} to - the place between blocks.
 * @returns {MovedCode|null} the code and where the picture is, null when that is where it is.
 */
export function getPictureMovedTo(code, picture, to) {
    const [a, e] = picture.move;
    if (to > a && to < e) return null;
    if (!code.slice(Math.min(to, a), a).trim() && !code.slice(e, Math.max(to, e)).trim()) return null;
    const text = convertToMode(code.slice(a, e), 'markup');
    const { x, y, repl } = getCut(code, picture);
    const rest = code.slice(0, x) + repl + code.slice(y);
    const target = to <= x ? to : to >= y ? to - (y - x) + repl.length : x;
    // In its new place, with a blank line before and after.
    const before = rest.slice(0, target).replace(/\s+$/, ''), after = rest.slice(target).replace(/^\s*\n/, '');
    const at = before ? before.length + 2 : 0;
    const changed = (before ? before + '\n\n' : '') + text + (after ? '\n\n' + after : '\n');
    return changed === code ? null : { code: changed, at, end: at + text.length };
}

/**
 * Tells whether a picture can stand beside (or swap with) another one: not itself, and no
 * label into an argument list.
 * @param {string} code - the Typst code.
 * @param {PictureCode} picture - the picture that moves.
 * @param {PictureCode} target - the other picture.
 * @returns {boolean} true when it can.
 */
export function isPlaceableBeside(code, picture, target) {
    const [a, e] = picture.move, [targetStart, targetEnd] = target.move;
    if (!(e <= targetStart || targetEnd <= a)) return false;
    return target.mode !== 'code' || !/>\s*$/.test(code.slice(a, e));
}

/**
 * Returns the code with a picture put directly before or after another one: on a line of its
 * own when that one has its line to itself (same indentation), else beside it with a space -
 * or as an argument next to it, with a comma.
 * @param {string} code - the Typst code.
 * @param {PictureCode} picture - the picture that moves.
 * @param {PictureCode} target - the other picture.
 * @param {boolean} after - true to put it after the other one.
 * @returns {MovedCode|null} the code and where the picture is, null when it cannot go there.
 */
export function getPictureMovedBeside(code, picture, target, after) {
    if (!isPlaceableBeside(code, picture, target)) return null;
    const [targetStart, targetEnd] = target.move;
    const text = convertToMode(code.slice(...picture.move), target.mode);
    const lineStart = code.lastIndexOf('\n', targetStart - 1) + 1;
    let lineEnd = code.indexOf('\n', targetEnd);
    if (lineEnd < 0) lineEnd = code.length;
    const indent = /^[ \t]*/.exec(code.slice(lineStart))[0];
    const ownLine = !code.slice(lineStart, targetStart).trim() && /^,?\s*$/.test(code.slice(targetEnd, lineEnd));
    const separator = target.mode === 'code' ? (ownLine ? ',\n' + indent : ', ') : (ownLine ? '\n' + indent : ' ');
    const cut = getCut(code, picture, picture.mode === 'code' && picture.list === target.list);
    return after ? getCodeWithCut(code, cut, targetEnd, separator, text, '') : getCodeWithCut(code, cut, targetStart, '', text, separator);
}

/**
 * Returns the code with two pictures that are cells of their own swapped.
 * @param {string} code - the Typst code.
 * @param {PictureCode} picture - the picture that moves.
 * @param {PictureCode} target - the other picture.
 * @returns {MovedCode|null} the code and where the moved picture is, null when they cannot swap.
 */
export function getPicturesSwapped(code, picture, target) {
    if (!picture.cell || !target.cell || !isPlaceableBeside(code, picture, target) || !isPlaceableBeside(code, target, picture)) return null;
    const [a, e] = picture.move, [targetStart, targetEnd] = target.move;
    const moved = convertToMode(code.slice(a, e), target.mode), other = convertToMode(code.slice(targetStart, targetEnd), picture.mode);
    const changed = a < targetStart
        ? code.slice(0, a) + other + code.slice(e, targetStart) + moved + code.slice(targetEnd)
        : code.slice(0, targetStart) + moved + code.slice(targetEnd, a) + other + code.slice(e);
    const at = a < targetStart ? targetStart + (other.length - (e - a)) : targetStart;
    return changed === code ? null : { code: changed, at, end: at + moved.length };
}
