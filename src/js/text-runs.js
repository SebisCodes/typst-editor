/**
 * Text on the pages and its place in the code. The typst.ts build carries no source spans, so
 * each text run on a page (.typst-text with its text in .tsel) is looked for in the code's plain
 * markup text (Text, smart quotes, shorthands and escapes of the syntax tree), in reading
 * order. A run found knows its place in the code and, for every character, where it is there.
 *
 * updateRuns() runs these steps after each compile:
 *   1. mark the code's plain markup text from the syntax tree;
 *   2. look for each run of each page from where the run before it ended;
 *   3. sort the runs found by their place in the code, for the frame of the code cursor.
 */

import { state, getNumberInRange } from './state.js?v=2';

/** What the shorthands of the markup show. */
const SHORTHANDS = { '--': '–', '---': '—', '...': '…', '-?': '\u00ad', '~': '\u00a0' };
/** The marks of the code's characters: plain text, the start of a smart quote, shorthand or escape, and the rest of one. */
const MARK_TEXT = 1;
const MARK_QUOTE = 2;
const MARK_SHORTHAND = 3;
const MARK_ESCAPE = 4;
const MARK_INSIDE = 9;
const MARK_OF_KIND = { T: MARK_TEXT, Q: MARK_QUOTE, H: MARK_SHORTHAND, E: MARK_ESCAPE };
/** How many places of the code are tried for one run, at most. */
const MAX_TRIES = 4000;
/** Math this close after a run is taken as the formula an element on the page comes from. */
const MATH_DISTANCE = 200;

/** The mark of each character of the compiled code. */
let textMask = null;
/** Where each smart quote, shorthand and escape ends, by its start. */
let nodeEnds = null;
/** The starts of the smart quotes, shorthands and escapes, in order. */
let specialStarts = [];
/** The run of each .typst-text element. */
let runByElement = new Map();

/**
 * Marks the compiled code's plain markup text from the syntax tree.
 * @returns {void}
 */
function setTextMask() {
    textMask = new Uint8Array(state.compiledCode.length + 1);
    nodeEnds = new Map();
    for (const [start, end, kind] of state.ast.text) {
        const mark = MARK_OF_KIND[kind];
        if (mark === MARK_TEXT) textMask.fill(MARK_TEXT, start, end);
        else { textMask[start] = mark; for (let i = start + 1; i < end; i++) textMask[i] = MARK_INSIDE; nodeEnds.set(start, end); }
    }
    specialStarts = [...nodeEnds.keys()].sort((x, y) => x - y);
}

/**
 * Returns the places in the code of each character of a text, when the plain markup text
 * from a place on reads as the text.
 * @param {string} text - the text as the page shows it.
 * @param {number} place - where it would start in the compiled code.
 * @returns {number[]|null} the place of each character and of the text's end, null when the code does not read so there.
 */
