/**
 * Reading a ZIP with a .typ file and its pictures and files (stored or deflated) as one
 * document. The main file is main.typ, else the largest .typ; the other files keep their folder
 * as seen from the main file (images/logo.png), as the code refers to them.
 *
 * Limits keep a hostile ZIP from stopping the tab: at most 100 MB as a file, 2000 entries, and
 * 100 MB unpacked in all (a small ZIP can unpack to gigabytes).
 */

import { ACCEPTED_FILES, FILE_TYPES, getExtension } from './document-files.js?v=5';
import { readAsDataUrl } from './assets.js?v=6';

const MEGABYTE = 1024 * 1024;
/** The largest ZIP file read, and the most it may unpack to, in bytes. */
const MAX_ZIP_SIZE = 100 * MEGABYTE;
const MAX_UNPACKED_SIZE = 100 * MEGABYTE;
const MAX_ENTRIES = 2000;
/** The signature of the end of the central directory. */
const END_SIGNATURE = 0x06054b50;
/** The size of the end record and how far before it a comment may reach. */
const END_RECORD_SIZE = 22;
const MAX_END_SEARCH = 65557;
/** The sizes of the fixed parts of a central directory entry and of a local header. */
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
/** Where the fields stand in the end record, a central directory entry and a local header (ZIP format). */
const END_ENTRY_COUNT = 10;
const END_DIRECTORY_START = 16;
const CENTRAL_METHOD = 10;
const CENTRAL_PACKED_SIZE = 20;
const CENTRAL_NAME_LENGTH = 28;
const CENTRAL_EXTRA_LENGTH = 30;
const CENTRAL_COMMENT_LENGTH = 32;
const CENTRAL_LOCAL_OFFSET = 42;
const LOCAL_NAME_LENGTH = 26;
const LOCAL_EXTRA_LENGTH = 28;
/** The compression method of entries stored as they are. */
const STORED = 0;

/**
 * An entry of the ZIP, still packed.
 * @typedef {object} ZipEntry
 * @property {string} name - its path in the ZIP.
 * @property {number} method - its compression method (0 stored, 8 deflated).
 * @property {Uint8Array} data - its packed bytes.
 */

/**
 * What a ZIP may still unpack to.
 * @typedef {object} UnpackBudget
 * @property {number} left - the bytes left.
 */

/**
 * The document a ZIP holds.
 * @typedef {object} ZipDocument
 * @property {string} name - the main file's name without .typ.
 * @property {string} code - its code.
 * @property {Object<string, string>} files - the other files: name -> data URI.
 */

/**
 * Returns the document a ZIP holds.
 * @param {File} file - the ZIP file.
 * @returns {Promise<ZipDocument>} the document.
 * @throws {Error} with the reason, when the file is too large, no ZIP, holds too many files,
 *   unpacks to too much or has no .typ file (the Promise rejects).
 */
