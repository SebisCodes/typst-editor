/**
 * The layout of the work area: the splitter between code and pages (dragged or moved with the
 * arrow keys, stored), the views of narrow screens (one at a time), the side panel (a drawer on
 * the desktop, closed at the start) and its tabs, and the close buttons of the dialogs.
 */

import { openDialog } from './dialogs.js?v=5';
import { state, ui, getElement, getElements, getNumberInRange } from './state.js?v=3';
import { saveState } from './storage.js?v=5';
import { moveCodeLayers } from './code-view.js?v=5';
import { updateZoom } from './zoom.js?v=5';
import { renderFilesTab } from './files-tab.js?v=5';

/** The smallest and largest share of the width the code takes. */
const MIN_SPLIT = 0.15;
const MAX_SPLIT = 0.85;
/** How far an arrow key moves the splitter. */
const SPLIT_STEP = 0.03;
/** The digits of the shares written to the grid. */
const SPLIT_DIGITS = 4;

/**
 * Shows the split between code and pages.
 * @returns {void}
 */
export function showSplit() {
    ui.work.style.setProperty('--code-fr', state.split.toFixed(SPLIT_DIGITS) + 'fr');
    ui.work.style.setProperty('--view-fr', (1 - state.split).toFixed(SPLIT_DIGITS) + 'fr');
}

/**
 * Shows one view on a narrow screen and draws it for its size.
 * @param {string} pane - "code", "draw" (the pages) or another view of the tabs.
 * @returns {void}
 */
export function showPane(pane) {
    ui.work.dataset.show = pane;
    getElements('[data-pane]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.pane === pane)));
    requestAnimationFrame(() => { if (pane === 'draw') updateZoom(); if (pane === 'code') moveCodeLayers(); });
}

/**
 * Moves the splitter with the pointer until it is released, then stores the split (a
 * pointerdown handler).
 * @param {PointerEvent} event - the press on the splitter.
 * @returns {void}
 */
function moveSplitterOnDrag(event) {
    const splitter = event.currentTarget;
    splitter.setPointerCapture(event.pointerId);
    const box = ui.work.getBoundingClientRect();
    const available = box.width - splitter.offsetWidth;
    /**
     * Sets the split at the pointer.
     * @param {PointerEvent} moveEvent - the move.
     * @returns {void}
     */
    const moveSplit = moveEvent => { state.split = getNumberInRange((moveEvent.clientX - box.left) / available, MIN_SPLIT, MAX_SPLIT); showSplit(); };
    /**
     * Ends the drag and stores the split.
     * @returns {void}
     */
    const stopDrag = () => { splitter.removeEventListener('pointermove', moveSplit); splitter.removeEventListener('pointerup', stopDrag); saveState(); };
    splitter.addEventListener('pointermove', moveSplit);
    splitter.addEventListener('pointerup', stopDrag);
}

/**
 * Moves the splitter with the arrow keys and stores the split (a keydown handler).
 * @param {KeyboardEvent} event - the key.
 * @returns {void}
 */
function moveSplitterOnKey(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    state.split = getNumberInRange(state.split + (event.key === 'ArrowLeft' ? -SPLIT_STEP : SPLIT_STEP), MIN_SPLIT, MAX_SPLIT);
    showSplit();
    saveState();
}

/**
 * Shows a tab of the side panel: Document, Insert, Pictures or Outline.
 * @param {HTMLElement} tab - the tab's button.
 * @returns {void}
 */
function showPanelTab(tab) {
    getElements('[data-itab]').forEach(other => other.setAttribute('aria-selected', String(other === tab)));
    ui.inspector.hidden = tab.dataset.itab !== 'properties';
    ui.insert.hidden = tab.dataset.itab !== 'insert';
    ui.pictures.hidden = tab.dataset.itab !== 'pictures';
    if (!ui.pictures.hidden) renderFilesTab();
    getElement('#tree-wrap').hidden = tab.dataset.itab !== 'structure';
}

/**
 * Opens or closes the side panel's drawer.
 * @param {boolean} isOpen - true to open it.
 * @returns {void}
 */
export function showSidePanel(isOpen) {
    ui.work.dataset.panel = isOpen ? 'open' : 'closed';
    getElement('#btn-panel').setAttribute('aria-expanded', String(isOpen));
    if (isOpen && !ui.pictures.hidden) renderFilesTab();
}

/**
 * Closes the side panel's drawer with Escape inside it and puts the focus on its button.
 * @param {KeyboardEvent} event - the key in the side panel.
 * @returns {void}
 */
function closeSidePanelOnEscape(event) {
    if (event.key !== 'Escape' || ui.work.dataset.panel !== 'open' || event.target.closest('dialog')) return;
    showSidePanel(false);
    getElement('#btn-panel').focus();
}

/**
 * Connects the splitter, the view tabs of narrow screens, the side panel's button and the tabs
 * of the side panel.
 * @returns {void}
 */
export function startLayout() {
    const splitter = getElement('#splitter');
    splitter.addEventListener('pointerdown', moveSplitterOnDrag);
    splitter.addEventListener('keydown', moveSplitterOnKey);
    getElements('[data-pane]').forEach(tab => tab.addEventListener('click', () => showPane(tab.dataset.pane)));
    getElements('[data-itab]').forEach(tab => tab.addEventListener('click', () => showPanelTab(tab)));
    showSidePanel(false);
    getElement('#btn-panel').addEventListener('click', () => showSidePanel(ui.work.dataset.panel !== 'open'));
    getElement('#side-panel').addEventListener('keydown', closeSidePanelOnEscape);
    watchPreviewBarHeight();
}

/**
 * Keeps the height of the preview's bar as --preview-bar on the work area: the side panel's
 * drawer starts below the bar, so the bar's controls stay in view and usable while it is open.
 * The bar is taller when its controls wrap (narrow work area, long labels of a language).
 * @returns {void}
 */
function watchPreviewBarHeight() {
    const bar = getElement('.draw-pane > .pane-header');
    const observer = new ResizeObserver(() => ui.work.style.setProperty('--preview-bar', bar.offsetHeight + 'px'));
    observer.observe(bar);
}

/**
 * Connects the close buttons of the dialogs, closing a dialog with a click beside it, and the
 * help button.
 * @returns {void}
 */
export function startDialogs() {
    getElements('dialog [data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    getElements('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
    getElement('#btn-help').addEventListener('click', () => openDialog(getElement('#help')));
}
