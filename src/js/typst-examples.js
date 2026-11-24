/**
 * The two views of a Typst template (?template=) as the text the compiler reads, each with the map
 * that leads every place of that text back to the code (template-expansion.js), and the compiler's
 * result led back to the code.
 *
 * buildTypstView() runs these steps:
 *   1. find the kind of code every tag stands in: markup, code, string, comment, raw or math
 *      (typst-template.js, getPlacedTags);
 *   2. example view: fill the template with the page's examples, each example written for its
 *      place: markup with Typst's special characters escaped, math and code as a string, a string
 *      with its escapes, a comment and raw text without what would end them; template view: every
 *      tag as its own text written the same way, so a raw tag never stops the compiler;
 *   3. give the compiler the document's files and, for each picture whose file name holds filled
 *      text or a tag, the example picture it is filled with or a placeholder picture; these live
 *      in the compiler's files only.
 * convertCompileResult() leads the compiler's problems and syntax lists back to the code: copied
 * text to the same place, filled text to its tag.
 */

import { getTemplateTags, hasTemplatePlaceholder } from './template-tags.js?v=2';
import { expandTemplate, buildTagTextView, getCodeOffsetByViewOffset, findViewSegment } from './template-expansion.js?v=2';
import { getPlacedTags, getPlaceholderPicture } from './typst-template.js?v=1';
import { findFileReferences, getOutline } from './typst-code.js?v=3';

