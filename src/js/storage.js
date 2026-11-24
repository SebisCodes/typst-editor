/**
 * Storing the open document and the editor's settings in this browser.
 *
 * The settings (the open document, the split, the fit and zoom of the pages) go to
 * typsteditor.v1, the document itself to its entry in "My documents" (files.js), its pictures
 * and files to IndexedDB (assets.js). Two tabs may have the same document open:
 *   - a tab that stores its edits after the other tab changed the document keeps both
 *     versions: its own becomes a document of its own under a free name;
 *   - a hidden tab without edits of its own shows the version the other tab stored.
 */

import { store } from './files.js?v=11';
import { assets } from './assets.js?v=7';
import { state, areas, showToast } from './state.js?v=3';
import { setCode } from './history.js?v=7';
import { showFileName } from './documents.js?v=7';

const SETTINGS_KEY = 'typsteditor.v1';
/** How long after typing the document is stored, in milliseconds. */
const SAVE_DELAY = 400;
const STORAGE_FULL = 'The browser storage is full - download and delete documents under "My documents"';
let storageWarned = false;
let saveTimer = 0;

/**
 * The settings stored in typsteditor.v1.
 * @typedef {object} EditorSettings
 * @property {string} file - the id of the open document.
 * @property {number} split - the share of the width the code takes.
 * @property {string|null} fit - "width" or "page", null for a zoom of its own.
 * @property {number} zoom - the zoom of the pages.
 */

/**
 * Returns the stored settings.
 * @returns {EditorSettings|null} the settings, null when none are stored or the storage is blocked.
 */
export function getSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { return null; }
}

/**
 * Stores the settings and the open document's code, when it changed.
 * @returns {void}
 */
export function saveState() {
    saveSettings();
    saveOpenDocument();
}

/**
 * Stores the code a little after typing stops.
 * @returns {void}
 */
export function startSaveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, SAVE_DELAY);
}

/**
 * Stores the edits still waiting for the delayed store, before another document opens.
 * @returns {void}
 */
export function saveWaitingEdits() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveState();
}

/**
 * Stores the settings; with the storage blocked or full the editor works on without them.
 * @returns {void}
 */
function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ file: state.fileId, split: state.split, fit: state.fit, zoom: state.zoom }));
    } catch (e) { /* storage blocked or full: the editor keeps working without a saved draft */ }
}

/**
 * Stores the open document's code when it changed since this tab read or stored it; when
 * another tab changed it meanwhile, both versions are kept.
 * @returns {void}
 */
function saveOpenDocument() {
    if (!state.fileId || state.code === state.savedCode) return;
    try {
        const stored = store.code(state.fileId);
        if (stored != null && stored !== state.savedCode && stored !== state.code) { saveBothVersions(); return; }
        store.save(state.fileId, { code: state.code });
        state.savedCode = state.code;
    } catch (e) {
        if (!storageWarned) showToast(STORAGE_FULL);
        storageWarned = true;
    }
}

/**
 * Saves this tab's version of a document another tab changed as a document of its own (with
 * a free name); the other tab's version stays as it is.
 * @returns {void}
 */
function saveBothVersions() {
    const otherName = state.name, otherId = state.fileId;
    let id;
    try { id = store.create(otherName, state.code); } catch (e) { showToast(STORAGE_FULL); return; }
    state.fileId = id;
    state.name = store.getEntry(id)?.name || otherName;
    state.savedCode = state.code;
    assets.copy(otherId, id);
    showFileName();
    areas.files.render();
    areas.sync?.updateUi();
    saveState();
    showToast(`"${otherName}" was changed in another tab - your version here is kept as "${state.name}"`);
}

/**
 * Follows the documents other tabs store: a hidden tab without edits of its own shows the
 * version another tab stored for its document.
 * @returns {void}
 */
export function startStorageSync() {
    addEventListener('storage', showOtherTabVersion);
}

/**
 * Shows the version of the open document another tab stored, when this tab is not on screen
 * and has no edits of its own: what the user is looking at never changes by itself (a
 * storage event handler).
 * @param {StorageEvent} event - the change in the storage.
 * @returns {void}
 */
function showOtherTabVersion(event) {
    const id = state.fileId;
    if (!id || !event.key || !event.key.endsWith(id) || event.newValue == null || store.isInMemory(id)) return;
    const stored = store.code(id);
    if (stored == null || stored === state.code || state.code !== state.savedCode || document.visibilityState !== 'hidden') return;
    state.savedCode = stored;
    setCode(stored);
}
