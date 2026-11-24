/**
 * My documents: several documents kept in this browser (localStorage), no server.
 * typsteditor.files holds the list of entries, typsteditor.file.<id> the code of each document;
 * their pictures and files are in IndexedDB (assets.js). The editor works on one of them at a time;
 * files-dialog.js shows the list.
 *
 * Documents from a page around the editor are kept in memory only: they are in the list like
 * the others but never written to the browser's storage, and are gone when the editor closes.
 * An entry of such a document found in storage is removed with its code and files when this
 * module loads, before anything reads the list.
 *
 * The review test imports this file with the ?v= the editor's own
 * modules use and calls store.list(), store.create() and store.remove(), and the sync
 * test calls store.code() through window.typstEditor; these four names stay.
 */

import { assets } from './assets.js?v=7';

/** The localStorage key of the list; the dialog follows its changes from other tabs. */
export const LIST = 'typsteditor.files';
const FILE = 'typsteditor.file.';
const DEFAULT_NAME = 'Document';
const MAX_NAME_LENGTH = 80;
const ID_RADIX = 36;
const ID_RANDOM_START = 2;
const ID_RANDOM_END = 6;

/**
 * The entry of a document in the list.
 * @typedef {object} FileEntry
 * @property {string} id - the document's id.
 * @property {string} name - its name.
 * @property {number} created - when it was made (milliseconds since 1970).
 * @property {number} updated - when its code last changed.
 * @property {number} [size] - the size of its code in bytes (UTF-8).
 * @property {object} [hook] - its own webhook.
 * @property {string} [page] - the origin of the page (or server) it came from.
 * @property {boolean} [temp] - true for a document kept in memory only.
 */

/** Documents kept in memory only, by id: { meta: FileEntry, code: string }. */
const memoryDocuments = new Map();

removeStoredMemoryEntries();

/**
 * The documents of "My documents".
 */
