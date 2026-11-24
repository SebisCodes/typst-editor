/**
 * The Document tab: settings that edit the #set rules of the code (paper, margins,
 * orientation, font, size, language, line spacing, columns, justified text, numbered headings,
 * page numbers, title and author) and a count of pages and words. Each change keeps the rest of
 * the code as it is, keeps the cursor and is one undo step; a missing rule is added at the
 * top, an empty one removed (typst-rules.js).
 */

import { escapeHtml } from './typst.js?v=8';
import { findSetRule, getSetArgument, getCodeWithArgument, formatString, getStringValue, PAPERS } from './typst-rules.js?v=3';
import { state, ui, POINTS_PER_MILLIMETER, showToast } from './state.js?v=3';
import { setCode } from './history.js?v=7';

const PAPER_CHOICES = [
    ['a4', 'A4 (210 × 297 mm)'], ['a5', 'A5 (148 × 210 mm)'], ['a3', 'A3 (297 × 420 mm)'], ['us-letter', 'US Letter'], ['us-legal', 'US Legal'],
    ['sq', 'Square 120 × 120 mm (1:1)'], ['p45', 'Portrait 4:5 (120 × 150 mm)'], ['story', 'Story 9:16 (90 × 160 mm)'], ['wide', 'Slide 16:9 (160 × 90 mm)'], ['custom', 'Other size'],
];
/** The social media formats: width and height in millimeters. */
const SOCIAL = { sq: [120, 120], p45: [120, 150], story: [90, 160], wide: [160, 90] };
const MARGINS = [['', 'Typst default (about 2.5 cm)'], ['2.5cm', 'Normal (2.5 cm)'], ['2cm', 'Narrow (2 cm)'], ['1.5cm', 'Very narrow (1.5 cm)'], ['3.5cm', 'Wide (3.5 cm)'], ['0mm', 'None'], ['other', 'Other']];
const FONTS = [['', 'Libertinus Serif (Typst default)'], ['"New Computer Modern"', 'New Computer Modern (like LaTeX)'], ['"DejaVu Sans Mono"', 'DejaVu Sans Mono (typewriter)']];
const SIZES = [['', '11 pt (default)'], ['9pt', '9 pt'], ['10pt', '10 pt'], ['11pt', '11 pt'], ['12pt', '12 pt'], ['14pt', '14 pt']];
const LANGUAGES = [['', 'English (default)'], ['de', 'German'], ['de-ch', 'German (Switzerland)'], ['fr', 'French'], ['it', 'Italian'], ['es', 'Spanish']];
const LEADING = [['', 'Normal'], ['0.9em', 'More'], ['1.2em', '1½ lines'], ['1.6em', 'Double']];
/** The margin of a social media format, when the code has none. */
const SOCIAL_MARGIN = '8mm';
/** The size an "Other size" page starts with. */
const CUSTOM_WIDTH = '150mm';
const CUSTOM_HEIGHT = '100mm';
/** The margins an "Other" choice writes. */
const OTHER_MARGINS = '(left: 3cm, right: 2cm, top: 2.5cm, bottom: 2.5cm)';
/** How long the title and author fields wait after typing, in milliseconds. */
const TYPING_DELAY = 350;
/** The timers of the title and author fields. */
const typingTimers = new WeakMap();

/**
 * Sets a code changed by a setting: the cursor stays on its text, the change is one undo step.
 * @param {string} code - the changed code.
 * @param {string|false} message - a toast to show, false for none.
 * @returns {void}
 */
export function setSettingCode(code, message) {
    if (code === state.code) return;
    const textarea = ui.ta, selectionStart = textarea.selectionStart, selectionEnd = textarea.selectionEnd;
    const changedAt = getFirstDifference(state.code, code);
    const delta = code.length - state.code.length;
    setCode(code);
    textarea.setSelectionRange(selectionStart > changedAt ? selectionStart + delta : selectionStart, selectionEnd > changedAt ? selectionEnd + delta : selectionEnd);
    if (message) showToast(message);
}

/**
 * Returns where two texts start to differ.
 * @param {string} a - one text.
 * @param {string} b - the other.
 * @returns {number} the first place where they differ (the end of the shorter one when one starts the other).
 */
function getFirstDifference(a, b) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return i;
}

/**
 * Returns the paper choice the code has.
 * @param {string} code - the Typst code.
 * @returns {string} a key of PAPER_CHOICES: a size by name, a social media format, or "custom".
 */
function getPaper(code) {
    const width = getSetArgument(code, 'page', 'width'), height = getSetArgument(code, 'page', 'height');
    if (width && height) {
        for (const [key, [w, h]] of Object.entries(SOCIAL)) if (width === w + 'mm' && height === h + 'mm') return key;
        return 'custom';
    }
    const paper = getStringValue(getSetArgument(code, 'page', 'paper'));
    return paper && PAPERS[paper] ? paper : paper ? 'custom' : 'a4';
}

/**
 * Returns the code with a paper choice: a size by name, a social media format (with a small
 * margin when the code has none) or an "Other size" to change in the code.
 * @param {string} code - the Typst code.
 * @param {string} paper - a key of PAPER_CHOICES.
 * @returns {string} the changed code.
 */
