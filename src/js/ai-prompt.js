/**
 * The AI prompt: instructions for any AI, the user's documents and the open document with its
 * files and problems. The prompt is always English. With the AI settings of a page around the
 * editor (sync.js) the AI sends its result to that page's server, which opens it here; pictures
 * go along only when the page takes them.
 */

import { formatSiteText, formatDocumentData, formatAnswerPart } from './prompt-parts.js?v=1';

const SITE = 'https://typst.giit.ch/';
/** The most other document names the prompt lists. */
const MAX_LISTED_DOCUMENTS = 40;
/** The most problems the prompt lists. */
const MAX_LISTED_PROBLEMS = 12;
/** The longest selection the prompt takes. */
const MAX_SELECTION_LENGTH = 300;

/** The instructions of the prompt: how to answer and what the editor has. */
export const PROMPT_BASE = `You write Typst for my editor ${SITE}. It runs the real Typst compiler (0.14) in my browser and shows the compiled pages next to the code.

HOW TO ANSWER
Write the complete document as Typst markup (#set rules at the top, then the text); it must compile with Typst 0.14 without errors. Keep my work unless I ask otherwise.
Send it as a link: ${SITE}#b64=<base64url of the UTF-8 text> (shorter: zlib-compress first and use #z=; without code: #typ=<URL-encoded text>). Open the link yourself if you can; otherwise give it to me - I click it or paste your whole answer into the editor.
- New document: add &file=new&name=<short name>. Change one of my documents: add &file=<its exact name>.
- Only add text at the end: send just that and add &mode=add.
- Longer than about 8000 characters: one link per part with &part=N&of=M&id=<short name>.
- A link carries no pictures: use only the pictures in my document. If you need another one, tell me what it should show and the name to add it under, and use that name.

WHAT THE EDITOR HAS
Everything built into Typst 0.14: markup, math, tables, figures, #set and #show rules, scripting, references, footnotes, outline, bibliography. Fonts: Libertinus Serif (default), New Computer Modern, New Computer Modern Math, DejaVu Sans Mono, plus fonts I added to the document. No packages from Typst Universe (#import "@preview/…" fails): write what you need yourself. image("name"), csv("name"), json("name"), read("name") and bibliography("name") use the pictures and files I added to the document.`;

/** About saving on the user's own server; left out when a page that holds the document opened the editor (it saves there by itself). */
export const PROMPT_SAVING = `MY OWN SERVER (only if I ask about it)
The editor can POST every saved version as JSON {editor:"typst", event:"save", id, name, content, assets, updated} to my server (webhook, optional Bearer token, CORS from ${SITE.replace(/\/$/, '')}). It can be embedded with <iframe src="${SITE}?embed=1"> or opened with window.open("${SITE}?embed=window") and then talks with postMessage (typsteditor:ready, load, loaded, change, save, get, pdf, ai, key-request). If I ask you to build that, follow ${SITE}llms.txt exactly.`;
/** The head of the prompt for the editor on its own. */
export const PROMPT_HEAD = `${PROMPT_BASE}\n\n${PROMPT_SAVING}`;

/** Pictures through the page's endpoint: offered only when the page takes them. */
const AI_PICTURES_YES = 'New or changed pictures go along in the same JSON as "assets": {"<name>": "data:image/png;base64,<data>"} - PNG, JPEG, GIF, WebP or PDF, names of letters, digits, . - and _, at most 20 pictures and 40 MB in all. Use each by that name in the document. Leave out the pictures my document already has; they stay.';
const AI_PICTURES_NO = 'Pictures cannot be sent this way: use only the pictures in my document. If you need another one, tell me what it should show and the name to add it under, and use that name.';

/**
 * What the prompt is made from (getPromptState() in agent-api.js, with framed and remote).
 * @typedef {object} PromptState
 * @property {string} code - the Typst code.
 * @property {string} name - the open document's name.
 * @property {string[]} files - the names of all documents.
 * @property {string[]} pictures - the names of the open document's files.
 * @property {string} sel - the selected code, "" without a selection.
 * @property {string[]} problems - the problems with their lines.
 * @property {{host: string, title: string, rules: string, site: string}|null} context - what the page that holds the document says.
 * @property {boolean} [framed] - true inside another website.
 * @property {object|null} [remote] - the page's AI settings (prompt, endpoint, key, label, base, site, assets).
 */

/**
 * Returns the part of the prompt about the page that holds the document.
 * @param {object} context - what the page says (plain text).
 * @param {string} context.host - the page's name for its site.
 * @param {string} context.title - the page's title.
 * @param {string} context.rules - the page's rules for the document.
 * @param {string} context.site - the page's real origin.
 * @returns {string} the part of the prompt.
 */
function formatContextPart(context) {
    return `THIS DOCUMENT BELONGS TO ${context.host ? `"${context.host}"` : 'a website'}${context.title ? ` ("${context.title}")` : ''}
That page opened the editor and gets every saved version back by itself when I click Save (or press Ctrl+S) - nothing to set up and no server to build. Keep the document working with that page.${context.rules ? `\n\n${formatSiteText('RULES', context.site, context.host, context.rules)}` : ''}`;
}