export const store = {
    /**
     * Returns the entries stored in this browser.
     * @returns {FileEntry[]} the stored entries; empty when the storage is blocked or damaged.
     */
    getSavedEntries() {
        try {
            const entries = JSON.parse(localStorage.getItem(LIST) || '[]');
            return Array.isArray(entries) ? entries.filter(entry => entry && entry.id && !entry.temp) : [];
        } catch (e) { return []; }
    },

    /**
     * Returns every entry: the stored ones, then the ones in memory. The name is the one the
     * review test calls.
     * @returns {FileEntry[]} the entries.
     */
    list() {
        return [...this.getSavedEntries(), ...[...memoryDocuments.values()].map(memoryDocument => memoryDocument.meta)];
    },

    /**
     * Returns every entry, the most recently changed first.
     * @returns {FileEntry[]} the entries.
     */
    getSortedEntries() {
        return this.list().sort((a, b) => b.updated - a.updated);
    },

    /**
     * Returns the entry of a document.
     * @param {string} id - the document's id.
     * @returns {FileEntry|null} the entry, null when there is none.
     */
    getEntry(id) {
        return this.list().find(entry => entry.id === id) || null;
    },

    /**
     * Tells whether a document is kept in memory only.
     * @param {string} id - the document's id.
     * @returns {boolean} true for a document from a page around the editor.
     */
    isInMemory(id) {
        return memoryDocuments.has(id);
    },

    /**
     * Returns the code of a document. The name is the one the sync test calls.
     * @param {string} id - the document's id.
     * @returns {string|null} the code, null when it is not there or the storage is blocked.
     */
    code(id) {
        if (memoryDocuments.has(id)) return memoryDocuments.get(id).code;
        try { return localStorage.getItem(FILE + id); } catch (e) { return null; }
    },

    /**
     * Writes the code and/or the name of a document; adds the document to the list when it is
     * missing (deleted in another tab, for example).
     * @param {string} id - the document's id.
     * @param {object} fields - the new name and/or code.
     * @param {string} [fields.name] - the new name.
     * @param {string|null} [fields.code] - the new code.
     * @returns {void}
     * @throws {DOMException} when the browser storage is full.
     */
    save(id, { name, code }) {
        const inMemory = memoryDocuments.get(id);
        if (inMemory) {
            if (code != null) { inMemory.code = code; inMemory.meta.updated = Date.now(); inMemory.meta.size = new Blob([code]).size; }
            if (name) inMemory.meta.name = name;
            return;
        }
        const entries = this.getSavedEntries();
        let entry = entries.find(item => item.id === id);
        if (!entry) { entry = { id, name: name || DEFAULT_NAME, created: Date.now(), updated: Date.now() }; entries.push(entry); }
        if (code != null) { localStorage.setItem(FILE + id, code); entry.updated = Date.now(); entry.size = new Blob([code]).size; }
        if (name) entry.name = name;
        localStorage.setItem(LIST, JSON.stringify(entries));
    },

    /**
     * Sets other fields of a document's entry, for example its own webhook; null removes a field.
     * @param {string} id - the document's id.
     * @param {object} fields - the fields to set.
     * @returns {void}
     * @throws {DOMException} when the browser storage is full.
     */
    setEntryFields(id, fields) {
        const inMemory = memoryDocuments.get(id);
        const entries = inMemory ? null : this.getSavedEntries();
        const entry = inMemory ? inMemory.meta : entries.find(item => item.id === id);
        if (!entry) return;
        for (const [key, value] of Object.entries(fields)) { if (value == null) delete entry[key]; else entry[key] = value; }
        if (entries) localStorage.setItem(LIST, JSON.stringify(entries));
    },

    /**
     * Creates a document under a free name. A command that returns the new id, as the callers
     * need it; the name is the one the review test calls.
     * @param {string} name - the wanted name.
     * @param {string} code - the code.
     * @param {boolean} [inMemory] - keep it in memory only (a page's document), never stored.
     * @returns {string} the new document's id.
     * @throws {DOMException} when the browser storage is full.
     */
    create(name, code, inMemory = false) {
        const id = Date.now().toString(ID_RADIX) + Math.random().toString(ID_RADIX).slice(ID_RANDOM_START, ID_RANDOM_END);
        if (inMemory) {
            const now = Date.now();
            memoryDocuments.set(id, { meta: { id, name: this.getUniqueName(name), created: now, updated: now, size: new Blob([code || '']).size, temp: true }, code: code || '' });
        } else this.save(id, { name: this.getUniqueName(name), code });
        return id;
    },

    /**
     * Removes a document and its code (its files are removed by the caller, assets.js). The
     * name is the one the review test calls.
     * @param {string} id - the document's id.
     * @returns {void}
     */
    remove(id) {
        if (memoryDocuments.delete(id)) return;
        try {
            localStorage.removeItem(FILE + id);
            localStorage.setItem(LIST, JSON.stringify(this.getSavedEntries().filter(entry => entry.id !== id)));
        } catch (e) { /* storage blocked */ }
    },

    /**
     * Returns the document with a name, ignoring case and spaces around it.
     * @param {string} name - the name.
     * @returns {FileEntry|null} the entry, null when no document has the name.
     */
    findByName(name) {
        const wanted = String(name || '').trim().toLowerCase();
        return wanted ? this.list().find(entry => entry.name.trim().toLowerCase() === wanted) || null : null;
    },

    /**
     * Returns a name no other document has: "House", or "House 2", "House 3" … when it is taken.
     * @param {string} name - the wanted name.
     * @param {string} [except] - the id of a document whose name does not count.
     * @returns {string} the free name, at most 80 characters before the number.
     */
    getUniqueName(name, except) {
        const base = String(name || DEFAULT_NAME).trim().slice(0, MAX_NAME_LENGTH) || DEFAULT_NAME;
        const taken = new Set(this.list().filter(entry => entry.id !== except).map(entry => entry.name.trim().toLowerCase()));
        if (!taken.has(base.toLowerCase())) return base;
        const stem = base.replace(/\s+\d+$/, '');
        for (let n = 2; ; n++) if (!taken.has(`${stem} ${n}`.toLowerCase())) return `${stem} ${n}`;
    },
};

/**
 * Removes entries of in-memory documents (with their code and files) from the browser's
 * storage: such an entry never belongs there.
 * @returns {void}
 */
function removeStoredMemoryEntries() {
    try {
        const entries = JSON.parse(localStorage.getItem(LIST) || '[]');
        if (!Array.isArray(entries) || !entries.some(entry => entry && entry.temp)) return;
        for (const entry of entries) {
            if (entry && entry.temp && entry.id) {
                localStorage.removeItem(FILE + entry.id);
                assets.removeDocument(entry.id);
            }
        }
        localStorage.setItem(LIST, JSON.stringify(entries.filter(entry => entry && !entry.temp)));
    } catch (e) { /* storage blocked */ }
}
