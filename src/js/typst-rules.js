/**
 * The #set rules the document settings read and change, and Typst string literals.
 */

import { getBlankedCode, getClosingBracket } from './typst-code.js?v=3';

/** Page sizes Typst knows by name, in millimeters (width, height). */
export const PAPERS = {
    a4: [210, 297], a5: [148, 210], a3: [297, 420], 'us-letter': [215.9, 279.4], 'us-legal': [215.9, 355.6],
};
/**
 * An argument of a #set rule.
 * @typedef {object} RuleArgument
 * @property {string|null} key - its name, null for an argument without one.
 * @property {string} value - its value as written in the code.
 * @property {number} a - where it starts.
 * @property {number} b - where it ends.
 */

/**
 * A #set rule in the code.
 * @typedef {object} SetRule
 * @property {number} start - where "#set" starts.
 * @property {number} end - the place after its ")".
 * @property {number} open - the place of its "(".
 * @property {number} close - the place of its ")".
 * @property {RuleArgument[]} args - its arguments in order.
 */

/**
 * Returns the first "#set name(…)" at the top level of the markup, with its arguments.
 * @param {string} code - the Typst code.
 * @param {string} name - the function the rule sets ("page", "text", "math.equation" …).
 * @returns {SetRule|null} the rule, null when there is none or it is not closed.
 */
export function findSetRule(code, name) {
    const blanked = getBlankedCode(code);
    const match = new RegExp(`(^|\\n)[ \\t]*#set[ \\t]+${name}[ \\t]*\\(`, 'g').exec(blanked);
    if (!match) return null;
    const start = match.index + match[1].length;
    const open = match.index + match[0].length - 1;
    const close = getClosingBracket(blanked, open);
    if (close < 0) return null;
    return { start, end: close + 1, open, close, args: getRuleArguments(code, blanked, open, close) };
}

/**
 * Returns the arguments between the brackets of a rule, split at the commas of their level.
 * @param {string} code - the Typst code.
 * @param {string} blanked - the blanked code.
 * @param {number} open - the place of "(".
 * @param {number} close - the place of ")".
 * @returns {RuleArgument[]} the arguments that are not empty.
 */
function getRuleArguments(code, blanked, open, close) {
    const args = [];
    let start = open + 1, depth = 0;
    for (let k = open + 1; k <= close; k++) {
        const c = blanked[k];
        if (k < close && '([{'.includes(c)) depth++;
        else if (k < close && ')]}'.includes(c)) depth--;
        else if (k === close || (c === ',' && !depth)) {
            const argument = getRuleArgument(code, start, k);
            if (argument) args.push(argument);
            start = k + 1;
        }
    }
    return args;
}

/**
 * Returns one argument of a rule: "key: value" or a value alone.
 * @param {string} code - the Typst code.
 * @param {number} start - where the argument's text starts (after "(" or ",").
 * @param {number} end - where it ends (at "," or ")").
 * @returns {RuleArgument|null} the argument, null when its text is empty.
 */
function getRuleArgument(code, start, end) {
    const raw = code.slice(start, end);
    if (!raw.trim()) return null;
    const keyMatch = /^\s*([\p{L}_][\p{L}\p{N}_-]*)\s*:(?!:)\s*/u.exec(raw);
    const lead = /^\s*/.exec(raw)[0].length;
    const a = start + lead, b = start + raw.trimEnd().length;
    return keyMatch ? { key: keyMatch[1], value: raw.slice(keyMatch[0].length).trim(), a, b } : { key: null, value: raw.trim(), a, b };
}

/**
 * Returns the value of an argument of "#set name(…)" as written in the code.
 * @param {string} code - the Typst code.
 * @param {string} name - the function the rule sets.
 * @param {string} key - the argument's name.
 * @returns {string|null} the value, null when the rule or the argument is missing.
 */
export function getSetArgument(code, name, key) {
    const rule = findSetRule(code, name);
    const argument = rule && rule.args.find(item => item.key === key);
    return argument ? argument.value : null;
}

/**
 * Returns where new #set rules go: after the #set / #import / #show / #let lines at the top
 * of the document (and comments between them), else at the start.
 * @param {string} code - the Typst code.
 * @returns {number} the place.
 */
function getNewRulePlace(code) {
    let lineStart = 0, place = 0;
    for (const line of code.split('\n')) {
        const trimmed = line.trim();
        if (/^#(set|import|show|let)\b/.test(trimmed)) place = lineStart + line.length + 1;
        else if (trimmed && !/^\/\//.test(trimmed)) break;
        lineStart += line.length + 1;
    }
    return Math.min(place, code.length);
}

/**
 * Returns the code with "key: value" set in "#set name(…)" (a value of null removes it). A rule
 * left without arguments is removed; a missing rule is added at the top.
 * @param {string} code - the Typst code.
 * @param {string} name - the function the rule sets.
 * @param {string} key - the argument's name.
 * @param {string|null} value - the value as Typst code, null to remove the argument.
 * @returns {string} the changed code (the same code when nothing changes).
 */
export function getCodeWithArgument(code, name, key, value) {
    const rule = findSetRule(code, name);
    if (!rule) return value == null ? code : getCodeWithNewRule(code, name, key, value);
    const argument = rule.args.find(item => item.key === key);
    if (argument) return value != null ? code.slice(0, argument.a) + `${key}: ${value}` + code.slice(argument.b) : getCodeWithoutArgument(code, rule, argument);
    if (value == null) return code;
    const last = rule.args[rule.args.length - 1];
    if (!last) return code.slice(0, rule.open + 1) + `${key}: ${value}` + code.slice(rule.close);
    return code.slice(0, last.b) + `, ${key}: ${value}` + code.slice(last.b);
}

/**
 * Returns the code with a new rule "#set name(key: value)" on a line of its own at the top.
 * @param {string} code - the Typst code.
 * @param {string} name - the function the rule sets.
 * @param {string} key - the argument's name.
 * @param {string} value - its value as Typst code.
 * @returns {string} the changed code.
 */
function getCodeWithNewRule(code, name, key, value) {
    const place = getNewRulePlace(code);
    const lineBreak = place > 0 && code[place - 1] !== '\n' ? '\n' : '';
    return code.slice(0, place) + lineBreak + `#set ${name}(${key}: ${value})\n` + code.slice(place);
}

/**
 * Returns the code without one argument of a rule: with the comma before it (or after it, when
 * it is the first); the whole rule and its line break when it was the only one.
 * @param {string} code - the Typst code.
 * @param {SetRule} rule - the rule.
 * @param {RuleArgument} argument - the argument to remove.
 * @returns {string} the changed code.
 */
function getCodeWithoutArgument(code, rule, argument) {
    if (rule.args.length === 1) {
        let end = rule.end;
        if (code[end] === '\n') end++;
        return code.slice(0, rule.start) + code.slice(end);
    }
    const index = rule.args.indexOf(argument);
    if (index > 0) return code.slice(0, rule.args[index - 1].b) + code.slice(argument.b);
    return code.slice(0, argument.a) + code.slice(rule.args[1].a);
}

/**
 * Returns a Typst string literal.
 * @param {*} value - the text.
 * @returns {string} the text in quotes, with \ and " escaped.
 */
export function formatString(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * Returns the text of a string literal.
 * @param {string|null} value - a value as written in the code.
 * @returns {string|null} the text with its escapes read, null when the value is something else.
 */
export function getStringValue(value) {
    const match = /^"((?:[^"\\]|\\.)*)"$/.exec(String(value || '').trim());
    return match ? match[1].replace(/\\(.)/g, '$1') : null;
}
