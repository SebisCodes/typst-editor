/**
 * Pictures and files of a document (image("name"), csv("data.csv") …), kept in the browser's
 * IndexedDB: they are too large for localStorage. One record per document: { name: data URI }.
 * Without IndexedDB the pictures live only until the page is closed; the files of documents
 * kept in memory (from a page) never go into IndexedDB.
 *
 * The review test imports this file with the ?v= the editor's own
 * modules use, slows assets.set() down and reads assets.get(): every write goes through
 * assets.set, and these names stay.
 */

const DATABASE = 'typsteditor';
const STORE = 'assets';
const DATABASE_VERSION = 1;
/** The name of a file that comes without one. */
const DEFAULT_FILE_NAME = 'picture.png';
/** The extension a name without one gets. */
const DEFAULT_EXTENSION = '.png';

/** The files of each document read or written in this page, by document id. */
const memory = new Map();
let databasePromise = null;
/**
 * Tells whether a document keeps its files in memory only; set by setMemoryOnlyRule().
 * @param {string} id - the document's id.
 * @returns {boolean} true for a document kept in memory only.
 */
let isMemoryOnly = () => false;
/**
 * Runs when a write did not reach IndexedDB; set by setNotStoredHandler().
 * @param {string} id - the document's id.
 * @returns {void}
 */
let handleNotStored = () => {};

/**
 * Returns the database, opened once.
 * @returns {Promise<IDBDatabase|null>} the database, null without IndexedDB.
 */
function getDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise(resolve => {
        try {
            const request = indexedDB.open(DATABASE, DATABASE_VERSION);
            request.addEventListener('upgradeneeded', () => request.result.createObjectStore(STORE));
            request.addEventListener('success', () => resolve(request.result));
            request.addEventListener('error', () => resolve(null));
            request.addEventListener('blocked', () => resolve(null));
        } catch (e) { resolve(null); }
    });
    return databasePromise;
}

/**
 * Runs a request in a transaction of the store.
 * @param {string} mode - "readonly" or "readwrite".
 * @param {function(IDBObjectStore): (IDBRequest|undefined)} run - makes the request.
 * @returns {Promise<*>} the request's result (true without a request), null when it failed or there is no database.
 */
async function runTransaction(mode, run) {
    const database = await getDatabase();
    if (!database) return null;
    return new Promise(resolve => {
        try {
            const transaction = database.transaction(STORE, mode);
            const request = run(transaction.objectStore(STORE));
            transaction.addEventListener('complete', () => resolve(request ? request.result : true));
            transaction.addEventListener('error', () => resolve(null));
            transaction.addEventListener('abort', () => resolve(null));
        } catch (e) { resolve(null); }
    });
}

/**
 * The pictures and files of the documents.
 */
