/**
 * AI Assistant without any server: any AI sends a document as a link (ai-links.js).
 *
 * "Copy prompt" puts the instructions and the open document on the clipboard (ai-prompt.js).
 * A tab opened with an AI link hands the document to the editor tab that is already open
 * (BroadcastChannel) and shows that it was taken over (the document can be opened there
 * too); without an open editor it loads the document itself. The AI's whole answer can also
 * be pasted into the editor (Ctrl+V anywhere, or the field in the dialog).
 *
 * createAi() runs these steps:
 *   1. answer other editor tabs on the channel and take documents meant for this tab (ai-tabs.js);
 *   2. connect the AI button, the copy button and the paste field;
 *   3. open the document of a link in the address, at start and whenever the address changes;
 *   4. return { updateRemote } to show the page's AI settings in the dialog.
 */

import { openDialog } from './dialogs.js?v=5';
import { readHash, findLinks, readLink } from './ai-links.js?v=2';
import { createTabChannel, createRequestId, findEditorTab, sendToTab } from './ai-tabs.js?v=3';
import { getPrompt } from './ai-prompt.js?v=2';

const BROKEN = 'The document in this link is incomplete or damaged. If the AI\'s link was split over several lines (as in a terminal), copy the whole answer and paste it into the editor with Ctrl+V - the editor joins the lines.';
const FRAMED_STEP = 'The AI answers with a link: <b>paste its whole answer below</b> (a clicked link opens a separate editor). <b>Undo</b> takes it back.';

/**
 * What the editor hands to createAi().
 * @typedef {object} AiEditor
 * @property {function(): object} getState - the document for the prompt (PromptState without framed and remote).
 * @property {function(string, string, object): Promise<string>} receiveDocument - takes a Typst document with its mode and target; resolves with the id of the document it is in.
 * @property {function(string): void} showToast - shows a short message.
 * @property {function(): (object|null)} [getRemote] - the page's AI settings, or null.
 * @property {function(): Promise<*>} [fetchKey] - asks the page for the session's key while there is none.
 * @property {function(): boolean} [hasValidKey] - true when the session has its key.
 * @property {function(string): boolean} [tryOpenDocument] - opens a stored document by id; false when there is none.
 */

/**
 * Connects the AI Assistant (an initializeX: it returns the dialog's API).
 * @param {AiEditor} editor - what the assistant needs of the editor.
 * @returns {{updateRemote: function(): void}} shows the page's AI settings in the dialog again.
 */