/**
 * Returns one part of PROMPT_BASE, from its heading to the next one.
 * @param {string} head - the heading.
 * @returns {string} the part with its heading, "" when there is none.
 */
function getPromptPart(head) {
    const i = PROMPT_BASE.indexOf('\n' + head + '\n');
    if (i < 0) return '';
    const rest = PROMPT_BASE.slice(i + 1), j = rest.search(/\n\n[A-Z][A-Z ]+\n/);
    return j < 0 ? rest : rest.slice(0, j);
}

/**
 * Returns the head of the prompt when the page around the editor takes the AI's result on its
 * own server: the AI sends the result there itself and the page opens it here.
 * @param {PromptState} state - the document and its context.
 * @param {object} remote - the page's AI settings: prompt, endpoint, key, label, base, site, assets.
 * @param {boolean} makeNew - true when the AI makes a new document.
 * @returns {string} the head of the prompt.
 */
function formatRemotePrompt(state, remote, makeNew) {
    const target = makeNew ? 'new' : 'current';
    const out = [];
    if (remote.base) {
        const know = getPromptPart('WHAT THE EDITOR HAS');
        out.push(`You write for my Typst editor ${SITE}, inside the website "${remote.label}".\nWrite the complete document as Typst markup; it must compile with Typst 0.14 without errors. Keep my work unless I ask otherwise.${know ? '\n\n' + know : ''}`);
    }
    if (remote.prompt) out.push(formatSiteText('INSTRUCTIONS', remote.site, remote.label, remote.prompt));
    if (state.context && state.context.rules) out.push(formatSiteText('RULES', remote.site, remote.label, state.context.rules));
    const what = makeNew ? `Make a NEW document; leave "${state.name}" as it is.` : `Change my document "${state.name}".`;
    const link = `${SITE}#b64=<base64url of the UTF-8 Typst code>${makeNew ? '&file=new&name=<short name>' : ''}`;
    const editorAnswer = remote.endpoint && remote.key ? `HOW TO ANSWER
${what} Send the result with one HTTP request (run it, do not only show it):
  POST ${remote.endpoint}
  Authorization: Bearer ${remote.key}
  Content-Type: application/json
  {"editor":"typst","target":"${target}","name":"<short name>","content":"<the complete Typst code>"${remote.assets ? ',"assets":{"<name>":"data:image/png;base64,<data>"}' : ''}}
Build the JSON with a JSON library. The result then opens in my editor; tell me briefly what you did, or the server's error message.
${remote.assets ? AI_PICTURES_YES : AI_PICTURES_NO}
If you cannot send HTTP requests, give me the link ${link} (it carries no pictures) and I paste your answer into the editor.`
        : `HOW TO ANSWER\n${what} Give me the link ${link}; I paste your answer into the editor (a clicked link does not reach it).`;
    const answer = formatAnswerPart(remote, editorAnswer);
    if (answer) out.push(answer);
    return out.join('\n\n');
}

/**
 * Returns the whole prompt: the instructions, the user's documents, the open document with its
 * files and problems, and the start of the request.
 * @param {PromptState} state - the document and its context.
 * @param {boolean} makeNew - true when the AI makes a new document.
 * @returns {string} the prompt, ending with "My request: ".
 */
export function getPrompt(state, makeNew) {
    let intro = state.remote ? formatRemotePrompt(state, state.remote, makeNew) : state.context ? `${PROMPT_BASE}\n\n${formatContextPart(state.context)}` : PROMPT_HEAD;
    if (state.framed && !state.remote) intro += `\n\nMy editor is inside another website, so a clicked link does not reach it: do not open the link yourself - give it to me and I paste your answer.`;
    const others = state.files.filter(name => name !== state.name);
    const list = `Open now: "${state.name}"${others.length ? `. Others: ${others.slice(0, MAX_LISTED_DOCUMENTS).map(name => `"${name}"`).join(', ')}${others.length > MAX_LISTED_DOCUMENTS ? ' …' : ''}` : ''}.`;
    const goal = makeNew
        ? 'Unless I say otherwise in my request, make a NEW document (&file=new&name=<short name>) and leave my documents as they are.'
        : `Unless I say otherwise in my request, change "${state.name}" (&file=${encodeURIComponent(state.name)}).`;
    let head = makeNew ? `MY OPEN DOCUMENT "${state.name}" (for reference only - do not change it)` : `MY CURRENT DOCUMENT "${state.name}"`;
    const pictures = state.pictures && state.pictures.length ? `\nPictures and files in this document: ${state.pictures.join(', ')}` : '';
    const problems = state.problems && state.problems.length ? `\nThe compiler reports: ${state.problems.slice(0, MAX_LISTED_PROBLEMS).join('; ')}` : '';
    if (state.remote) head = `MY ${makeNew ? 'CURRENT' : ''} DOCUMENT "${state.name}"`.replace('  ', ' ');
    return `${intro}\n\n${state.remote ? '' : `${list}\n${goal}\n\n`}${head}${state.sel ? ` (I have selected: "${state.sel.slice(0, MAX_SELECTION_LENGTH)}")` : ''}${pictures}${problems}\n${formatDocumentData('typst', state.code.trim())}\n\nMy request: `;
}
