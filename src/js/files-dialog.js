/**
 * The "My documents" dialog: a card per document with its title and first words as a little
 * page, and buttons to open, rename, duplicate, download (.typ, or a ZIP with its pictures and
 * files) and delete it; a search field, "New", "Open a file" and a ZIP of all documents.
 *
 * createFilesDialog() connects the dialog once and returns { open, render }.
 */

import { openDialog, openConfirmation } from './dialogs.js?v=5';
import { createZip } from './zip.js?v=4';
import { saveFile, getSafeName } from './util.js?v=3';
import { store, LIST } from './files.js?v=11';
import { assets, getDataUrlBytes } from './assets.js?v=7';
import { createCard, formatSize } from './files-card.js?v=2';

const STORAGE_FULL = 'The browser storage is full - delete or download some documents first';

/**
 * The open document as the dialog sees it.
 * @typedef {object} OpenDocument
 * @property {string} id - its id.
 * @property {string} name - its name.
 * @property {string} code - its code, with the edits not yet stored.
 */

/**
 * What the editor hands to createFilesDialog().
 * @typedef {object} FilesDialogEditor
 * @property {function(): OpenDocument} getCurrent - the open document.
 * @property {function(string): void} openDocument - opens a stored document by id.
 * @property {function(string): void} openNew - makes a new document of a kind of the "New" menu.
 * @property {function(string, string): void} renameDocument - gives a document a new name.
 * @property {function(string): void} onRemoved - a document was deleted.
 * @property {function(): void} showFilePicker - asks for a file to open.
 * @property {function(string): void} showToast - shows a short message.
 */

/**
 * What createFilesDialog() returns.
 * @typedef {object} FilesDialog
 * @property {function(): void} open - opens the dialog with the open document focused.
 * @property {function(): void} render - draws the list again while the dialog is open.
 */

/**
 * Connects the "My documents" dialog (an initializeX: it returns the dialog's API).
 * @param {FilesDialogEditor} editor - what the dialog needs of the editor.
 * @returns {FilesDialog} open and render.
 */
