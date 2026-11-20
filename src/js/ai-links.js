/**
 * Documents in AI links: reading the part after the # of a link, collecting the parts of a
 * long document, and finding the links in a pasted answer.
 *
 * A link carries the Typst code after the # (that part never reaches a server):
 *   #b64=<base64url of the UTF-8 code>   #typ=<URL-encoded code>   #z=<base64url of zlib-compressed code>
 * optional &mode=add (text added at the end), &file=new&name=NAME (a new document in
 * "My documents") or &file=NAME (that document), and, for long documents, &part=N&of=M&id=NAME
 * on each of M links; the parts are collected in localStorage until all have arrived.
 * Terminals break long links over several lines, so the AI's whole answer can be pasted:
 * the links are found and joined.
 */

const PARTS = 'typsteditor.parts.';
/** A link never carries more than this many characters, also once unpacked. */
const MAX_TEXT = 5e6;
/** Base64 is about a third longer than the text it carries. */
const MAX_ENCODED_TEXT = MAX_TEXT * 1.4;
/** Parts belong together only within this time. */
const PART_LIFETIME = 30 * 60e3;
const MAX_PARTS = 200;
const MAX_ID_LENGTH = 60;
const MAX_NAME_LENGTH = 80;
const KINDS = ['b64', 'z', 'typ'];
const INFLATE_FORMATS = ['deflate', 'deflate-raw', 'gzip'];
/** The start of a document in a link or a pasted answer. */
const LINK_START = /#((?:b64|z|typ)=)/g;
const LINK_START_TEST = /#(?:b64|z|typ)=/;
/** A line that holds only characters of a link continues the link of the line above it. */
const LINK_CHARACTERS = /^[A-Za-z0-9\-_=&%+/.~]+$/;
const CONTINUATION_LINE = /^[ \t]*\r?\n[ \t]*([^\s]+)[ \t]*(?=\r?\n|$)/;
const TRAILING_PUNCTUATION = /[)>\].,`*'"]+$/;

/**
 * The document parameters of a link.
 * @typedef {object} LinkParameters
 * @property {string} kind - "b64", "z" or "typ".
 * @property {string} data - the encoded document (or this part of it).
 * @property {string} mode - "add" or "set".
 * @property {number} part - the number of this part, 0 without parts.
 * @property {number} of - the number of parts, 0 without parts.
 * @property {string} id - the name that holds the parts together.
 * @property {{file: string, name: string}} target - which document: "new", a name, or "" for the open one.
 */

/**
 * What addLinkPart() returns: the joined data, the missing parts, or an error.
 * @typedef {object} CollectedParts
 * @property {string} [data] - the joined data once every part is there.
 * @property {number[]} [missing] - the numbers of the parts still missing.
 * @property {boolean} [error] - true when the parts are too many or too long.
 */

/**
 * Returns the bytes of base64 or base64url text (spaces read as "+", line breaks left out).
 * @param {string} text - the encoded text.
 * @returns {Uint8Array} the bytes.
 * @throws {DOMException} when the text is no base64.
 */
function convertFromBase64(text) {
    const base64 = text.replace(/ /g, '+').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/**
 * Unpacks compressed bytes: zlib, raw deflate or gzip, whichever reads.
 * @param {Uint8Array} bytes - the compressed bytes.
 * @returns {Promise<string>} the UTF-8 text.
 * @throws {Error} when it unpacks to more than 5 MB or cannot be unpacked.
 */
async function expandText(bytes) {
    for (const format of INFLATE_FORMATS) {
        try {
            return await expandAs(bytes, format);
        } catch (e) { if (e instanceof RangeError) throw new Error('The link unpacks to more than 5 MB - it is not opened.'); }
    }
    throw new Error('The compressed document could not be unpacked.');
}

/**
 * Unpacks compressed bytes in one format.
 * @param {Uint8Array} bytes - the compressed bytes.
 * @param {string} format - "deflate", "deflate-raw" or "gzip".
 * @returns {Promise<string>} the UTF-8 text.
 * @throws {RangeError} when it unpacks to more than 5 MB (a small link with a huge text is no document).
 * @throws {TypeError} when the bytes are not in this format.
 */
async function expandAs(bytes, format) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_TEXT) { reader.cancel(); throw new RangeError('too big'); }
        chunks.push(value);
    }
    return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

/**
 * Reads the document parameters of a link after the #.
 * @param {string} hash - the part after the # (with or without it).
 * @returns {LinkParameters|null} the parameters, null when the link carries no document.
 */
export function readHash(hash) {
    const query = getHashParameters(hash);
    const kind = KINDS.find(key => query.has(key));
    if (!kind) return null;
    return {
        kind, data: query.get(kind),
        mode: query.get('mode') === 'add' ? 'add' : 'set',
        part: +query.get('part') || 0, of: +query.get('of') || 0, id: (query.get('id') || 'document').slice(0, MAX_ID_LENGTH),
        target: { file: (query.get('file') || '').slice(0, MAX_NAME_LENGTH), name: (query.get('name') || '').replace(/\+/g, ' ').slice(0, MAX_NAME_LENGTH) },
    };
}

/**
 * Returns the parameters after the #, split by hand: URLSearchParams would turn the "+" of
 * normal base64 into spaces.
 * @param {string} hash - the part after the #.
 * @returns {Map<string, string>} the decoded values by name.
 */
function getHashParameters(hash) {
    const query = new Map();
    for (const pair of hash.replace(/^#/, '').split('&')) {
        const i = pair.indexOf('=');
        if (i < 0) continue;
        let value = pair.slice(i + 1);
        try { value = decodeURIComponent(value); } catch (e) { /* keep it as it is */ }
        query.set(pair.slice(0, i), value);
    }
    return query;
}

/**
 * Returns the links (the parts after the #) in a pasted text. A link that a terminal broke
 * over several lines continues on the following lines as long as they hold link characters only.
 * @param {string} text - the pasted text.
 * @returns {string[]} the links without the #, in order.
 */
export function findLinks(text) {
    const links = [];
    const start = new RegExp(LINK_START.source, 'g');
    let match;
    while ((match = start.exec(text))) {
        let i = match.index + 1, link = '';
        while (i < text.length && !/\s/.test(text[i])) link += text[i++];
        for (;;) {
            const next = text.slice(i).match(CONTINUATION_LINE);
            if (!next || !LINK_CHARACTERS.test(next[1]) || LINK_START_TEST.test(next[1])) break;
            link += next[1];
            i += next[0].length;
        }
        links.push(link.replace(TRAILING_PUNCTUATION, ''));
        start.lastIndex = i;
    }
    return links;
}

/**
 * Returns the text a link carries.
 * @param {string} kind - "b64", "z" or "typ".
 * @param {string} data - the encoded text.
 * @returns {Promise<string>} the text.
 * @throws {Error} when the link is too long or cannot be read.
 */
async function getLinkText(kind, data) {
    if (data.length > MAX_ENCODED_TEXT) throw new Error('The link is too long.');
    if (kind === 'typ') return data;
    const bytes = convertFromBase64(data);
    return kind === 'z' ? expandText(bytes) : new TextDecoder().decode(bytes);
}

/**
 * Collects one part of a long document in localStorage and returns the joined data once every
 * part is there (a command that returns what it collected: the caller needs it).
 * @param {LinkParameters} link - the parameters of the part.
 * @returns {CollectedParts} the joined data, the missing parts, or an error.
 */
function addLinkPart(link) {
    const key = PARTS + link.kind + '.' + link.id;
    let parts = {};
    try { parts = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { /* storage blocked */ }
    if (parts.of !== link.of || !(Date.now() - (parts.t || 0) < PART_LIFETIME)) parts = { of: link.of, p: {}, t: Date.now() };
    parts.p[link.part] = link.data;
    if (link.of > MAX_PARTS || Object.values(parts.p).reduce((sum, value) => sum + value.length, 0) > MAX_ENCODED_TEXT) {
        try { localStorage.removeItem(key); } catch (e) { /* storage blocked */ }
        return { error: true };
    }
    const missing = [];
    for (let n = 1; n <= link.of; n++) if (!(n in parts.p)) missing.push(n);
    try {
        if (missing.length) localStorage.setItem(key, JSON.stringify(parts));
        else localStorage.removeItem(key);
    } catch (e) { /* storage blocked: parts cannot be collected */ }
    return missing.length ? { missing } : { data: Array.from({ length: link.of }, (_, n) => parts.p[n + 1]).join('') };
}

/**
 * A document read from a link.
 * @typedef {object} LinkResult
 * @property {string} [doc] - the Typst code.
 * @property {string} [mode] - "add" or "set".
 * @property {{file: string, name: string}} [target] - which document.
 * @property {number[]} [missing] - the parts still missing.
 * @property {number} [part] - the number of the part that arrived.
 * @property {number} [of] - the number of parts.
 * @property {boolean} [error] - true when the link cannot be read.
 * @property {boolean} [busy] - true when the link is being taken by another paste.
 */

/**
 * Reads one link: the document, the missing parts while parts are missing, or an error.
 * A part of a long document is collected in localStorage as it is read (a reader
 * that consumes its input; the caller needs what it collected).
 * @param {string} hash - the part after the #.
 * @returns {Promise<LinkResult|null>} what the link holds, null when it carries no document.
 */
export async function readLink(hash) {
    const link = readHash(hash);
    if (!link) return null;
    let data = link.data;
    if (link.of > 1) {
        const collected = addLinkPart(link);
        if (collected.error) return { error: true };
        if (collected.missing) return { missing: collected.missing, part: link.part, of: link.of };
        data = collected.data;
    }
    try {
        const doc = await getLinkText(link.kind, data);
        if (!doc.trim() || /\uFFFD/.test(doc)) throw new Error('no text');
        return { doc, mode: link.mode, target: link.target };
    } catch (e) { return { error: true }; }
}
