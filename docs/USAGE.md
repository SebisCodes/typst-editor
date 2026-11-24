# Using the Typst Editor

The Typst Editor runs the real Typst compiler in your browser and shows the compiled pages
next to your code as you type. A click on text on the page jumps to the code or lets you
edit the text right there, and the PDF comes straight from the compiler with real,
selectable text.

Open it at https://typst.giit.ch/. It is free, needs no sign-up, and runs in your browser:
your documents stay there unless you send them somewhere yourself.

## What it can do

- The Typst 0.14 compiler as WebAssembly in a worker, so typing stays smooth; nothing is
  loaded from other servers.
- Everything Typst has: markup, math, tables, figures, references, footnotes, outline,
  bibliography, `#set` and `#show` rules, scripting.
- Problems: the compiler's errors and warnings with line, column and hint; missing files and
  packages are named.
- Document settings that edit the `#set` rules: paper (also square and story formats),
  margins, orientation, columns, font, size, language, line spacing, justified text,
  numbered headings, page numbers, title and author.
- Fonts: Libertinus Serif (default), New Computer Modern, New Computer Modern Math, DejaVu
  Sans Mono, and the fonts you add to a document.
- Templates: article, letter, exercise sheet, social media post.

## Getting started

1. **Start**: choose a template under **New**, open a `.typ` file or paste Typst code.
2. **Write**: type in the code; the pages follow a moment later. **Insert** has ready-made
   pieces for lists, tables, math and symbols.
3. **Export**: save a PDF, pictures of the pages or the `.typ` file with its files.

## Side panel

The side panel holds the document settings, Insert, Pictures and the Outline. The button at the top
right of the work area opens it over the pages, below the bar of the pages, and closes it again
(Escape too); it is closed when the editor opens. The bar's controls (the view switch and the page
buttons) and the zoom bar stay in view and usable while it is open. On a phone it is the view
**Edit**.

## Templates with placeholders

A website that edits templates opens the editor with `?template=mustache` or `?template=angle`.
The pages then show the document filled with the website's examples; **Template** in the bar of the
pages shows the placeholders as written, **Examples** brings the examples back. A placeholder
without an example shows its label in brackets. The **Placeholders** box below the code lists them:
a click puts one at the cursor, a section around the selected text. Text that comes from an example
cannot be edited on the pages. Saving, downloading the `.typ` and the ZIP keep the placeholders;
pictures of the pages show the template view; the PDF and print follow the view shown.

## Editing on the page