export function createAi({ getState, receiveDocument, showToast, getRemote = () => null, fetchKey = () => Promise.resolve(null), hasValidKey = () => false, tryOpenDocument = () => false }) {
    const button = document.getElementById('btn-ai');
    const dialog = document.getElementById('ai');
    const notice = document.getElementById('ai-receive');
    const handCopy = document.getElementById('ai-prompt-text');
    const remoteBox = document.getElementById('ai-remote');
    const stepLink = document.getElementById('ai-step-link');
    const privacy = document.getElementById('ai-privacy'), privacyText = privacy.textContent;
    const keyExplanation = document.getElementById('ai-key-exp');
    const pasteField = document.getElementById('ai-paste');
    const channel = createTabChannel(receiveDocument);
    const framed = window.parent !== window;
    /** Links being taken: one paste can fire several input events, each with the whole answer. */
    const inFlight = new Set();

    button.addEventListener('click', () => {
        document.getElementById('ai-cur').textContent = getState().name;
        showRemote();
        openDialog(dialog);
    });
    // Inside another website the editor may not use the clipboard API (the page has to allow it
    // with allow="clipboard-write"): then the copy command, and if that fails too, the prompt to copy by hand.
    if (framed) stepLink.innerHTML = FRAMED_STEP;
    const stepHtml = stepLink.innerHTML;
    document.getElementById('ai-copy').addEventListener('click', copyPrompt);
    addEventListener('paste', importPastedAnswer);
    pasteField.addEventListener('input', () => { if (findLinks(pasteField.value).length) importLinksInText(pasteField.value).then(() => { pasteField.value = ''; }); });
    addEventListener('hashchange', openAddressLink);
    openAddressLink();
    return { updateRemote: showRemote };

    /**
     * Shows the notice over the editor of a tab opened by a link.
     * @param {string} title - the heading.
     * @param {string} text - the text.
     * @param {(function(): void)|null} [openHere] - what "Open it here" does; null hides the button.
     * @param {boolean} [loading] - true to show the notice as the loading screen (no buttons).
     * @returns {void}
     */
    function showNotice(title, text, openHere = null, loading = false) {
        notice.classList.toggle('loading', loading);
        notice.querySelector('h2').textContent = title;
        notice.querySelector('p').textContent = text;
        const hereButton = notice.querySelector('[data-here]');
        hereButton.hidden = !openHere;
        /**
         * Hides the notice and opens the document here ("Open it here").
         * @returns {void}
         */
        const openHereOnClick = () => { notice.hidden = true; openHere(); };
        hereButton.onclick = openHereOnClick;
        notice.hidden = false;
    }

    /**
     * Opens the document of a link in the address: hands it to an open editor tab, or loads it here.
     * @returns {Promise<void>} settles when the document is taken.
     */
    async function openAddressLink() {
        if (!readHash(location.hash)) return;
        const hash = location.hash;
        history.replaceState(null, '', location.pathname + location.search);
        showNotice('Loading…', '', null, true);
        const result = await readLink(hash);
        if (result.missing) {
            showNotice(`Part ${result.part} of ${result.of} received`, `Open the other ${result.missing.length === 1 ? 'link' : 'links'} from the AI too (still missing: part ${result.missing.join(', ')}).`);
            return;
        }
        if (result.error) { showNotice('The link could not be read', BROKEN); return; }
        const { doc, mode, target } = result;
        const requestId = createRequestId();
        const tab = await findEditorTab(channel, requestId);
        const sent = tab && await sendToTab(channel, tab, doc, mode, target, requestId);
        if (sent) {
            // "Open it here" opens the document the other tab saved; one that is not stored there (kept in memory) comes from the link again.
            showNotice('Taken over by your editor', 'The document is now in the Typst Editor tab you already had open. Switch to that tab, or open it here.', () => { if (!sent.id || !tryOpenDocument(sent.id)) receiveDocument(doc, mode, target); });
            return;
        }
        notice.hidden = true;
        receiveDocument(doc, mode, target);
    }

    /**
     * Copies text with the browser's copy command, from a hidden field inside the open dialog
     * (the only place that can take focus). Returns whether the copy took place.
     * @param {string} text - the text.
     * @returns {boolean} true when the text was copied.
     */
    function copyWithCommand(text) {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        dialog.append(field);
        field.select();
        let copied = false;
        try { copied = document.execCommand('copy'); } catch (e) { /* not allowed */ }
        field.remove();
        return copied;
    }

    /**
     * Copies text: the clipboard, else the copy command, else the text selected to copy by hand.
     * @param {string} text - the text.
     * @param {function(): void} onCopied - runs when the text is on the clipboard.
     * @returns {Promise<void>} settles when the text is copied or shown.
     */
    async function copyText(text, onCopied) {
        /**
         * Hides the field for copying by hand and reports the copy.
         * @returns {void}
         */
        const showCopyDone = () => { handCopy.hidden = true; onCopied(); };
        try { await navigator.clipboard.writeText(text); showCopyDone(); return; } catch (e) { /* not allowed here */ }
        if (copyWithCommand(text)) { showCopyDone(); return; }
        handCopy.value = text;
        handCopy.hidden = false;
        handCopy.focus();
        handCopy.select();
        showToast('Copying is not allowed here - it is selected below: press Ctrl+C (⌘C)');
    }

    /**
     * Shows the page's AI settings in the dialog (AI through the page's server, see sync.js).
     * @returns {void}
     */
    function showRemote() {
        const remote = getRemote();
        remoteBox.hidden = !remote;
        privacy.textContent = remote ? `The AI sends the document to ${remote.label} with a key that only works for this session. What you paste into your AI is handled by its provider.` : privacyText;
        if (!remote) { stepLink.innerHTML = stepHtml; return; }
        document.getElementById('ai-remote-host').textContent = remote.site && remote.site !== remote.label ? `${remote.label} (${remote.site})` : remote.label;
        const details = document.getElementById('ai-remote-details');
        details.hidden = !remote.prompt;
        details.querySelector('span').textContent = remote.site || remote.label;
        document.getElementById('ai-remote-prompt').textContent = remote.prompt || '';
        stepLink.textContent = `The AI sends its result to ${remote.label} by itself, and it opens here. If it answers with a link, paste its answer below.`;
        keyExplanation.textContent = !remote.endpoint ? '' : !remote.key ? '(no key yet)' : '(key valid while the editor is open)';
    }

    /**
     * Copies the prompt; with a page's endpoint, asks for the session's key first.
     * @returns {Promise<void>} settles when the prompt is copied or shown.
     */
    async function copyPrompt() {
        let remote = getRemote();
        if (remote && remote.endpoint && !hasValidKey()) {
            await fetchKey();
            remote = getRemote();
            showRemote();
            if (remote && !hasValidKey()) showToast(`No key from ${remote.label} - the prompt asks the AI for a link instead`);
        }
        const makeNew = dialog.querySelector('[name=ai-target]:checked').value === 'new';
        const text = getPrompt({ ...getState(), framed, remote: remote && remote.endpoint && !hasValidKey() ? { ...remote, key: '' } : remote }, makeNew);
        copyText(text, () => { showToast(remote && hasValidKey() ? `Prompt copied - the AI sends its result to ${remote.label}` : 'Prompt copied - paste it into your AI and say what it should write'); dialog.close(); });
    }

    /**
     * Takes an AI's answer pasted anywhere outside a field (a paste handler).
     * @param {ClipboardEvent} event - the paste.
     * @returns {void}
     */
    function importPastedAnswer(event) {
        const active = document.activeElement;
        if (active && active !== pasteField && active.matches('textarea, input, select, [contenteditable]')) return;
        const text = event.clipboardData.getData('text');
        if (!findLinks(text).length) return;
        event.preventDefault();
        pasteField.value = '';
        importLinksInText(text);
    }

    /**
     * Takes every complete document in a pasted answer, in order (the same link twice counts
     * once), and reports missing parts or a damaged link.
     * @param {string} text - the pasted answer.
     * @returns {Promise<void>} settles when the documents are taken.
     */
    async function importLinksInText(text) {
        const links = findLinks(text);
        if (!links.length) return;
        let last = null;
        const done = [], mine = [];
        try {
            for (const link of new Set(links)) {
                if (inFlight.has(link)) { last = last || { busy: true }; continue; }
                inFlight.add(link);
                mine.push(link);
                const result = await readLink('#' + link);
                if (!result) continue;
                last = result;
                if (!result.missing && !result.error) done.push(result);
            }
            if (!last) return;
            if (done.length) {
                for (const result of done) await receiveDocument(result.doc, result.mode, result.target);
                dialog.close();
                return;
            }
            if (last.busy) return;
            if (last.missing) showToast(`Part ${last.part} of ${last.of} received - paste the other ${last.missing.length === 1 ? 'link' : 'links'} too (missing: ${last.missing.join(', ')})`);
            else if (last.error) showToast('This link is incomplete or damaged - please ask the AI to send it again');
            return;
        } finally { for (const link of mine) inFlight.delete(link); }
    }
}
