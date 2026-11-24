/**
 * The shortcuts of the page: Ctrl+S save, Ctrl+E export, Ctrl+O My documents, Ctrl+P print,
 * Ctrl + / - zoom (outside the code), Escape closes the "New" menu. While a field or a dialog has
 * the focus the others wait: Undo and Redo, PageUp / PageDown for the pages and ? for the help.
 */

import { openDialog } from './dialogs.js?v=5';
import { state, ui, areas, TYPING_FIELDS, getElement } from './state.js?v=3';
import { undo, redo } from './history.js?v=7';
import { setZoom, getCurrentPage, showPage, ZOOM_STEP } from './zoom.js?v=7';
import { applyNewMenuSwitch, isNewMenuOpen } from './documents.js?v=7';
import { showPrintDialog } from './export.js?v=7';
import { openExportDialog, saveOnShortcut } from './export-dialog.js?v=7';

/** The keys of the shortcuts with Ctrl or Cmd, as KeyboardEvent.key gives them. */
const SAVE_KEY = 's', EXPORT_KEY = 'e', OPEN_KEY = 'o', PRINT_KEY = 'p', REDO_KEY = 'y', ZOOM_OUT_KEY = '-';
/** Keys that do the same: both cases of undo (Shift turns it into redo), "+" with or without Shift. */
const UNDO_KEYS = ['z', 'Z'], ZOOM_IN_KEYS = ['+', '='];
/** The key that opens the help. */
const HELP_KEY = '?';

/**
 * Runs the page's shortcut of a key (a keydown handler).
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function handlePageKey(event) {
    if (runCommandKey(event)) return;
    const active = document.activeElement;
    if ((active && active.matches(TYPING_FIELDS)) || getElement('dialog[open]')) return;
    const withModifier = event.ctrlKey || event.metaKey;
    if (withModifier && UNDO_KEYS.includes(event.key)) { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (withModifier && event.key === REDO_KEY) { event.preventDefault(); redo(); return; }
    if (withModifier) return;
    if (event.key === 'PageDown') { event.preventDefault(); showPage(getCurrentPage() + 1); return; }
    if (event.key === 'PageUp') { event.preventDefault(); showPage(getCurrentPage() - 1); return; }
    if (event.key === HELP_KEY) openDialog(getElement('#help'));
}

/**
 * Runs the shortcuts that work everywhere: save, export, My documents, print, zoom outside the
 * code, and Escape for the "New" menu. Returns whether the key was one of them.
 * @param {KeyboardEvent} event - the key.
 * @returns {boolean} true when the key was taken.
 */
function runCommandKey(event) {
    const inCode = document.activeElement === ui.ta;
    const withModifier = event.ctrlKey || event.metaKey;
    if (withModifier && event.key === SAVE_KEY) { event.preventDefault(); saveOnShortcut(); return true; }
    if (withModifier && event.key === EXPORT_KEY) { event.preventDefault(); openExportDialog(); return true; }
    if (withModifier && event.key === OPEN_KEY) { event.preventDefault(); areas.files.open(); return true; }
    if (withModifier && event.key === PRINT_KEY) { event.preventDefault(); showPrintDialog(); return true; }
    if (withModifier && ZOOM_IN_KEYS.includes(event.key) && !inCode) { event.preventDefault(); setZoom(state.zoom * ZOOM_STEP); return true; }
    if (withModifier && event.key === ZOOM_OUT_KEY && !inCode) { event.preventDefault(); setZoom(state.zoom / ZOOM_STEP); return true; }
    if (event.key === 'Escape' && isNewMenuOpen()) { applyNewMenuSwitch(false); return true; }
    return false;
}

/**
 * Connects the shortcuts of the page.
 * @returns {void}
 */
export function startKeyboard() {
    window.addEventListener('keydown', handlePageKey);
}