export const assets = {
    /**
     * Returns all pictures and files of a document. The name is the one the review
     * test calls. A query that fills a cache.
     * @param {string} id - the document's id.
     * @returns {Promise<Object<string, string>>} name -> data URI, empty when it has none.
     */
    async get(id) {
        if (memory.has(id) || isMemoryOnly(id)) return memory.get(id) || {};
        const files = (await runTransaction('readonly', objectStore => objectStore.get(id))) || {};
        if (!memory.has(id)) memory.set(id, files);             // a write while reading holds the newer set
        return memory.get(id);
    },

    /**
     * Returns the files of a document as far as this page has read them.
     * @param {string} id - the document's id.
     * @returns {Object<string, string>} name -> data URI.
     */
    getCached(id) {
        return memory.get(id) || {};
    },

    /**
     * Sets which documents keep their files in memory only.
     * @param {function(string): boolean} test - true for a document kept in memory only (store.isInMemory).
     * @returns {void}
     */
    setMemoryOnlyRule(test) {
        isMemoryOnly = test;
    },

    /**
     * Sets what happens when a write does not reach IndexedDB (storage full or blocked): the
     * files are then in memory only.
     * @param {function(string): void} handler - gets the document's id.
     * @returns {void}
     */
    setNotStoredHandler(handler) {
        handleNotStored = handler;
    },

    /**
     * Sets all files of a document. The name is the one the review test replaces to
     * slow writing down, so every write goes through it.
     * @param {string} id - the document's id.
     * @param {Object<string, string>} files - name -> data URI.
     * @returns {Promise<void>} settles when the files are stored (or kept in memory).
     */
    async set(id, files) {
        memory.set(id, files);
        if (!isMemoryOnly(id) && (await runTransaction('readwrite', objectStore => objectStore.put(files, id))) === null) handleNotStored(id);
    },

    /**
     * Adds or replaces one file of a document. A command that returns the new set, as the
     * caller shows it.
     * @param {string} id - the document's id.
     * @param {string} name - the file's name.
     * @param {string} dataUrl - its content.
     * @returns {Promise<Object<string, string>>} all files of the document.
     */
    async add(id, name, dataUrl) {
        return this.merge(id, { [name]: dataUrl });
    },

    /**
     * Adds or replaces several files of a document in one write. The set written is the one this
     * page holds at the moment of writing, so writes that overlap keep each other's files. A
     * command that returns the set as it is once the write is done, as the caller shows it.
     * @param {string} id - the document's id.
     * @param {Object<string, string>} added - name -> data URI.
     * @returns {Promise<Object<string, string>>} all files of the document.
     */
    async merge(id, added) {
        await this.get(id);
        await this.set(id, { ...this.getCached(id), ...added });
        return this.getCached(id);
    },

    /**
     * Removes one file of a document. A command that returns the new set, as the caller
     * shows it.
     * @param {string} id - the document's id.
     * @param {string} name - the file's name.
     * @returns {Promise<Object<string, string>>} the files left.
     */
    async remove(id, name) {
        await this.get(id);
        const files = { ...this.getCached(id) };
        delete files[name];
        await this.set(id, files);
        return this.getCached(id);
    },

    /**
     * Removes all files of a document.
     * @param {string} id - the document's id.
     * @returns {Promise<void>} settles when they are removed.
     */
    async removeDocument(id) {
        memory.delete(id);
        if (!isMemoryOnly(id)) await runTransaction('readwrite', objectStore => objectStore.delete(id));
    },

    /**
     * Copies all files of one document to another.
     * @param {string} from - the id of the document copied from.
     * @param {string} to - the id of the document copied to.
     * @returns {Promise<void>} settles when the copy is stored.
     */
    async copy(from, to) {
        await this.set(to, { ...(await this.get(from)) });
    },
};

/**
 * Returns a file name that is not taken yet: "logo.png", "logo-2.png" …
 * @param {Object<string, *>} files - the files by name.
 * @param {string} name - the wanted name; characters other than letters, digits, ".", "-" and
 *   "_" become "-", and a name without an extension gets ".png".
 * @returns {string} the free name.
 */
export function getFreeName(files, name) {
    let clean = String(name || DEFAULT_FILE_NAME).replace(/[^\w.\-]+/g, '-').replace(/^-+/, '') || DEFAULT_FILE_NAME;
    if (!/\.[a-z0-9]+$/i.test(clean)) clean += DEFAULT_EXTENSION;
    if (!files[clean]) return clean;
    const stem = clean.replace(/(\.[a-z0-9]+)$/i, ''), extension = /(\.[a-z0-9]+)$/i.exec(clean)[1];
    for (let k = 2; ; k++) if (!files[`${stem}-${k}${extension}`]) return `${stem}-${k}${extension}`;
}

/**
 * Reads a file as a data URI.
 * @param {Blob} file - the file.
 * @returns {Promise<string>} the data URI.
 * @throws {Error} when the file cannot be read (the Promise rejects).
 */
export function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result));
        reader.addEventListener('error', () => reject(new Error('The picture could not be read')));
        reader.readAsDataURL(file);
    });
}

/**
 * Returns the bytes of a data URI.
 * @param {string} dataUrl - the data URI, base64 or URL-encoded.
 * @returns {Uint8Array} its bytes.
 */
export function getDataUrlBytes(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const isBase64 = /;base64/.test(dataUrl.slice(0, comma));
    const data = dataUrl.slice(comma + 1);
    if (!isBase64) return new TextEncoder().encode(decodeURIComponent(data));
    const binary = atob(data);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}
