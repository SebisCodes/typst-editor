/**
 * The Insert tab: buttons for structure, text and math snippets, Greek letters and symbols
 * (outside math they go into $…$), and a link to the Pictures tab.
 */

import { escapeHtml } from './typst.js?v=8';
import { ui, getElement } from './state.js?v=3';
import { addSnippet, isInMath, addSnippetByKey } from './code-insert.js?v=6';
import { renderFilesTab } from './files-tab.js?v=6';

const GREEK = 'alpha beta gamma delta epsilon epsilon.alt zeta eta theta theta.alt iota kappa lambda mu nu xi pi rho sigma tau upsilon phi phi.alt chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'.split(' ');
/** The letter each name of GREEK shows, in the same order. */
const GREEK_LETTERS = 'αβγδϵεζηθϑικλμνξπρστυϕφχψωΓΔΘΛΞΠΣΦΨΩ';
/** The symbols: [Typst name, character]. */
const SYMBOLS = [['<=', '≤'], ['>=', '≥'], ['!=', '≠'], ['approx', '≈'], ['equiv', '≡'], ['tilde.op', '∼'], ['plus.minus', '±'], ['times', '×'], ['dot.op', '·'], ['div', '÷'],
    ['oo', '∞'], ['diff', '∂'], ['nabla', '∇'], ['in', '∈'], ['in.not', '∉'], ['subset', '⊂'], ['subset.eq', '⊆'], ['union', '∪'], ['inter', '∩'], ['emptyset', '∅'],
    ['forall', '∀'], ['exists', '∃'], ['not', '¬'], ['and', '∧'], ['or', '∨'], ['->', '→'], ['=>', '⇒'], ['<=>', '⇔'], ['|->', '↦'], ['<-', '←'],
    ['RR', 'ℝ'], ['NN', 'ℕ'], ['ZZ', 'ℤ'], ['QQ', 'ℚ'], ['CC', 'ℂ'], ['dots.h', '…'], ['dots.c', '⋯'], ['compose', '∘'], ['angle', '∠'], ['perp', '⊥']];

/**
 * Returns a button of the Insert tab.
 * @param {string} key - the snippet's key.
 * @param {string} label - the button's text.
 * @param {string} [title] - its tooltip; the label when left out.
 * @returns {string} the HTML of the button.
 */
function formatButton(key, label, title) {
    return `<button type="button" class="button" data-ins="${key}" title="${escapeHtml(title || label)}">${label}</button>`;
}

/**
 * Draws the Insert tab (and the Pictures tab when it is open).
 * @returns {void}
 */
export function renderInsertPanel() {
    if (!ui.pictures.hidden) renderFilesTab();
    ui.insert.innerHTML = `
        <div class="insert-group"><h3>Structure</h3><div class="insert-grid">
            ${formatButton('h1', 'Heading')}${formatButton('h2', 'Subheading')}${formatButton('h3', 'Third level')}${formatButton('outline', 'Contents')}
            ${formatButton('list', '• Bulleted list')}${formatButton('enum', '1. Numbered list')}${formatButton('terms', 'Term list')}${formatButton('table', 'Table')}
            ${formatButton('figure', 'Figure')}${formatButton('columns', 'Two columns')}${formatButton('quote', 'Quote')}${formatButton('center', 'Centered')}
            ${formatButton('code', 'Program code')}${formatButton('title', 'Title')}${formatButton('pagebreak', 'New page')}${formatButton('vspace', 'Vertical space')}
            ${formatButton('bibliography', 'Bibliography', 'A bibliography from a .bib file of the document (add it in the Pictures tab)')}
        </div></div>
        <div class="insert-group"><h3>Text</h3><div class="insert-grid">
            ${formatButton('footnote', 'Footnote')}${formatButton('link', 'Link')}${formatButton('label', 'Label')}${formatButton('ref', 'Reference')}
            ${formatButton('color', 'Colored text')}${formatButton('highlight', 'Highlighted')}${formatButton('box', 'Colored box')}${formatButton('hfill', 'Push right')}
        </div></div>
        <div class="insert-group"><h3>Math</h3><div class="insert-grid">
            ${formatButton('inline-math', '$x$ in the text')}${formatButton('display', 'Displayed')}${formatButton('equation', 'Numbered equation')}${formatButton('align', 'Aligned lines')}
            ${formatButton('frac', 'Fraction')}${formatButton('sqrt', 'Root')}${formatButton('sup', 'x² Power')}${formatButton('sub', 'x₁ Index')}
            ${formatButton('sum', '∑ Sum')}${formatButton('int', '∫ Integral')}${formatButton('lim', 'lim Limit')}${formatButton('matrix', 'Matrix')}
            ${formatButton('cases', 'Cases')}
        </div>
        <h3>Greek letters</h3><div class="symbol-grid">${GREEK.map((name, index) => `<button type="button" data-sym="${name}" title="${name}">${GREEK_LETTERS[index]}</button>`).join('')}</div>
        <h3>Symbols</h3><div class="symbol-grid">${SYMBOLS.map(([name, character]) => `<button type="button" data-sym="${escapeHtml(name)}" title="${escapeHtml(name)}">${character}</button>`).join('')}</div></div>
        <div class="insert-group"><h3>Pictures</h3>
            <p class="hint">Pictures and files have their own tab: <button type="button" class="link-button" data-goto-pics>Pictures</button>.</p>
        </div>`;
}

/**
 * Runs a click in the Insert tab: a snippet, a symbol (outside math in $…$) or the link to the
 * Pictures tab (a click handler).
 * @param {MouseEvent} event - the click.
 * @returns {void}
 */
function handleInsertClick(event) {
    const snippet = event.target.closest('[data-ins]');
    if (snippet) { addSnippetByKey(snippet.dataset.ins); return; }
    const symbol = event.target.closest('[data-sym]');
    if (symbol) {
        const name = symbol.dataset.sym;
        addSnippet(isInMath(ui.ta.selectionStart) ? name + ' ' : `$${name}$`, false);
        return;
    }
    if (event.target.closest('[data-goto-pics]')) getElement('[data-itab=pictures]').click();
}

/**
 * Connects the Insert tab; its buttons keep the cursor in the code.
 * @returns {void}
 */
export function startInsertPanel() {
    ui.insert.addEventListener('mousedown', event => { if (event.target.closest('[data-ins], [data-sym]')) event.preventDefault(); });
    ui.insert.addEventListener('click', handleInsertClick);
}
