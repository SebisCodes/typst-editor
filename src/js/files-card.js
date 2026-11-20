/**
 * The card of a document in "My documents": a little page with the document's title and first
 * words, its name, when it changed and its size, and the buttons to rename, duplicate,
 * download and delete it.
 */

const SECOND = 1000;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const TWO_DAYS = 172800;
const KILOBYTE = 1024;
/** Sizes below this many bytes get one decimal. */
const ONE_DECIMAL_LIMIT = 10 * KILOBYTE;
/** The longest text a card shows. */
const SUMMARY_LENGTH = 260;
const ICONS = {
    rename: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
    delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
};

/**
 * Returns how long ago a time was, in words.
 * @param {number} time - the time (milliseconds since 1970).
 * @returns {string} "just now", "5 min ago", "3 h ago", "yesterday" or the date.
 */
function formatAge(time) {
    const seconds = (Date.now() - time) / SECOND;
    if (seconds < MINUTE) return 'just now';
    if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)} min ago`;
    if (seconds < DAY) return `${Math.floor(seconds / HOUR)} h ago`;
    if (seconds < TWO_DAYS) return 'yesterday';
    return new Date(time).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Returns the title and the first words of a document for its card.
 * @param {string} code - the document's Typst code.
 * @returns {{title: string, text: string}} the title of #set document (or the first heading)
 *   and the start of the text without comments, rules, function names and markup characters.
 */
function getSummary(code) {
    const title = /#set\s+document\s*\([^)]*title:\s*"([^"]*)"/.exec(code) || /^\s*=+\s+(.+)$/m.exec(code);
    const text = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*#(set|show|import|let)\b.*$/gm, ' ').replace(/#[\p{L}_][\p{L}\p{N}_.-]*/gu, ' ')
        .replace(/[=*_$`#\\[\](){}<>@~]/g, ' ').replace(/\s+/g, ' ').trim();
    return { title: title ? title[1].replace(/[*_\\]/g, '').trim() : '', text: text.slice(0, SUMMARY_LENGTH) };
}

/**
 * Returns a size in bytes or kilobytes.
 * @param {number} bytes - the size.
 * @returns {string} "512 bytes" or "3.4 KB".
 */
export function formatSize(bytes) {
    return bytes < KILOBYTE ? `${bytes} bytes` : `${(bytes / KILOBYTE).toFixed(bytes < ONE_DECIMAL_LIMIT ? 1 : 0)} KB`;
}

/**
 * Returns an icon of the card buttons.
 * @param {string} key - the icon's key.
 * @returns {string} the SVG.
 */
function formatIcon(key) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[key]}</svg>`;
}

/**
 * Creates the card of a document.
 * @param {import('./files.js').FileEntry} entry - the document's entry.
 * @param {string} code - its code.
 * @param {boolean} isCurrent - true for the open document.
 * @returns {HTMLLIElement} the card.
 */
export function createCard(entry, code, isCurrent) {
    const card = document.createElement('li');
    card.className = 'file-card' + (isCurrent ? ' current' : '');
    card.dataset.id = entry.id;
    card.innerHTML = `<button type="button" class="file-open"><span class="file-picture doc"><span class="mini-page" data-no-i18n><b></b><i></i></span></span></button>
            <div class="file-text"><span class="file-name" data-no-i18n></span><span class="file-info muted"></span></div>
            <div class="file-buttons">
                <button type="button" class="item-button" data-act="rename" title="Rename" aria-label="Rename">${formatIcon('rename')}</button>
                <button type="button" class="item-button" data-act="copy" title="Duplicate" aria-label="Duplicate">${formatIcon('copy')}</button>
                <button type="button" class="item-button" data-act="download" title="Download as .typ" aria-label="Download">${formatIcon('download')}</button>
                <button type="button" class="item-button danger" data-act="delete" title="Delete" aria-label="Delete">${formatIcon('delete')}</button>
            </div>`;
    card.title = isCurrent ? 'This document is open' : 'Click to open this document';
    const summary = getSummary(code);
    card.querySelector('.mini-page b').textContent = summary.title;
    card.querySelector('.mini-page i').textContent = summary.text;
    card.querySelector('.file-name').textContent = entry.name;
    card.querySelector('.file-open').setAttribute('aria-label', isCurrent ? `${entry.name} (open now)` : `Open ${entry.name}`);
    card.querySelector('.file-info').textContent = isCurrent ? `Open now · ${formatSize(entry.size || 0)}` : `${formatAge(entry.updated)} · ${formatSize(entry.size || 0)}`;
    return card;
}