/** The view that shows the template filled with the examples. */
export const EXAMPLE_VIEW = 'example';
/** The view that shows the tags as their text. */
export const TEMPLATE_VIEW = 'template';
/** The characters of markup that Typst reads as markup, written with a backslash. */
const MARKUP_SPECIAL = /[\\#*_`$<>@[\]{}/~\-=+.:]/g;
/** The characters of a string that end it or start an escape. */
const STRING_SPECIAL = /["\\]/g;
/** The folder of the example pictures in the compiler's files. */
const PICTURE_FOLDER = 'template-examples/';

/**
 * The text the compiler reads for one view, with its map and files.
 * @typedef {object} TypstView
 * @property {string} text - the text the compiler reads.
 * @property {import('./template-expansion.js').ViewSegment[]} map - its map to the code.
 * @property {Object<string, string>} files - the files the compiler gets: name -> data URI.
 */

/**
 * Builds the text the compiler reads for a view (the steps in the header).
 * @param {string} code - the template.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @param {?import('./template-examples.js').TemplateExamples} examples - the page's examples, or null.
 * @param {string} mode - EXAMPLE_VIEW or TEMPLATE_VIEW.
 * @param {Object<string, string>} files - the document's files: name -> data URI.
 * @returns {TypstView} the text, its map and the files for the compiler.
 * @throws {import('./template-expansion.js').TemplateExpansionError} when the filling goes past its limits.
 */
export function buildTypstView(code, syntax, examples, mode, files) {
    const contexts = getTagContexts(code, syntax);
    if (mode === TEMPLATE_VIEW) {
        const view = buildTagTextView(code, syntax, { writeTag: tag => writeTypstTag(contexts.get(tag.start), tag, code.slice(tag.start, tag.end)) });
        return { ...view, files: getViewFiles(view, files, syntax) };
    }
    const pictureNames = { byPicture: new Map(), taken: new Set(Object.keys(files)) };
    const view = expandTemplate(code, syntax, { examples, writeFill: (tag, fill) => writeTypstFill(contexts.get(tag.start), fill, pictureNames) });
    return { ...view, files: getViewFiles(view, files, syntax) };
}

/**
 * Returns the kind of code of every tag, by the tag's start.
 * @param {string} code - the template.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @returns {Map<number, string>} markup, code, string, comment, raw or math.
 */
function getTagContexts(code, syntax) {
    return new Map(getPlacedTags(code, syntax).map(({ tag, context }) => [tag.start, context]));
}

/**
 * Writes a tag's fill for the kind of code it stands in; an example picture in a string becomes
 * the name of its file among the compiler's files.
 * @param {string} [context] - markup, code, string, comment, raw or math.
 * @param {import('./template-expansion.js').TagFill} fill - what the tag is filled with.
 * @param {PictureNames} pictureNames - the file names given to the example pictures so far; changed in place.
 * @returns {string} the Typst code of the fill.
 */
export function writeTypstFill(context, fill, pictureNames) {
    if (fill.picture && context === 'string') return getPictureFileName(fill.picture, pictureNames);
    return writeTypstText(context, fill.text);
}

/**
 * Writes a tag as its own text for the kind of code it stands in (the template view): in code a
 * value is a string and a section tag a comment, so the compiler reads every tag as text.
 * @param {string} [context] - markup, code, string, comment, raw or math.
 * @param {import('./template-tags.js').TemplateTag} tag - the tag.
 * @param {string} written - the tag as written.
 * @returns {string} the Typst code of the tag's text.
 */
export function writeTypstTag(context, tag, written) {
    if (context === 'code' && tag.kind !== 'value') return `/*${written}*/`;
    return writeTypstText(context, written);
}

/**
 * Writes a text for the kind of code it stands in.
 * @param {string} [context] - markup, code, string, comment, raw or math; markup when unknown.
 * @param {string} text - the text.
 * @returns {string} the Typst code that shows the text there.
 */
export function writeTypstText(context, text) {
    switch (context) {
        case 'code':
        case 'math': return `"${escapeTypstString(text.replace(/\n/g, ' '))}"`;
        case 'string': return escapeTypstString(text);
        case 'comment': return text.replace(/\n/g, ' ').split('*/').join('* /').split('/*').join('/ *');
        case 'raw': return text.replace(/`/g, '');
        default: return escapeTypstMarkup(text);
    }
}

/**
 * Escapes a text for Typst markup: every special character with a backslash, a line break as
 * Typst's line break.
 * @param {string} text - the text.
 * @returns {string} the markup.
 */
export function escapeTypstMarkup(text) {
    return text.replace(MARKUP_SPECIAL, character => '\\' + character).replace(/\n/g, '\\ ');
}

/**
 * Escapes a text for the inside of a Typst string.
 * @param {string} text - the text.
 * @returns {string} the string's content, with quotes, backslashes and line breaks escaped.
 */
function escapeTypstString(text) {
    return text.replace(STRING_SPECIAL, character => '\\' + character).replace(/\n/g, '\\n');
}

/**
 * The file names of the example pictures among the compiler's files.
 * @typedef {object} PictureNames
 * @property {Map<string, string>} byPicture - the name given to each picture, by the picture's name.
 * @property {Set<string>} taken - the names of the document's files and the names given so far.
 */

/**
 * Returns the file name an example picture has among the compiler's files, given once per
 * picture: a numbered name in a folder of its own that no file of the document has, with the
 * extension of its type. A query that fills a cache.
 * @param {import('./template-pictures.js').ExamplePicture} picture - the picture.
 * @param {PictureNames} pictureNames - the names given so far; changed in place.
 * @returns {string} the file name.
 */
function getPictureFileName(picture, pictureNames) {
    if (pictureNames.byPicture.has(picture.name)) return pictureNames.byPicture.get(picture.name);
    let number = pictureNames.byPicture.size + 1;
    while (pictureNames.taken.has(`${PICTURE_FOLDER}${number}.${picture.extension}`)) number++;
    const name = `${PICTURE_FOLDER}${number}.${picture.extension}`;
    pictureNames.byPicture.set(picture.name, name);
    pictureNames.taken.add(name);
    return name;
}

/**
 * Returns the files the compiler gets for a view: the document's files and, for each picture
 * whose file name holds filled text or a tag and is no file of the document, the example picture
 * it is filled with, else a placeholder picture of its format.
 * @param {import('./template-expansion.js').TemplateView} view - the text and its map.
 * @param {Object<string, string>} files - the document's files: name -> data URI.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the syntax.
 * @returns {Object<string, string>} the files for the compiler.
 */
function getViewFiles(view, files, syntax) {
    let compiled = files;
    for (const reference of findFileReferences(view.text)) {
        if (reference.fn !== 'image' || reference.name in files) continue;
        const fills = getFillSegments(view.map, reference.nameAt, reference.nameAt + reference.len);
        if (!fills.length && !(getTemplateTags(reference.name, syntax).length || hasTemplatePlaceholder(reference.name))) continue;
        const picture = fills.find(segment => segment.picture)?.picture;
        if (compiled === files) compiled = { ...files };
        compiled[reference.name] = picture ? picture.dataUrl : getPlaceholderPicture(reference.name);
    }
    return compiled;
}

/**
 * Returns the fill segments that overlap a stretch of the text.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map.
 * @param {number} start - where the stretch starts.
 * @param {number} end - where it ends.
 * @returns {import('./template-expansion.js').ViewSegment[]} the fill segments, in order.
 */
function getFillSegments(map, start, end) {
    const fills = [];
    for (let index = Math.max(0, findViewSegment(map, start)); index < map.length && map[index].viewStart <= end; index++) {
        const segment = map[index];
        if (segment.kind === 'fill' && segment.viewEnd >= start && segment.viewStart <= end) fills.push(segment);
    }
    return fills;
}

/**
 * The compiler's result led back to the code.
 * @typedef {object} CodeResult
 * @property {Array<object>} problems - the compiler's problems at their places in the code.
 * @property {object} ast - the syntax lists at their places in the code: plain text only where it is copied text.
 * @property {import('./typst-code.js').OutlineHeading[]} outline - the headings with their titles as shown and places in the code.
 */

/**
 * Leads the compiler's result on the text of a view back to the code.
 * @param {object} result - the compiler's result: problems and ast on the view's text.
 * @param {string} viewText - the text the compiler read.
 * @param {?import('./template-expansion.js').ViewSegment[]} map - its map to the code, null when the text is the code.
 * @param {string} code - the code as written.
 * @returns {CodeResult} the problems, syntax lists and outline in the code.
 */
export function convertCompileResult(result, viewText, map, code) {
    const ast = result.ast || { text: [], headings: [], math: [], marks: [] };
    const outline = getOutline(viewText, ast.headings);
    if (!map) return { problems: result.problems || [], ast, outline };
    /**
     * Returns the place in the code of a place of the view's text.
     * @param {number} place - the place in the view's text.
     * @returns {number} the place in the code.
     */
    const getCodePlace = place => getCodeOffsetByViewOffset(map, place);
    /**
     * Returns the place in the code of the end of a stretch of the view's text.
     * @param {number} start - where the stretch starts in the view's text.
     * @param {number} end - where it ends.
     * @returns {number} the end in the code, never before the start's place.
     */
    const getCodeEndPlace = (start, end) => getCodeEnd(map, start, end);
    return {
        problems: (result.problems || []).map(problem => convertProblem(problem, code, getCodePlace, getCodeEndPlace)),
        ast: {
            text: ast.text.flatMap(([start, end, kind]) => getCopiedParts(map, start, end).map(([codeStart, codeEnd]) => [codeStart, codeEnd, kind])),
            headings: ast.headings.map(([start, end]) => [getCodePlace(start), getCodeEndPlace(start, end)]),
            math: ast.math.map(([start, end]) => [getCodePlace(start), getCodeEndPlace(start, end)]),
            marks: ast.marks.map(([start, end, kind]) => [getCodePlace(start), getCodeEndPlace(start, end), kind]),
        },
        outline: outline.map(heading => ({ ...heading, pos: getCodePlace(heading.pos) })),
    };
}

/**
 * Returns the place in the code of the end of a stretch of the view's text: the end of the last
 * character's segment (a fill's tag end, or the copied character's next place), so a stretch that
 * ends where a repeated list entry begins keeps its end in its own entry.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map.
 * @param {number} start - where the stretch starts in the view's text.
 * @param {number} end - where it ends.
 * @returns {number} the end in the code, never before the start's place.
 */
function getCodeEnd(map, start, end) {
    const startPlace = getCodeOffsetByViewOffset(map, start);
    if (end <= start) return startPlace;
    const segment = map[findViewSegment(map, end - 1)];
    if (!segment) return startPlace;
    const place = segment.kind === 'fill' ? segment.codeEnd : segment.codeStart + Math.min(end, segment.viewEnd) - segment.viewStart;
    return Math.max(startPlace, place);
}

/**
 * Leads one problem of the compiler back to the code: its places and its line and column.
 * @param {object} problem - the problem on the view's text.
 * @param {string} code - the code as written.
 * @param {function(number): number} getCodePlace - leads a place of the view's text to the code.
 * @param {function(number, number): number} getCodeEndPlace - leads the end of a stretch of the view's text to the code.
 * @returns {object} the problem in the code; a problem in another file as it is.
 */
function convertProblem(problem, code, getCodePlace, getCodeEndPlace) {
    if (problem.file) return problem;
    const pos = getCodePlace(problem.pos), end = getCodeEndPlace(problem.pos, problem.end);
    const lineStart = code.lastIndexOf('\n', pos - 1) + 1;
    return { ...problem, pos, end, line: code.slice(0, lineStart).split('\n').length, col: [...code.slice(lineStart, pos)].length + 1 };
}

/**
 * Returns the stretches of the code a stretch of the view's text was copied from, leaving out
 * filled text.
 * @param {import('./template-expansion.js').ViewSegment[]} map - the map.
 * @param {number} start - where the stretch starts in the view's text.
 * @param {number} end - where it ends.
 * @returns {Array<[number, number]>} the copied stretches in the code, in order.
 */
function getCopiedParts(map, start, end) {
    const parts = [];
    for (let index = Math.max(0, findViewSegment(map, start)); index < map.length && map[index].viewStart < end; index++) {
        const segment = map[index];
        const from = Math.max(start, segment.viewStart), to = Math.min(end, segment.viewEnd);
        if (segment.kind === 'copy' && to > from) parts.push([segment.codeStart + from - segment.viewStart, segment.codeStart + to - segment.viewStart]);
    }
    return parts;
}
