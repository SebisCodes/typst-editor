/**
 * Template placeholders in Typst (?template=mustache or ?template=angle): the kind of code each tag
 * stands in, the problems of the placeholders and the placeholder pictures. The notation, the tag
 * finder and the section check are in the shared module template-tags.js; the text the compiler
 * reads for the example view and the template view is made in typst-examples.js.
 *
 * The kind of code at a tag is read as the reader of the highlighting reads it (typst.js,
 * getCodeContexts): markup, code, string, comment, raw or math. A value directly in code has no
 * place a server could fill text into, so it is reported at the tag (write it as a string). A
 * picture whose file name holds a placeholder gets a placeholder picture of the format its
 * extension names, so the compile goes on; it lives in the compiler's files only.
 */

import { getTemplateSyntax, getTemplateNameByAddress, findTemplateTagAt, getTemplateTags, convertTemplateTagsToLetters, checkTemplateSections, buildTemplatePicture } from './template-tags.js?v=2';
import { getCodeContexts, getContextAt } from './typst.js?v=8';

/** The template syntax of the placeholders the address asks for with ?template=, or null. */
export const TEMPLATE_SYNTAX = getTemplateSyntax(getTemplateNameByAddress(typeof location === 'undefined' ? '' : location.search));
/** The placeholder pictures of the raster formats, a light frame each; other names get the SVG picture. */
const PLACEHOLDER_PICTURES = {
    PNG: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8AQMAAACXY+zrAAAABlBMVEXm9Oy33Mbb/ExOAAAAHElEQVR42mP4jwoYGhiQAeMof5Q/yh9EfLT8CgCoKzsdlfHOHgAAAABJRU5ErkJggg==',
    GIF: 'data:image/gif;base64,R0lGODdheAA8AIEAAOb07LfcxgAAAAAAACwAAAAAeAA8AEAI/wADCBxIsKDBgwgTKlzIsKHDhwEASJxIsaLFixgzatzIsaPHjgI/ihxJsqRJkBFPqlzJsqXEkC5jypx5ESbNmzhX2szJsydKn0CD1kwptCjQnUaT3kSqtKlLpk6jnoQqtapIqlazbsSqtatFrl7DAgArtivZslnPoq2qdm3Utm6bwo2bdC7donbvBs2r1yffvjz/AsYpeDDNwoZlIk78lCjjt44fy40suS7lyngvY96rebPfzp4Dgw5NeDTpw6ZPK06tunFrzq+Pso6tcjFtjbZvY8yt++vs3iN5A58ofPjY38Z/Jo9ZfHhz4M97R9c9/XZ12tdjQ9zOvbv37woDAgA7',
    JPEG: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAA8AHgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDtI0QxqSq9B2pfLT+4v5UR/wCrX6Cn0iBnlp/cX8qPLT+4v5U+igBnlp/cX8qPLT+4v5U+igBnlp/cX8qPLT+4v5U+igBnlp/cX8qPLT+4v5U+igBnlp/cX8qPLT+4v5U+igBnlp/cX8qPLT+4v5U+igCOREEbEKvQ9qKWT/Vt9DRSZEgj/wBWv0FPpkf+rX6Cn0ywooooAKKKKACiiigAooooAKKKKACiiigBkn+rb6GiiT/Vt9DRSZEgj/1a/QU+mR/6tfoKfTLCiiigAooooAKKKKACiiigAooooAKKKKAGSf6tvoaKJP8AVt9DRSZEgj/1a/QU+qa3DqoAC8DFL9pf0WmVct0VU+0v6LR9pf0WgLluiqn2l/RaPtL+i0Bct0VU+0v6LR9pf0WgLluiqn2l/RaPtL+i0Bct0VU+0v6LR9pf0WgLluiqn2l/RaPtL+i0BcsSf6tvoaKrNcOykELyMUUiZH//2Q==',
    WEBP: 'data:image/webp;base64,UklGRjAAAABXRUJQVlA4TCQAAAAvd8AOAA9wdPpHm1+bff7jAWQCFjTXfB8BPBH9nwBWq8+tsAI=',
};
/** The extensions of the raster formats, by the key of their picture. */
const PICTURE_EXTENSIONS = { png: 'PNG', gif: 'GIF', jpg: 'JPEG', jpeg: 'JPEG', webp: 'WEBP' };

/**
 * A template tag with the kind of code it stands in.
 * @typedef {object} PlacedTag
 * @property {import('./template-tags.js').TemplateTag} tag - the tag.
 * @property {string} context - markup, code, string, comment, raw or math.
 */

/**
 * Returns the tags of the code with the kind of code each stands in.
 * @param {string} code - the code.
 * @param {import('./template-tags.js').TemplateSyntax} syntax - the template syntax.
 * @returns {PlacedTag[]} the tags in order.
 */
export function getPlacedTags(code, syntax) {
    const tags = getTemplateTags(code, syntax);
    if (!tags.length) return [];
    const contexts = getCodeContexts(convertTemplateTagsToLetters(code, syntax));
    return tags.map(tag => ({ tag, context: getContextAt(contexts, tag.start) }));
}

/**
 * Returns the problems of the template placeholders in the shape of the compiler's problems: the
 * section errors and every value that stands in code.
 * @param {string} code - the code.
 * @param {?import('./template-tags.js').TemplateSyntax} syntax - the template syntax, or null.
 * @returns {import('./state.js').Problem[]} the problems in the order of the code; empty without a syntax.
 */
export function getTemplateProblems(code, syntax) {
    if (!syntax) return [];
    const problems = checkTemplateSections(code, syntax).map(problem => ({ ...problem, end: findTemplateTagAt(code, problem.pos, syntax)?.end ?? problem.pos }));
    for (const { tag, context } of getPlacedTags(code, syntax)) {
        if (context !== 'code' || tag.kind !== 'value') continue;
        const written = code.slice(tag.start, tag.end);
        problems.push({ pos: tag.start, end: tag.end, kind: 'error', msg: `Write the placeholder in code as a string: "${written}"` });
    }
    return problems.sort((first, second) => first.pos - second.pos).map(problem => buildCompilerProblem(code, problem));
}

/**
 * Builds a problem in the shape of the compiler's problems (worker-source.js): line and column
 * (in code points, 1-based), no hints, in the code itself.
 * @param {string} code - the code.
 * @param {import('./template-tags.js').TemplateProblem} problem - the problem at its offsets (pos, end, kind, msg).
 * @returns {import('./state.js').Problem} the problem.
 */
function buildCompilerProblem(code, problem) {
    const lineStart = code.lastIndexOf('\n', problem.pos - 1) + 1;
    const line = code.slice(0, lineStart).split('\n').length;
    const column = [...code.slice(lineStart, problem.pos)].length + 1;
    return { kind: problem.kind, msg: problem.msg, hints: [], pos: problem.pos, end: problem.end, line, col: column, file: '', isEditorText: true };
}

/**
 * Returns the placeholder picture for a file name: the raster picture of its extension, else the
 * SVG picture with the name.
 * @param {string} name - the file name as written.
 * @returns {string} the picture as a data URI.
 */
export function getPlaceholderPicture(name) {
    const extension = (/\.([A-Za-z0-9]+)$/.exec(name) || [])[1];
    const format = extension && PICTURE_EXTENSIONS[extension.toLowerCase()];
    return format ? PLACEHOLDER_PICTURES[format] : buildTemplatePicture(name);
}