export function createFilesDialog(editor) {
    const dialog = document.getElementById('files');
    const list = document.getElementById('files-grid');
    const search = document.getElementById('files-search');
    const info = document.getElementById('files-info');

    list.addEventListener('click', handleCardClick);
    search.addEventListener('input', renderFiles);
    document.getElementById('files-new').addEventListener('click', () => { dialog.close(); editor.openNew('blank'); });
    document.getElementById('files-import').addEventListener('click', () => { dialog.close(); editor.showFilePicker(); });
    document.getElementById('files-zip').addEventListener('click', exportAllAsZip);
    // Another editor tab changed the list.
    addEventListener('storage', event => { if (event.key === LIST && dialog.open) renderFiles(); });

    return {
        open: openFilesDialog,
        render: () => { if (dialog.open) renderFiles(); },
    };

    /**
     * Opens the dialog with an empty search and the open document focused.
     * @returns {void}
     */
    function openFilesDialog() {
        search.value = '';
        renderFiles();
        openDialog(dialog);
        list.querySelector('.current .file-open')?.focus();
    }

    /**
     * Returns the code of a document: the open one with its edits, the others as stored.
     * @param {string} id - the document's id.
     * @returns {string} the code, empty when there is none.
     */
    function getDocumentCode(id) {
        const current = editor.getCurrent();
        return id === current.id ? current.code : store.code(id) || '';
    }

    /**
     * Draws the cards of the documents that match the search, and the total size.
     * @returns {void}
     */
    function renderFiles() {
        const current = editor.getCurrent();
        const all = store.getSortedEntries();
        const query = search.value.trim().toLowerCase();
        const shown = query ? all.filter(entry => entry.name.toLowerCase().includes(query)) : all;
        list.replaceChildren(...shown.map(entry => createCard(entry, entry.id === current.id ? current.code : store.code(entry.id) || '', entry.id === current.id)));
        if (!shown.length) {
            const empty = document.createElement('p');
            empty.className = 'muted file-empty';
            empty.textContent = query ? `No document named "${search.value.trim()}".` : 'No documents yet.';
            list.append(empty);
        }
        const total = all.reduce((sum, entry) => sum + (entry.size || 0), 0);
        info.textContent = `${all.length} ${all.length === 1 ? 'document' : 'documents'} · ${formatSize(total)} in this browser`;
    }

    /**
     * Puts a field in place of a card's name to rename the document: Enter or leaving the field
     * keeps the name, Escape keeps the old one.
     * @param {HTMLLIElement} card - the document's card.
     * @returns {void}
     */
    function startRename(card) {
        const id = card.dataset.id;
        const nameElement = card.querySelector('.file-name');
        const input = document.createElement('input');
        input.className = 'file-rename';
        input.value = store.getEntry(id)?.name || '';
        input.setAttribute('aria-label', 'New name');
        nameElement.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        /**
         * Ends the rename once and focuses the card again.
         * @param {boolean} keep - true to keep the typed name.
         * @returns {void}
         */
        const stopRename = keep => {
            if (done) return;
            done = true;
            const name = input.value.trim();
            if (keep && name) editor.renameDocument(id, store.getUniqueName(name, id));
            renderFiles();
            list.querySelector(`[data-id="${id}"] .file-open`)?.focus();
        };
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); stopRename(true); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); stopRename(false); }
        });
        input.addEventListener('blur', () => stopRename(true));
    }

    /**
     * Runs a click on a card: opens the document, or runs the card's button (a click handler).
     * @param {MouseEvent} event - the click.
     * @returns {Promise<void>} settles when the action is done.
     */
    async function handleCardClick(event) {
        const card = event.target.closest('.file-card');
        if (!card) return;
        const id = card.dataset.id;
        const entry = store.getEntry(id);
        if (!entry) { renderFiles(); return; }
        const action = event.target.closest('[data-act]')?.dataset.act;
        if (!action && !event.target.closest('input')) {
            dialog.close();
            if (id !== editor.getCurrent().id) editor.openDocument(id);
        } else if (action === 'rename') startRename(card);
        else if (action === 'copy') await copyDocument(entry);
        else if (action === 'download') await exportDocument(entry);
        else if (action === 'delete') await deleteDocumentOnConfirm(entry);
    }

    /**
     * Makes a copy of a document with its files, under a free name.
     * @param {import('./files.js').FileEntry} entry - the document's entry.
     * @returns {Promise<void>} settles when the copy is stored.
     */
    async function copyDocument(entry) {
        try {
            const copyId = store.create(store.getUniqueName(entry.name + ' copy'), getDocumentCode(entry.id));
            await assets.copy(entry.id, copyId);
            editor.showToast(`"${entry.name}" duplicated`);
        } catch (e) { editor.showToast(STORAGE_FULL); }
        renderFiles();
    }

    /**
     * Downloads a document: the .typ, or a ZIP with its pictures and files when it has any.
     * @param {import('./files.js').FileEntry} entry - the document's entry.
     * @returns {Promise<void>} settles when the download starts.
     */
    async function exportDocument(entry) {
        const files = await assets.get(entry.id);
        const name = getSafeName(entry.name);
        if (!Object.keys(files).length) { saveFile(getDocumentCode(entry.id), `${name}.typ`, 'text/plain'); return; }
        const zipFiles = [{ name: `${name}.typ`, data: getDocumentCode(entry.id) }, ...Object.entries(files).map(([fileName, dataUrl]) => ({ name: fileName, data: getDataUrlBytes(dataUrl) }))];
        saveFile(await createZip(zipFiles), `${name}.zip`);
    }

    /**
     * Deletes a document and its files after asking; the dialog opens again after the question.
     * @param {import('./files.js').FileEntry} entry - the document's entry.
     * @returns {Promise<void>} settles when it is deleted or kept.
     */
    async function deleteDocumentOnConfirm(entry) {
        const confirmed = await openConfirmation({
            title: `Delete "${entry.name}"?`,
            text: 'The document and its pictures are removed from this browser for good. Download it first if you want to keep a copy.',
            ok: 'Delete',
        });
        openDialog(dialog);
        if (!confirmed) return;
        store.remove(entry.id);
        assets.removeDocument(entry.id);
        editor.onRemoved(entry.id);
        editor.showToast(`"${entry.name}" deleted`);
        renderFiles();
    }

    /**
     * Downloads all documents as one ZIP: a document with files as a folder with its .typ
     * and files, one without as a .typ file; names made unique.
     * @returns {Promise<void>} settles when the download starts.
     */
    async function exportAllAsZip() {
        const current = editor.getCurrent();
        const used = new Set();
        const zipFiles = [];
        const entries = store.getSortedEntries();
        for (const entry of entries) {
            let name = getSafeName(entry.name);
            for (let k = 2; used.has(name.toLowerCase()); k++) name = `${getSafeName(entry.name)}-${k}`;
            used.add(name.toLowerCase());
            const files = await assets.get(entry.id);
            const hasFiles = Object.keys(files).length;
            zipFiles.push({ name: hasFiles ? `${name}/${name}.typ` : `${name}.typ`, data: entry.id === current.id ? current.code : store.code(entry.id) || '' });
            for (const [fileName, dataUrl] of Object.entries(files)) zipFiles.push({ name: `${name}/${fileName}`, data: getDataUrlBytes(dataUrl) });
        }
        saveFile(await createZip(zipFiles), 'typst-documents.zip');
        editor.showToast(`ZIP with ${entries.length} ${entries.length === 1 ? 'document' : 'documents'} downloaded`);
    }
}
