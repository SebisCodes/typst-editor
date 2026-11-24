/**
 * The selected picture of the preview and its removal. A click on a picture selects it: an
 * outline goes around it and an X button stands at its top right corner, over the picture, so
 * nothing on the page moves. The X, or Delete or Backspace while the keyboard focus is on the
 * preview, removes the picture; the editor cuts its code (one undo step). The same file serves
 * every giit editor with pictures on a preview; the SVG editor takes only the X button.
 *
 * The flow of a selection:
 *   1. startPictureRemover() takes the editor's parts (where the overlay goes, how a picture is
 *      found, shown in the code and removed) and listens to the keys and presses of the page;
 *   2. the editor's click handler calls handlePictureClick(): a click on a picture selects it
 *      and leads the code there with the focus kept on the preview;
 *   3. each frame of a selection the outline and the X follow the picture; a picture that left
 *      the page (the preview drawn again) or a change of the code ends the selection;
 *   4. the X, Delete or Backspace remove the picture; Escape or a press elsewhere end the selection.
 */

/** The width and height of the X button, in pixels. */
const BUTTON_SIZE = 24;
/** The space between the X button and the picture's top right corner, in pixels. */
const BUTTON_INSET = 4;
const REMOVE_TEXT = 'Remove picture';
const REMOVE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
/** The keys that remove the selected picture. */
const REMOVE_KEYS = new Set(['Delete', 'Backspace']);
/** Elements whose keys edit text. */
const TEXT_FIELDS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * The parts of an editor that the selection works with.
 * @typedef {object} PictureRemoverParts
 * @property {HTMLElement} layer - the positioned element that holds the outline and the X; its scroll offsets count.
 * @property {function(Element): (Element|null)} findPicture - returns the picture a clicked element belongs to, null for none.
 * @property {function(Element): (DOMRect|null)} getPictureBox - returns the picture's box in the coordinates of the page's window, null when it is out of view.
 * @property {function(Element, boolean): void} showPictureCode - leads the code to the picture; true opens the code on a narrow screen.
 * @property {function(Element): void} removePicture - removes the picture's code as one undo step (or shows why it cannot).
 * @property {function(): string} getCode - returns the code of the editor.
 * @property {function(): boolean} isNarrowScreen - tells whether the code and the preview are views of their own.
 * @property {function(): boolean} isEnabled - tells whether pictures can be removed (false in the viewer).
 */

/** @type {PictureRemoverParts|null} */
let parts = null;
/** The selected picture, null when none. */
let selected = null;
/** The code when the picture was selected. */
let selectedCode = '';
let outline = null;
let removeButton = null;
let watchFrame = 0;

/**
 * Creates the X button that removes a picture, in the editors' icon style; a press on it, and
 * Space or Enter on it, stay with the button.
 * @param {function(): void} handleRemove - called when the button is used.
 * @returns {HTMLButtonElement} the button, not yet on the page.
 */
export function createPictureRemoveButton(handleRemove) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picture-remove';
    button.title = REMOVE_TEXT;
    button.setAttribute('aria-label', REMOVE_TEXT);
    button.innerHTML = REMOVE_ICON;
    button.addEventListener('pointerdown', event => event.stopPropagation());
    button.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); });
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); handleRemove(); });
    return button;
}

/**
 * Starts the selection of pictures: creates the outline and the X in the layer and listens to
 * the keys and presses of the editor's page.
 * @param {PictureRemoverParts} editorParts - the editor's parts.
 * @returns {void}
 */
export function startPictureRemover(editorParts) {
    parts = editorParts;
    outline = document.createElement('div');
    outline.className = 'picture-outline';
    outline.setAttribute('aria-hidden', 'true');
    removeButton = createPictureRemoveButton(removeSelectedPicture);
    outline.hidden = removeButton.hidden = true;
    parts.layer.append(outline, removeButton);
    connectPictureRemover(document);
}

/**
 * Listens to the keys and presses of a document that shows pictures (the page itself, or the
 * document of a preview frame).
 * @param {Document} pictureDocument - the document.
 * @returns {void}
 */
export function connectPictureRemover(pictureDocument) {
    pictureDocument.addEventListener('keydown', handlePictureKey);
    pictureDocument.addEventListener('pointerdown', hideOnPressElsewhere, true);
}

/**
 * Selects the picture of a click (called by the editor's click handler first): the picture gets
 * the outline and the X, the code shows its place, the focus leaves the code. On a narrow screen
 * a click on the selected picture opens the code.
 * @param {MouseEvent} event - the click.
 * @returns {boolean} true when the click was on a picture and is handled.
 */
export function handlePictureClick(event) {
    const target = getTargetElement(event.target);
    const picture = parts && target && parts.isEnabled() ? parts.findPicture(target) : null;
    if (!picture) return false;
    const openCode = picture === selected && parts.isNarrowScreen();
    selectPicture(picture);
    parts.showPictureCode(picture, openCode);
    return true;
}

/**
 * Selects a picture: shows the outline and the X over it and keeps them on it each frame.
 * @param {Element} picture - the picture.
 * @returns {void}
 */