function getCodeWithPaper(code, paper) {
    code = getCodeWithArgument(code, 'page', 'width', null);
    code = getCodeWithArgument(code, 'page', 'height', null);
    if (SOCIAL[paper]) {
        code = getCodeWithArgument(code, 'page', 'paper', null);
        code = getCodeWithArgument(code, 'page', 'width', SOCIAL[paper][0] + 'mm');
        code = getCodeWithArgument(code, 'page', 'height', SOCIAL[paper][1] + 'mm');
        if (!getSetArgument(code, 'page', 'margin')) code = getCodeWithArgument(code, 'page', 'margin', SOCIAL_MARGIN);
    } else if (paper === 'custom') {
        code = getCodeWithArgument(code, 'page', 'paper', null);
        code = getCodeWithArgument(code, 'page', 'width', CUSTOM_WIDTH);
        code = getCodeWithArgument(code, 'page', 'height', CUSTOM_HEIGHT);
    } else code = getCodeWithArgument(code, 'page', 'paper', formatString(paper));
    return code;
}

/**
 * Returns the options of a select, the current value marked; a value not in the list is added.
 * @param {Array<[string, string]>} list - [value, label] of each option.
 * @param {string} current - the current value.
 * @returns {string} the HTML of the options.
 */
function formatOptions(list, current) {
    const options = list.some(([value]) => value === current) ? list : [...list, [current, current]];
    return options.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

/**
 * Draws the Document tab from the code; a field being typed in keeps what is typed.
 * @returns {void}
 */
export function renderSettingsPanel() {
    if (ui.inspector.contains(document.activeElement) && document.activeElement.matches('input, textarea')) return;
    const code = state.code;
    const margin = getSetArgument(code, 'page', 'margin');
    const marginValue = margin == null ? '' : MARGINS.some(([value]) => value === margin) ? margin : 'other';
    const language = getStringValue(getSetArgument(code, 'text', 'lang')) || '';
    const region = (getStringValue(getSetArgument(code, 'text', 'region')) || '').toLowerCase();
    const languageValue = language === 'en' ? '' : language === 'de' && region === 'ch' ? 'de-ch' : language;
    const title = getSetArgument(code, 'document', 'title'), author = getSetArgument(code, 'document', 'author');
    ui.inspector.innerHTML = `
        <div class="doc-form">
            <label class="field"><span>Paper</span><select id="d-paper">${formatOptions(PAPER_CHOICES, getPaper(code))}</select></label>
            <div class="row2">
                <label class="field"><span>Margins</span><select id="d-margin">${formatOptions(MARGINS, marginValue)}</select></label>
                <label class="field"><span>Orientation</span><select id="d-orient">${formatOptions([['', 'Portrait'], ['true', 'Landscape']], getSetArgument(code, 'page', 'flipped') === 'true' ? 'true' : '')}</select></label>
            </div>
            <div class="row2">
                <label class="field"><span>Font</span><select id="d-font">${formatOptions(FONTS, getSetArgument(code, 'text', 'font') || '')}</select></label>
                <label class="field"><span>Font size</span><select id="d-size">${formatOptions(SIZES, getSetArgument(code, 'text', 'size') || '')}</select></label>
            </div>
            <div class="row2">
                <label class="field"><span>Language</span><select id="d-lang">${formatOptions(LANGUAGES, languageValue)}</select></label>
                <label class="field"><span>Line spacing</span><select id="d-leading">${formatOptions(LEADING, getSetArgument(code, 'par', 'leading') || '')}</select></label>
            </div>
            <label class="field"><span>Columns</span><select id="d-cols">${formatOptions([['1', 'One'], ['2', 'Two'], ['3', 'Three']], getSetArgument(code, 'page', 'columns') || '1')}</select></label>
            <label class="box"><input type="checkbox" id="d-justify"${getSetArgument(code, 'par', 'justify') === 'true' ? ' checked' : ''}> Justified text (both edges straight)</label>
            <label class="box"><input type="checkbox" id="d-hnum"${getSetArgument(code, 'heading', 'numbering') ? ' checked' : ''}> Numbered headings (1., 1.1 …)</label>
            <label class="box"><input type="checkbox" id="d-nums"${getSetArgument(code, 'page', 'numbering') ? ' checked' : ''}> Page numbers</label>
            <p class="subhead">Title</p>
            <label class="field"><span>Title <small>(of the PDF; #title() shows it)</small></span><textarea id="d-title" rows="1" spellcheck="true">${escapeHtml(title == null ? '' : getStringValue(title) ?? title)}</textarea></label>
            <label class="field"><span>Author</span><input id="d-author" value="${escapeHtml(author == null ? '' : getStringValue(author) ?? author)}" spellcheck="false"></label>
            <div class="button-row"><button type="button" class="button" id="d-showtitle"${/#title\(/.test(code) ? ' disabled' : ''}>Show the title (#title())</button></div>
        </div>${formatDocumentInfo()}`;
}

/**
 * Returns the line about the document: pages, words, the size of the first page and how long
 * the compile took.
 * @returns {string} the HTML, "" before the first page.
 */
function formatDocumentInfo() {
    const size = state.sizes[0];
    if (!size) return '';
    const words = state.runs.reduce((count, run) => count + (run.text.match(/[\p{L}\p{N}]+/gu) || []).length, 0);
    return `<div class="doc-info"><b>${state.pages.length}</b> ${state.pages.length === 1 ? 'page' : 'pages'} · about <b>${words.toLocaleString('en')}</b> words · ${Math.round(size.w / POINTS_PER_MILLIMETER)} × ${Math.round(size.h / POINTS_PER_MILLIMETER)} mm${state.compileMs ? ` · compiled in ${state.compileMs} ms` : ''}</div>`;
}

/**
 * Returns the code with the setting of a changed field.
 * @param {HTMLInputElement|HTMLSelectElement} field - the field.
 * @param {string} code - the Typst code.
 * @returns {string|null} the changed code, null for a field that is no setting.
 */
function getCodeWithSetting(field, code) {
    const value = field.value;
    switch (field.id) {
        case 'd-paper': return getCodeWithPaper(code, value);
        case 'd-margin': return getCodeWithArgument(code, 'page', 'margin', value === 'other' ? OTHER_MARGINS : value || null);
        case 'd-orient': return getCodeWithArgument(code, 'page', 'flipped', value ? 'true' : null);
        case 'd-font': return getCodeWithArgument(code, 'text', 'font', value || null);
        case 'd-size': return getCodeWithArgument(code, 'text', 'size', value || null);
        case 'd-lang': return getCodeWithLanguage(code, value);
        case 'd-leading': return getCodeWithArgument(code, 'par', 'leading', value || null);
        case 'd-cols': return getCodeWithArgument(code, 'page', 'columns', value === '1' ? null : value);
        case 'd-justify': return getCodeWithArgument(code, 'par', 'justify', field.checked ? 'true' : null);
        case 'd-hnum': return getCodeWithArgument(code, 'heading', 'numbering', field.checked ? formatString('1.') : null);
        case 'd-nums': return getCodeWithArgument(code, 'page', 'numbering', field.checked ? formatString('1') : null);
        default: return null;
    }
}

/**
 * Returns the code with a language and its region ("de-ch") in #set text.
 * @param {string} code - the Typst code.
 * @param {string} value - the language choice, "" for English.
 * @returns {string} the changed code.
 */
function getCodeWithLanguage(code, value) {
    const [language, region] = value.split('-');
    code = getCodeWithArgument(code, 'text', 'lang', language ? formatString(language) : null);
    return getCodeWithArgument(code, 'text', 'region', region ? formatString(region) : null);
}

/**
 * Writes a changed select or checkbox into the code (a change handler).
 * @param {Event} event - the change.
 * @returns {void}
 */
function setSettingOnChange(event) {
    const field = event.target;
    const code = getCodeWithSetting(field, state.code);
    if (code == null) return;
    if (field.id === 'd-paper' && field.value === 'custom') showToast('Change width and height in the #set page(…) line');
    setSettingCode(code, false);
}

/**
 * Writes the title or author a moment after typing pauses (an input handler); line breaks of
 * the title become spaces, an empty field removes the argument.
 * @param {Event} event - the input.
 * @returns {void}
 */
function setTitleOnInput(event) {
    const field = event.target;
    if (field.id !== 'd-title' && field.id !== 'd-author') return;
    clearTimeout(typingTimers.get(field));
    typingTimers.set(field, setTimeout(() => setSettingCode(getCodeWithArgument(state.code, 'document', field.id === 'd-title' ? 'title' : 'author', field.value.trim() ? formatString(field.value.replace(/\n/g, ' ')) : null), false), TYPING_DELAY));
}

/**
 * Adds #title() after the #set lines at the top; without a title in #set document the
 * document's name becomes the title.
 * @returns {void}
 */
function addTitle() {
    let code = state.code;
    if (!findSetRule(code, 'document')) code = getCodeWithArgument(code, 'document', 'title', formatString(state.name));
    let at = findSetRule(code, 'document').end;
    if (code[at] === '\n') at++;
    const rules = /^(?:[ \t]*(?:#(?:set|show|import|let)\b[^\n]*|\/\/[^\n]*)?\n)*/.exec(code.slice(at));
    at += rules ? rules[0].length : 0;
    setSettingCode(code.slice(0, at) + '\n#title()\n' + code.slice(at), 'Title added');
}

/**
 * Connects the Document tab: its fields, the button that shows the title, and a redraw when
 * the focus leaves the tab.
 * @returns {void}
 */
export function startSettingsPanel() {
    ui.inspector.addEventListener('change', setSettingOnChange);
    ui.inspector.addEventListener('input', setTitleOnInput);
    ui.inspector.addEventListener('focusout', () => setTimeout(() => { if (!ui.inspector.contains(document.activeElement)) renderSettingsPanel(); }, 0));
    ui.inspector.addEventListener('click', event => { if (event.target.id === 'd-showtitle') addTitle(); });
}