export function getRunPlaces(text, place) {
    const code = state.compiledCode, length = code.length;
    const places = new Array(text.length + 1);
    let k = place;
    for (let j = 0; j < text.length; j++) {
        const character = text[j];
        places[j] = k;
        const mark = textMask[k];
        if (mark === MARK_SHORTHAND || mark === MARK_ESCAPE) {
            const end = nodeEnds.get(k), source = code.slice(k, end);
            if (getShownText(source, mark) === character || (mark === MARK_SHORTHAND && source === '~' && character === ' ')) { k = end; continue; }
            return null;
        }
        if (/\s/.test(character)) {
            if (k >= length || !/\s/.test(code[k])) return null;
            while (k < length && /[ \t]/.test(code[k])) k++;
            if (code[k] === '\n') { k++; while (k < length && /[ \t]/.test(code[k])) k++; }
            continue;
        }
        if (mark === MARK_TEXT && code[k] === character) { k++; continue; }
        if (mark === MARK_QUOTE && /['"’‘“”«»„‚]/.test(character)) { k++; continue; }
        return null;
    }
    places[text.length] = k;
    return places;
}

/**
 * Returns what a shorthand or an escape shows on the page.
 * @param {string} source - its code.
 * @param {number} mark - MARK_SHORTHAND or MARK_ESCAPE.
 * @returns {string|undefined} the character it shows.
 */
function getShownText(source, mark) {
    if (mark !== MARK_ESCAPE) return SHORTHANDS[source];
    return /^\\u\{([0-9a-fA-F]+)\}$/.test(source) ? String.fromCodePoint(parseInt(source.slice(3, -1), 16)) : source.slice(1);
}

/**
 * Returns the places of a run's text in the code: looked for by its first letters from a place
 * on (then from the start), or among the quotes, dashes and escapes when it starts with one.
 * @param {string} core - the run's text.
 * @param {number} from - where the run before it ended.
 * @returns {number[]|null} the places, null when it is not in the code.
 */
function findRunPlaces(core, from) {
    const code = state.compiledCode;
    const word = (/^[\p{L}\p{N}]+/u.exec(core) || [core[0]])[0];
    for (const [start, end] of [[from, code.length], [0, from]]) {
        let tries = 0;
        for (let p = code.indexOf(word, start); p >= 0 && p < end && tries < MAX_TRIES; p = code.indexOf(word, p + 1), tries++) {
            if (textMask[p] !== MARK_TEXT) continue;
            const places = getRunPlaces(core, p);
            if (places) return places;
        }
    }
    if (/^[\p{L}\p{N}]/u.test(core)) return null;
    const first = specialStarts.findIndex(p => p >= from);
    const order = first < 0 ? specialStarts : [...specialStarts.slice(first), ...specialStarts.slice(0, first)];
    for (const p of order.slice(0, MAX_TRIES)) {
        const places = getRunPlaces(core, p);
        if (places) return places;
    }
    return null;
}

/**
 * Finds the runs of the pages in the code (the steps in the header).
 * @returns {void}
 */
export function updateRuns() {
    setTextMask();
    const runs = [];
    let from = 0;
    for (const [pageIndex, page] of state.pages.entries()) {
        for (const element of page.querySelectorAll('.typst-text')) {
            const run = createRun(element, pageIndex);
            if (!run) continue;
            runs.push(run);
            if (setRunPlaces(run, from)) from = run.end;
        }
    }
    state.runs = runs;
    state.sourceRuns = runs.filter(run => run.start != null).sort((a, b) => a.start - b.start);
    runByElement = new Map(runs.map(run => [run.element, run]));
}

/**
 * Creates the run of a .typst-text element, not yet placed in the code.
 * @param {Element} element - the element.
 * @param {number} pageIndex - the index of its page.
 * @returns {import('./state.js').TextRun|null} the run, null when it has no text layer.
 */
function createRun(element, pageIndex) {
    const textLayer = element.querySelector('.tsel');
    if (!textLayer) return null;
    const text = textLayer.textContent;
    return { element, page: pageIndex, text, lead: text.length - text.trimStart().length, core: text.trim(), start: null, end: null, places: null, editable: false };
}

/**
 * Places a run in the code; a run that ends with a hyphen (a word broken at the line's end) is
 * looked for without it and cannot be edited on the page. Returns whether it was found, as the
 * caller goes on from its end.
 * @param {import('./state.js').TextRun} run - the run.
 * @param {number} from - where the run before it ended.
 * @returns {boolean} true when it is in the code.
 */
function setRunPlaces(run, from) {
    if (!run.core) return false;
    let core = run.core;
    let places = findRunPlaces(core, from), hyphen = false;
    if (!places && /[-‐]$/.test(core) && core.length > 1) {
        places = findRunPlaces(core.slice(0, -1), from);
        hyphen = !!places;
        if (places) core = core.slice(0, -1);
    }
    if (!places) return false;
    run.core = core;
    run.places = places;
    run.start = places[0];
    run.end = places[core.length];
    run.editable = !hyphen;
    return true;
}

/**
 * Returns the run of a .typst-text element.
 * @param {Element|null} element - the element.
 * @returns {import('./state.js').TextRun|undefined} the run.
 */
export function getRunOfElement(element) {
    return runByElement.get(element);
}

/**
 * Returns the run found in the code whose text holds a place, or the last one before it.
 * @param {number} place - the place in the code.
 * @returns {import('./state.js').TextRun|null} the run, null when no run starts at or before it.
 */
export function getRunAtPlace(place) {
    const list = state.sourceRuns || [];
    let low = 0, high = list.length - 1, best = -1;
    while (low <= high) { const middle = (low + high) >> 1; if (list[middle].start <= place) { best = middle; low = middle + 1; } else high = middle - 1; }
    return best < 0 ? null : list[best];
}

/**
 * Returns the place in the code for any element on a page: in its own run, the character
 * under x; else after the run before it on the page (math, pictures, lines), or the start of
 * the run after it.
 * @param {Element} element - the element.
 * @param {number|null} x - the pointer's x on the screen, null for the start of a run.
 * @returns {number|null} the place, null when the page has no run in the code.
 */
export function getElementPlace(element, x) {
    const group = element.closest('.typst-text');
    const own = group && runByElement.get(group);
    if (own && own.start != null) return own.start + (own.places[getCharacterIndex(own, x)] - own.start);
    const page = element.closest('.sheet');
    let before = null, after = null;
    for (const run of state.runs) {
        if (run.start == null || run.element.closest('.sheet') !== page) continue;
        const relation = run.element.compareDocumentPosition(element);
        if (relation & Node.DOCUMENT_POSITION_FOLLOWING) before = run;
        else if (!after && relation & Node.DOCUMENT_POSITION_PRECEDING) after = run;
    }
    if (before) return getPlaceAfterRun(before, after);
    return after ? after.start : null;
}

/**
 * Returns where the code of an element after a run starts: the formula right after the run,
 * or the place past the closing brackets and markers of the run.
 * @param {import('./state.js').TextRun} before - the run before the element.
 * @param {import('./state.js').TextRun|null} after - the run after it.
 * @returns {number} the place.
 */
function getPlaceAfterRun(before, after) {
    const math = state.ast.math.find(([start]) => start >= before.end && start - before.end < MATH_DISTANCE);
    if (math && !(after && after.start < math[0])) return math[0];
    const code = state.compiledCode;
    let place = before.end;
    while (place < code.length && /[\])}*_\s]/.test(code[place]) && !(after && place >= after.start)) place++;
    return place;
}