function selectPicture(picture) {
    moveFocusToPage(picture.ownerDocument);
    selected = picture;
    selectedCode = parts.getCode();
    cancelAnimationFrame(watchFrame);
    watchSelectedPicture();
}

/**
 * Ends the selection: hides the outline and the X.
 * @returns {void}
 */
export function hidePictureRemover() {
    selected = null;
    cancelAnimationFrame(watchFrame);
    if (outline) outline.hidden = removeButton.hidden = true;
}

/**
 * Handles a key while a picture is selected (a keydown handler): Escape ends the selection,
 * Delete or Backspace with the focus on the preview remove the picture.
 * @param {KeyboardEvent} event - the key.
 * @returns {boolean} true when the key was used.
 */
export function handlePictureKey(event) {
    if (!selected || event.defaultPrevented) return false;
    if (event.key === 'Escape') { hidePictureRemover(); return true; }
    if (!REMOVE_KEYS.has(event.key) || event.ctrlKey || event.metaKey || event.altKey || !isPreviewKeyTarget(event.target)) return false;
    event.preventDefault();
    removeSelectedPicture();
    return true;
}

/**
 * Removes the selected picture through the editor and ends the selection; a picture whose code
 * changed since its selection is left as it is.
 * @returns {void}
 */
function removeSelectedPicture() {
    const picture = selected;
    const isCurrent = picture?.isConnected && parts.getCode() === selectedCode;
    hidePictureRemover();
    if (isCurrent && parts.isEnabled()) parts.removePicture(picture);
}

/**
 * Ends the selection on a press outside the selected picture and its X (a pointerdown handler
 * in the capture phase).
 * @param {PointerEvent} event - the press.
 * @returns {void}
 */
function hideOnPressElsewhere(event) {
    if (!selected) return;
    const target = event.target;
    if (target === removeButton || removeButton.contains(target) || selected.contains(target)) return;
    hidePictureRemover();
}

/**
 * Tells whether a key went to the preview: an element around the layer (the page, the
 * preview's stage), the layer or what it holds, or a preview frame; text fields and dialogs
 * keep their keys.
 * @param {EventTarget} target - the key's target.
 * @returns {boolean} true for a key on the preview.
 */
function isPreviewKeyTarget(target) {
    const element = getTargetElement(target);
    if (!element || element.closest(TEXT_FIELDS) || element.closest('dialog')) return false;
    return element.ownerDocument !== document || element.contains(parts.layer) || parts.layer.contains(element);
}

/**
 * Returns the element of an event's target: the target itself, or the element that holds a
 * text node; a target in a preview frame counts as well.
 * @param {EventTarget|null} target - the target.
 * @returns {Element|null} the element, null for a target outside the documents.
 */
function getTargetElement(target) {
    if (target?.nodeType === Node.ELEMENT_NODE) return target;
    return target?.nodeType === Node.TEXT_NODE ? target.parentElement : null;
}

/**
 * Moves the keyboard focus from a control or text field of the page (the code, a button of the
 * bar) or of the picture's document (a field in a preview frame) to the page itself, so the keys
 * that follow go to the preview.
 * @param {Document} pictureDocument - the document that shows the picture.
 * @returns {void}
 */
function moveFocusToPage(pictureDocument) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !parts.layer.contains(active)) active.blur();
    const framed = pictureDocument !== document ? pictureDocument.activeElement : null;
    if (framed && framed !== pictureDocument.body && typeof framed.blur === 'function') framed.blur();
}

/**
 * Keeps the outline and the X on the selected picture, once per frame; a picture that left the
 * page or a change of the code ends the selection.
 * @returns {void}
 */
function watchSelectedPicture() {
    if (!selected) return;
    if (!selected.isConnected || parts.getCode() !== selectedCode || !parts.isEnabled()) { hidePictureRemover(); return; }
    movePictureRemover(parts.getPictureBox(selected));
    watchFrame = requestAnimationFrame(watchSelectedPicture);
}

/**
 * Places the outline around a picture's box and the X at its top right corner, inside the
 * picture when it is large enough, else over the corner; no box hides both.
 * @param {DOMRect|null} box - the picture's box in the page's window, null when out of view.
 * @returns {void}
 */
function movePictureRemover(box) {
    outline.hidden = removeButton.hidden = !box;
    if (!box) return;
    const layer = parts.layer, frame = layer.getBoundingClientRect();
    const left = box.left - frame.left - layer.clientLeft + layer.scrollLeft;
    const top = box.top - frame.top - layer.clientTop + layer.scrollTop;
    const inset = Math.min(box.width, box.height) >= BUTTON_SIZE + 2 * BUTTON_INSET ? BUTTON_INSET : 0;
    Object.assign(outline.style, { left: left + 'px', top: top + 'px', width: box.width + 'px', height: box.height + 'px' });
    Object.assign(removeButton.style, { left: left + box.width - inset - BUTTON_SIZE + 'px', top: top + inset + 'px' });
}
