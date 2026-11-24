/**
 * Reads a JSON list of cases (argv[3]) and runs each through the Typst editor's modules in src/js
 * (argv[2]) as the editor runs them, without a browser: the problems of the placeholders, the kind
 * of code at each tag, the highlighting with and without the template syntax of the case, and the
 * text, map and files the compiler gets for the example view and the template view. Prints one
 * JSON result per case for template_test.py.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const scriptFolder = resolve(process.argv[2]);
const cases = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const { highlight } = await loadModule('typst.js');
const typstTemplate = await loadModule('typst-template.js');
const typstExamples = await loadModule('typst-examples.js');
const template = await loadModule('template-tags.js');
const { createTemplateExamples } = await loadModule('template-examples.js');
const { getPictureHeader } = await loadModule('template-pictures.js');

/**
 * Loads a module of the editor by its file name.
 * @param {string} fileName - the file in src/js, e.g. "typst.js".
 * @returns {Promise<object>} the module's exports.
 */
function loadModule(fileName) {
    return import(pathToFileURL(join(scriptFolder, fileName)).href);
}

/**
 * Reads the size of a picture for the checks of template-pictures.js, as the browser's decoder gives it: from its header.
 * @param {Uint8Array} bytes - the picture's bytes.
 * @returns {Promise<{width: number, height: number}>} the size.
 */
async function readPictureSize(bytes) {
    const header = getPictureHeader(bytes);
    return { width: header.width, height: header.height };
}

/**
 * One case of template_test.py.
 * @typedef {object} TemplateCase
 * @property {string} code - the Typst code.
 * @property {?string} template - the template syntax, or null for plain Typst.
 * @property {Object<string, string>} [files] - the document's files: name -> data URI.
 * @property {object} [examples] - the page's template message: placeholders and assets.
 */

/**
 * Returns a view in the shape the test reads: the text, the map and the files with their data URIs cut after the type.
 * @param {import('../../src/js/typst-examples.js').TypstView} view - the view.
 * @param {Object<string, string>} files - the document's files.
 * @returns {object} the text, the map, the file types and whether the document's files are kept.
 */
function buildViewResult(view, files) {
    return {
        text: view.text,
        map: view.map.map(segment => ({ viewStart: segment.viewStart, viewEnd: segment.viewEnd, codeStart: segment.codeStart, codeEnd: segment.codeEnd, kind: segment.kind, picture: segment.picture ? segment.picture.name : null })),
        files: Object.fromEntries(Object.entries(view.files).map(([name, dataUrl]) => [name, dataUrl.slice(0, dataUrl.indexOf(','))])),
        fileData: view.files,
        filesKept: Object.entries(files).every(([name, dataUrl]) => view.files[name] === dataUrl),
    };
}

/**
 * Builds the result of one case: what the editor makes of its code with its template syntax.
 * @param {TemplateCase} testCase - the code and the template syntax.
 * @returns {Promise<object>} the problems, the tags with their kind of code, the highlighting and the two views.
 */
async function buildCaseResult(testCase) {
    const syntax = template.getTemplateSyntax(testCase.template);
    const code = testCase.code;
    const files = testCase.files || {};
    const result = {
        problems: typstTemplate.getTemplateProblems(code, syntax),
        tags: syntax ? typstTemplate.getPlacedTags(code, syntax).map(({ tag, context }) => ({ start: tag.start, end: tag.end, text: code.slice(tag.start, tag.end), kind: tag.kind, context })) : [],
        highlighted: syntax ? template.buildHighlightWithTemplateTags(highlight(template.convertTemplateTagsToLetters(code, syntax)), syntax, code) : highlight(code),
        plainHighlighted: highlight(code),
    };
    if (!syntax) return result;
    const examples = testCase.examples ? await createTemplateExamples(testCase.examples, { decodePicture: readPictureSize }) : null;
    result.example = buildViewResult(typstExamples.buildTypstView(code, syntax, examples, typstExamples.EXAMPLE_VIEW, files), files);
    result.template = buildViewResult(typstExamples.buildTypstView(code, syntax, examples, typstExamples.TEMPLATE_VIEW, files), files);
    result.converted = typstExamples.convertCompileResult(
        { problems: [{ kind: 'error', msg: 'at the end', hints: [], pos: result.example.text.length, end: result.example.text.length, line: 1, col: 1, file: '' }],
            ast: { text: [[0, result.example.text.length, 'T']], headings: [], math: [], marks: [] } },
        result.example.text, typstExamples.buildTypstView(code, syntax, examples, typstExamples.EXAMPLE_VIEW, files).map, code);
    return result;
}

/** Texts written for each kind of code, for the escaping checks. */
const writes = Object.fromEntries(['markup', 'math', 'code', 'string', 'comment', 'raw'].map(context => [context, typstExamples.writeTypstText(context, 'A "b" \\ #c *d* `e` */ <f> @g\nh')]));
writes.nestedComment = typstExamples.writeTypstText('comment', 'a /* b */ c');

console.log(JSON.stringify({ cases: await Promise.all(cases.map(buildCaseResult)), writes }));