export async function readZipDocument(file) {
    if (file.size > MAX_ZIP_SIZE) throw new Error('it is larger than 100 MB');
    const entries = getZipEntries(new Uint8Array(await file.arrayBuffer()));
    const budget = { left: MAX_UNPACKED_SIZE };
    const usable = entries.filter(entry => !/(^|\/)(\.|__MACOSX)/.test(entry.name) && !/\/$/.test(entry.name));
    const typstFiles = usable.filter(entry => /\.typ$/i.test(entry.name));
    if (!typstFiles.length) throw new Error('there is no .typ file in it');
    const main = typstFiles.find(entry => /(^|\/)main\.typ$/i.test(entry.name)) || typstFiles.slice().sort((a, b) => b.data.length - a.data.length)[0];
    const code = new TextDecoder().decode(await readEntry(main, budget));
    const files = {};
    const folder = main.name.slice(0, main.name.lastIndexOf('/') + 1);
    for (const entry of usable) {
        if (entry === main || !ACCEPTED_FILES.test(entry.name)) continue;
        const name = getFileName(entry.name, folder);
        files[name] = await readAsDataUrl(new Blob([await readEntry(entry, budget)], { type: FILE_TYPES[getExtension(name)] || 'application/octet-stream' }));
    }
    return { name: main.name.replace(/^.*\//, '').replace(/\.typ$/i, ''), code, files };
}

/**
 * Returns the entries of a ZIP from its central directory.
 * @param {Uint8Array} bytes - the ZIP file.
 * @returns {ZipEntry[]} the entries.
 * @throws {Error} when it is no ZIP or holds more than 2000 files.
 */
function getZipEntries(bytes) {
    const view = new DataView(bytes.buffer);
    let end = -1;
    for (let i = bytes.length - END_RECORD_SIZE; i >= Math.max(0, bytes.length - MAX_END_SEARCH); i--) if (view.getUint32(i, true) === END_SIGNATURE) { end = i; break; }
    if (end < 0) throw new Error('it is not a ZIP file');
    const count = view.getUint16(end + END_ENTRY_COUNT, true);
    if (count > MAX_ENTRIES) throw new Error('it holds more than 2000 files');
    let place = view.getUint32(end + END_DIRECTORY_START, true);
    const entries = [];
    for (let k = 0; k < count; k++) {
        const method = view.getUint16(place + CENTRAL_METHOD, true), packedSize = view.getUint32(place + CENTRAL_PACKED_SIZE, true), nameLength = view.getUint16(place + CENTRAL_NAME_LENGTH, true),
            extraLength = view.getUint16(place + CENTRAL_EXTRA_LENGTH, true), commentLength = view.getUint16(place + CENTRAL_COMMENT_LENGTH, true), offset = view.getUint32(place + CENTRAL_LOCAL_OFFSET, true);
        const name = new TextDecoder().decode(bytes.subarray(place + CENTRAL_HEADER_SIZE, place + CENTRAL_HEADER_SIZE + nameLength));
        const start = offset + LOCAL_HEADER_SIZE + view.getUint16(offset + LOCAL_NAME_LENGTH, true) + view.getUint16(offset + LOCAL_EXTRA_LENGTH, true);
        entries.push({ name, method, data: bytes.subarray(start, start + packedSize) });
        place += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    }
    return entries;
}

/**
 * Reads the bytes of an entry, unpacked, and takes their size from the budget (a reader that
 * consumes its budget as it goes).
 * @param {ZipEntry} entry - the entry.
 * @param {UnpackBudget} budget - the bytes the ZIP may still unpack to.
 * @returns {Promise<Uint8Array>} the bytes.
 * @throws {Error} when the budget runs out (the Promise rejects).
 */
async function readEntry(entry, budget) {
    if (entry.method === STORED) {
        budget.left -= entry.data.length;
        if (budget.left < 0) throw createTooBigError();
        return entry.data;
    }
    const reader = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const parts = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        budget.left -= value.length;
        if (budget.left < 0) { reader.cancel(); throw createTooBigError(); }
        parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const part of parts) { bytes.set(part, at); at += part.length; }
    return bytes;
}

/**
 * Creates the error of a ZIP that unpacks to too much.
 * @returns {Error} the error.
 */
function createTooBigError() {
    return new Error('it unpacks to more than 100 MB');
}

/**
 * Returns the name a file of the ZIP gets: its path as seen from the main file's folder, or
 * its name alone when the path leaves that folder or has empty or relative parts.
 * @param {string} path - its path in the ZIP.
 * @param {string} folder - the main file's folder, "" at the top.
 * @returns {string} the name.
 */
function getFileName(path, folder) {
    const relative = path.startsWith(folder) ? path.slice(folder.length) : path.replace(/^.*\//, '');
    return relative.split('/').some(part => !part || part === '.' || part === '..') ? path.replace(/^.*\//, '') : relative;
}