/**
 * Returns which character of a run is under x: by its glyphs when there is one per character,
 * else by the share of the width.
 * @param {import('./state.js').TextRun} run - the run.
 * @param {number|null} x - the pointer's x on the screen.
 * @returns {number} the index in the run's core, 0 without x.
 */
export function getCharacterIndex(run, x) {
    const length = run.core.length;
    if (x == null) return 0;
    const glyphs = [...run.element.querySelectorAll(':scope > use')];
    if (glyphs.length === run.text.length) {
        let best = 0, bestDistance = Infinity;
        glyphs.forEach((glyph, index) => {
            const box = glyph.getBoundingClientRect();
            const distance = Math.abs(box.left + box.width / 2 - x);
            if (distance < bestDistance) { bestDistance = distance; best = x > box.left + box.width / 2 ? index + 1 : index; }
        });
        return getNumberInRange(best - run.lead, 0, length);
    }
    const box = getTextBox(run).getBoundingClientRect();
    return getNumberInRange(Math.round((x - box.left) / Math.max(1, box.width) * length), 0, length);
}

/**
 * Returns the element whose box is the run's text: its text layer, else the run itself.
 * @param {import('./state.js').TextRun} run - the run.
 * @returns {Element} the element.
 */
export function getTextBox(run) {
    return run.element.querySelector('foreignObject') || run.element;
}
