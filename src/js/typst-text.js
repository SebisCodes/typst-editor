/**
 * Text on the page as Typst sees it: typed text written as Typst markup (editing on the page)
 * and how the text at a place of the code looks (weight, slant, font), for the field that edits
 * it on the page.
 */

import { getBlankedCode, getHashEnd } from './typst-code.js?v=3';
import { findSetRule } from './typst-rules.js?v=3';

/** The font weights Typst knows by name. */
const WEIGHTS = { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 };
const REGULAR_WEIGHT = 400;
const BOLD_WEIGHT = 700;

/**
 * How the text at a place looks, as far as the code says it.
 * @typedef {object} TextStyle
 * @property {number} weight - the font weight (400 regular, 700 bold).
 * @property {boolean} italic - true for slanted text.
 * @property {boolean} mono - true for raw text or a monospaced font.
 * @property {string|null} font - the font the code names, null for the default.
 */

/**
 * The syntax tree's lists that getTextStyle() reads (worker.js makes them).
 * @typedef {object} SyntaxLists
 * @property {Array<[number, number]>} headings - [start, end] of each heading.
 * @property {Array<[number, number, string]>} marks - [start, end, kind] of strong, emph, raw … parts.
 */

/**
 * Returns typed text as Typst markup: special characters escaped with a backslash,
 * typographic quotes as the straight ones Typst makes curly, list and heading markers at the
 * start of a line escaped.
 * @param {string} text - the typed text (line breaks are read as spaces).
 * @param {boolean} lineStart - true when the text starts a line of the code.
 * @returns {string} the markup.
 */
export function escapeMarkup(text, lineStart) {
    let markup = text.replace(/[\r\n]+/g, ' ')
        .replace(/[\\#*_$`<>@[\]~]/g, character => '\\' + character)
        .replace(/\/(?=[/*])/g, '\\/')
        .replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
    if (lineStart) markup = markup.replace(/^(\s*)([-+=/])(?=\s|$)/, '$1\\$2').replace(/^(\s*\d+)\.(?=\s|$)/, '$1\\.');
    return markup;
}

/**
 * Returns how the text at a place looks, as far as the code says it: #set text(…), headings
 * (bold), *strong* / _emph_ / `raw`, and #strong[…], #emph[…], #text(weight:, style:, font:)[…]
 * around it, the outer ones first.
 * @param {string} code - the Typst code.
 * @param {number} place - the place in the code.
 * @param {SyntaxLists} syntax - the syntax tree's headings and marks.
 * @returns {TextStyle} the style.
 */
export function getTextStyle(code, place, syntax) {
    const style = { weight: REGULAR_WEIGHT, italic: false, mono: false, font: null };
    const rule = findSetRule(code, 'text');
    if (rule) setTextArguments(style, code.slice(rule.open, rule.close));
    const around = [...getMarkedStyles(style, place, syntax), ...getFunctionStyles(style, code, place)];
    around.sort((x, y) => x.a - y.a).forEach(item => item.f());
    if (/mono/i.test(style.font || '')) style.mono = true;
    return style;
}

/**
 * Sets the weight, slant and font that the arguments of text(…) give.
 * @param {TextStyle} style - the style to change.
 * @param {string} args - the arguments as written.
 * @returns {void}
 */
function setTextArguments(style, args) {
    const weight = /\bweight\s*:\s*(?:"(\w+)"|(\d+))/.exec(args);
    if (weight) style.weight = weight[2] ? +weight[2] : WEIGHTS[weight[1]] || style.weight;
    const slant = /\bstyle\s*:\s*"(\w+)"/.exec(args);
    if (slant) style.italic = slant[1] !== 'normal';
    const font = /\bfont\s*:\s*\(?\s*"([^"]+)"/.exec(args);
    if (font) style.font = font[1];
}

/**
 * Returns the changes of style of the headings and the strong, emph and raw parts around a
 * place, each with where it starts.
 * @param {TextStyle} style - the style the changes set.
 * @param {number} place - the place in the code.
 * @param {SyntaxLists} syntax - the syntax tree's headings and marks.
 * @returns {Array<{a: number, f: function(): void}>} the changes.
 */
function getMarkedStyles(style, place, syntax) {
    /**
     * Tells whether a range holds the place.
     * @param {number[]} range - [start, end] in the code.
     * @returns {boolean} true when the place is inside.
     */
    const isAround = ([start, end]) => start <= place && place < end;
    const around = [];
    for (const heading of syntax.headings || []) if (isAround(heading)) around.push({ a: heading[0], f: () => { style.weight = BOLD_WEIGHT; } });
    for (const mark of syntax.marks || []) {
        if (!isAround(mark)) continue;
        if (mark[2] === 'Strong') around.push({ a: mark[0], f: () => { style.weight = BOLD_WEIGHT; } });
        else if (mark[2] === 'Emph') around.push({ a: mark[0], f: () => { style.italic = true; } });
        else if (mark[2] === 'Raw') around.push({ a: mark[0], f: () => { style.mono = true; } });
    }
    return around;
}

/**
 * Returns the changes of style of #strong[…], #emph[…] and #text(…)[…] around a place, each
 * with where it starts.
 * @param {TextStyle} style - the style the changes set.
 * @param {string} code - the Typst code.
 * @param {number} place - the place in the code.
 * @returns {Array<{a: number, f: function(): void}>} the changes.
 */
function getFunctionStyles(style, code, place) {
    const blanked = getBlankedCode(code);
    const around = [];
    for (const match of blanked.matchAll(/#(strong|emph|text)\b/g)) {
        if (match.index >= place) break;
        if (getHashEnd(blanked, match.index) <= place) continue;
        const open = blanked.indexOf('[', match.index);
        if (open < 0 || open > place) continue;
        const args = code.slice(match.index, open);
        around.push({ a: match.index, f: match[1] === 'strong' ? () => { style.weight = BOLD_WEIGHT; } : match[1] === 'emph' ? () => { style.italic = true; } : () => setTextArguments(style, args) });
    }
    return around;
}