Click text on the page to edit it right there: a field opens with the cursor where you
clicked, and the code's cursor goes to the same place. **Enter** starts a new paragraph (in
a list a new item, in a numbered list the next number), **Shift+Enter** inserts a line break
(`\`). **Ctrl+Enter** (Cmd+Enter on macOS) or a click elsewhere applies the edit; **Escape**
cancels. Special characters are escaped when the edit is written into the code. A click on
math, a picture or text made by code jumps to its place in the code instead.

The right side panel has **Document** (paper, font, margins and numbering, by editing the
`#set` rules), **Insert**, **Pictures** (the pictures and files of the document) and
**Outline** (the headings).

## Packages

Packages from Typst Universe (`#import "@preview/…"`) are not downloaded, since nothing is
loaded from other servers. Such an import is reported as a problem that names the package.

## Your documents

Your documents are kept only in your browser (in `localStorage`, their pictures and files in
IndexedDB), not on a server, and stay there after you close the page. **My documents** (the
folder button at the top left) lists every document of this browser: open, rename,
duplicate, download (`.typ`, or a ZIP with its pictures and files) and delete them.

Clearing the browser's site data removes them, so download the ones you want to keep, or let
the editor send them to your own server: **Save to server** (the cloud button) sets up a
webhook, an address that gets every saved version (see [EMBEDDING.md](EMBEDDING.md#webhook)
for what it receives). Nothing is sent until you enter an address there.

**Opening files:** `.typ` files become new documents; a ZIP with a `.typ` file and its files
opens as one document. Pictures and other files dropped or pasted go into the open document.

## Pictures and files

Pictures and files are stored with their document and handed to the compiler as files next
to it: pictures (PNG, JPG, GIF, WebP, SVG, PDF) for `image("name")`, data files (CSV, JSON,
YAML, TOML, XML, TXT, CBOR) for `csv("name")` and the like, `.bib` files for
`bibliography("name")`, other `.typ` files for `#import "name.typ"`, and fonts (`.otf`,
`.ttf`) for `#set text(font: …)`. Add them by drag and drop, by paste or in the **Pictures**
tab; you can also drag a picture on the pages to move it in the code.

## Export

**Export** offers:

- **PDF** from the Typst compiler, with real, selectable text.
- Every page as a **PNG**, **JPG**, **WebP** or **SVG** picture.
- The **`.typ`** file with its files as a ZIP.

**Download .typ** in the bar saves the code; **Ctrl+P** prints the pages.

**Export > Open in another editor** converts the document in the browser to Markdown, LaTeX
or HTML and opens the result as a new document in that editor. Anything the other format
cannot hold is listed first. Pictures do not travel.

## AI Assistant

Any AI can work with you: ChatGPT, Claude, Gemini, Copilot or the AI in your coding tool.
Nothing to install and no key needed. Click **AI Assistant**, then **Copy prompt**, paste it
into your AI and say what it should do. The prompt holds the instructions and the current
document.

The AI answers with a link that carries the document after the `#`; click it and the
document appears in your editor. **Undo** takes every change back. The links look like this:

- `https://typst.giit.ch/#b64=<base64url of the UTF-8 text>`
- `https://typst.giit.ch/#typ=<URL-encoded text>`
- `https://typst.giit.ch/#z=<base64url of the zlib-compressed text>` (shortest)
- `&mode=add` adds text at the end of the open document.
- `&file=new&name=<name>` makes a new document next to your others, `&file=<name>` changes
  that one; without `&file=` the open document changes.
- `&part=N&of=M&id=<name>` sends a long document in several links; the editor collects the
  parts.

A tab opened with such a link hands the document to the editor tab you used last. You can
also paste the AI's whole answer into the editor (Ctrl+V outside the code); links that a
terminal broke over several lines are joined. When the editor is embedded in another
website, links cannot reach it, so paste the answer there. A website that embeds the
editor may give its own instructions for how the AI answers, or show its own AI dialog
when you press the button; the dialog names the website and shows its instructions.

**Browser agents (WebMCP):** in browsers that offer WebMCP, the page registers tools for AI
agents that run in the page itself: `get_document`, `get_problems`, `list_sections`,
`set_document`, `insert_text`, `replace_text`, `show_line`, `undo`, and `list_files`,
`open_file`, `new_file` for your other documents. Every change is one step for Undo.

## Languages

The editor speaks English at `/`, German `/de/`, French `/fr/`, Italian `/it/`, Spanish
`/es/`, Portuguese `/pt/`, Dutch `/nl/`, Polish `/pl/`, Turkish `/tr/`, Russian `/ru/`,
Ukrainian `/uk/`, Chinese `/zh/`, Japanese `/ja/` and Korean `/ko/`. Opening
`https://typst.giit.ch/` leads to the language you picked before in a language menu, or else
to your browser's language. A language picked in the menu holds for every giit.ch site. The
prompt for the AI is always in English.

## Color theme

Light, dark or automatic (following your system): the theme switch in the bar sets it, and
the editor remembers your choice.

## Keyboard shortcuts

On macOS use Cmd instead of Ctrl. The **Help** dialog in the editor lists them as well.

| Keys | Action |
|---|---|
| Ctrl + B / I / U | Bold / italic / underline the selected text |
| Ctrl + M | Math: `$…$` around the selection |
| Ctrl + / | Comment lines in or out (`//`) |
| Ctrl + Enter | Show the cursor's place on the pages |
| Tab / Shift + Tab | Indent / outdent |
| Ctrl + Z / Y | Undo / redo |
| Ctrl + S | Save (download `.typ`, or to your server) |
| Ctrl + E | Export |
| Ctrl + O | My documents |
| Ctrl + P | Print the pages |
| Ctrl + mouse wheel, Ctrl + + / - | Zoom the preview |
| Page Up / Page Down | Previous / next page (in the preview) |

Enter in a list continues it (`-`, `+`, `1.`); Enter on an empty item ends it. Brackets,
`$`, `*` and `_` go around a selection.

## On your own website

The editor can be embedded in other websites with an iframe, opened in a window of its own
or used as a read-only viewer. See [EMBEDDING.md](EMBEDDING.md).
