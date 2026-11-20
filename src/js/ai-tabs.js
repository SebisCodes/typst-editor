/**
 * Editor tabs of this browser talk over a BroadcastChannel: a tab opened by an AI link asks
 * which editor tabs are open (ping), picks the one used last and hands it the document; that
 * tab answers with the id of the document it is in. The viewer neither hands a link to an open
 * editor tab nor takes one.
 */

const CHANNEL = 'typsteditor';
const ID_RADIX = 36;
const ID_START = 2;
/** How long a tab waits for the other editor tabs to answer. */
const PING_WAIT = 350;
/** How long a tab waits for another tab to take a document. */
const HANDOVER_WAIT = 4000;
const tabId = Math.random().toString(ID_RADIX).slice(ID_START);
let lastFocus = document.hasFocus() ? Date.now() : 0;
addEventListener('focus', () => { lastFocus = Date.now(); });

/**
 * Creates the channel of the editor tabs and answers the other tabs on it.
 * @param {function(string, string, object): Promise<string>} receiveDocument - takes a document
 *   meant for this tab; resolves with the id of the document it is in.
 * @returns {BroadcastChannel|null} the channel, null in the viewer or without BroadcastChannel.
 */
export function createTabChannel(receiveDocument) {
    const channel = new URLSearchParams(location.search).get('viewer') !== '1' && 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
    if (channel) channel.addEventListener('message', event => sendChannelAnswer(channel, receiveDocument, event));
    return channel;
}

/**
 * Returns a new random id for one question on the channel.
 * @returns {string} the id.
 */
export function createRequestId() {
    return Math.random().toString(ID_RADIX).slice(ID_START);
}

/**
 * Answers the other editor tabs: a ping with this tab's last focus, and a document meant for
 * this tab with the id of the document it is in (for "Open it here" in the other tab).
 * @param {BroadcastChannel} channel - the channel of the editor tabs.
 * @param {function(string, string, object): Promise<string>} receiveDocument - takes a document; resolves with its id.
 * @param {MessageEvent} event - the channel message.
 * @returns {void}
 */
function sendChannelAnswer(channel, receiveDocument, event) {
    const message = event.data || {};
    if (message.type === 'ping') channel.postMessage({ type: 'pong', ask: message.ask, tab: tabId, focus: lastFocus });
    if (message.type === 'document' && message.to === tabId) {
        Promise.resolve(receiveDocument(message.typ, message.mode, message.target)).catch(() => null).then(id => channel.postMessage({ type: 'got', ask: message.ask, id }));
    }
}

/**
 * Returns the open editor tab that was used last.
 * @param {BroadcastChannel|null} channel - the channel of the editor tabs.
 * @param {string} requestId - the id of this question.
 * @returns {Promise<object|null>} the tab's answer, null when no tab answers.
 */
export function findEditorTab(channel, requestId) {
    if (!channel) return Promise.resolve(null);
    return new Promise(resolve => {
        const tabs = [];
        /**
         * Collects the answers of the tabs to this ping.
         * @param {MessageEvent} event - a channel message.
         * @returns {void}
         */
        const addAnswer = event => { if (event.data && event.data.type === 'pong' && event.data.ask === requestId) tabs.push(event.data); };
        channel.addEventListener('message', addAnswer);
        channel.postMessage({ type: 'ping', ask: requestId });
        setTimeout(() => {
            channel.removeEventListener('message', addAnswer);
            tabs.sort((a, b) => b.focus - a.focus);
            resolve(tabs[0] || null);
        }, PING_WAIT);
    });
}

/**
 * Hands a document to another editor tab.
 * @param {BroadcastChannel} channel - the channel of the editor tabs.
 * @param {object} tab - the tab's answer to the ping.
 * @param {string} documentText - the Typst code.
 * @param {string} mode - "add" or "set".
 * @param {object} target - which document.
 * @param {string} requestId - the id of this question.
 * @returns {Promise<{id: string}|null>} the id of the document there, null when the tab does not answer.
 */
export function sendToTab(channel, tab, documentText, mode, target, requestId) {
    return new Promise(resolve => {
        /**
         * Settles with the id of the document the other tab took.
         * @param {MessageEvent} event - a channel message.
         * @returns {void}
         */
        const receiveAnswer = event => { if (event.data && event.data.type === 'got' && event.data.ask === requestId) { channel.removeEventListener('message', receiveAnswer); resolve({ id: event.data.id }); } };
        channel.addEventListener('message', receiveAnswer);
        channel.postMessage({ type: 'document', to: tab.tab, typ: documentText, mode, target, ask: requestId });
        setTimeout(() => { channel.removeEventListener('message', receiveAnswer); resolve(null); }, HANDOVER_WAIT);
    });
}
