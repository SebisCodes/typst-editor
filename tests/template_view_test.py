"""Template placeholders in the browser: the example view and the template view of the pages, through
the real postMessage path of a page around the editor.

    php -S 127.0.0.1:8105 -t src src/php/router.php          (in the project folder)
    python3 tests/template_view_test.py

A page on its own port embeds the editor with ?embed=1&template=mustache and loads an order letter
with `template` (placeholders, examples, one example picture):
  - the example view is the default: no tag on the pages, examples, sections and list rows applied,
    the label in brackets for a placeholder without an example, the example picture compiled;
  - the switch (two buttons of one width, the focus kept) shows the template view: the tags as their
    text, the pages compiled;
  - a click on copied text opens it for editing at its place in the code; text with an example in
    it stays read-only and leads to its place in the code;
  - "get" and "change" carry the template as written, "pdf" answers in the view shown, the print
    title names the view; the pictures of the pages are made of the template view in both views,
    and the Export dialog names it for them;
  - a run of copied text whose words also stand in a filled string stays read-only; other copied
    text stays editable;
  - the "Placeholders" box is closed at the start, opens over the code without moving it, and puts a
    section around the selection as one undo step;
  - the side panel is a drawer, closed at the start, below the bar of the pages, its button in its
    place; up to 860 px it is the view "Edit";
  - "typsteditor:template" from a window other than the page is ignored, a later message replaces
    the list, clear ends it;
  - nothing at an address that holds a placeholder is requested; without ?template= none of the
    controls is there.
Needs Playwright for Python and Google Chrome.
"""
import base64
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright

EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8105/')
HOST_PORT = int(os.environ.get('HOST_PORT', '8196'))
PREFIX = 'typsteditor'
CODE = """#set page(width: 14cm, height: auto, margin: 1cm)
= Order {{orderNumber}}
Dear {{name}}, thank you.

#image("{{logo}}", width: 2cm)
#link("https://x.invalid/go/{{id}}")[Track]

{{#items}}
- {{label}}: {{quantity}}
{{/items}}
{{#hasNote}}Note: {{note}}{{/hasNote}}{{^hasNote}}No note.{{/hasNote}}

Ship to {{street}} in {{city}}.

Plain words here.
"""
DRAWER_WIDTHS = [1440, 1280, 1100, 900]
NARROW_WIDTHS = [860, 390, 320]
BAR_CONTROLS = ['#view-switch', '.pages-group', '#btn-panel']
READ_BAR = """selectors => {
    const getBox = element => { const box = element.getBoundingClientRect(); return [box.x, box.y, box.width, box.height].map(Math.round); };
    const isFree = element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return box.width > 0 && Boolean(hit) && element.contains(hit); };
    const controls = selectors.map(selector => document.querySelector(selector));
    return {
        boxes: controls.map(getBox),
        free: controls.map(control => [control, ...control.querySelectorAll('button')].every(isFree)),
        bar: getBox(document.querySelector('.draw-pane > .pane-header')),
        stage: getBox(document.querySelector('#stage')),
        panel: getBox(document.querySelector('#side-panel')),
        lang: document.documentElement.lang,
    };
}"""
PAGE_TEXT = "() => [...document.querySelectorAll('#pages .tsel')].map(e => e.textContent).join(' ').replace(/\\s+/g, ' ')"
failed = []


def check_that(ok, text):
    """Prints one result line and notes a failure.

    Args:
        ok (bool): True when the check holds.
        text (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if ok else 'FAIL  ') + text, flush=True)
    if not ok:
        failed.append(text)


def build_png_address():
    """Returns a red 4 x 3 PNG as a data address.

    Returns:
        str: the data address.
    """
    def build_chunk(kind, data):
        """Returns one PNG chunk.

        Args:
            kind (bytes): the chunk type.
            data (bytes): its data.

        Returns:
            bytes: the chunk with length and checksum.
        """
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\x00' + b'\xff\x00\x00' * 4 for _ in range(3))
    png = b'\x89PNG\r\n\x1a\n' + build_chunk(b'IHDR', struct.pack('>IIBBBBB', 4, 3, 8, 2, 0, 0, 0)) + build_chunk(b'IDAT', zlib.compress(rows)) + build_chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(png).decode()


PICTURE = build_png_address()
TEMPLATE = {
    'placeholders': [
        {'name': 'name', 'kind': 'value', 'label': 'Name', 'example': 'John Doe'},
        {'name': 'orderNumber', 'kind': 'value', 'label': 'Order number', 'example': 'A-17'},
        {'name': 'id', 'kind': 'value', 'label': 'Id', 'example': '42'},
        {'name': 'city', 'kind': 'value', 'label': 'City', 'example': 'Springfield & Co_ $5'},
        {'name': 'logo', 'kind': 'image', 'label': 'Logo', 'image': 'logo.png'},
        {'name': 'hasNote', 'kind': 'section', 'label': 'With a note', 'shown': False},
        {'name': 'items', 'kind': 'list', 'label': 'Items', 'fields': [{'name': 'label', 'label': 'Item'}, {'name': 'quantity', 'label': 'Quantity'}],
         'rows': [{'label': 'Chair', 'quantity': '2'}, {'label': 'Table', 'quantity': '1'}]},
    ],
    'assets': {'logo.png': PICTURE},
}
HOST = """<!doctype html><meta charset="utf-8"><title>host</title>
<iframe id="f" src="EDITOR?embed=1QUERY" style="width:1300px;height:820px;border:0"></iframe>
<iframe id="other" srcdoc="<p>other</p>" style="width:10px;height:10px"></iframe>
<script>
window.log = [];
const frame = document.getElementById('f');
const target = new URL(frame.src).origin;
window.sendToEditor = message => frame.contentWindow.postMessage(message, target);
addEventListener('message', event => {
  if (event.source !== frame.contentWindow) return;
  log.push(event.data);
  if (event.data.type === 'PREFIX:ready') sendToEditor({ type: 'PREFIX:load', name: 'Letter', content: CODE, template: TEMPLATE });
});
</script>"""


def wait_for_pages(page, frame):
    """Waits until the pages show the code and the view chosen.

    Args:
        page (Page): the host page.
        frame (Frame): the editor's frame.

    Returns:
        None: the pages are compiled.
    """
    page.wait_for_timeout(400)
    frame.evaluate('() => window.typstEditor.compiled()')
    page.wait_for_timeout(500)


def check_views(page, frame):
    """Checks the example view and the template view.

    Args:
        page (Page): the host page.
        frame (Frame): the editor's frame.

    Returns:
        None: the results are printed.
    """
    text = frame.evaluate(PAGE_TEXT)
    check_that('{{' not in text and 'John Doe' in text and 'A-17' in text, f'the example view is the default, no tag shown ({text[:80]!r})')
    check_that('Chair' in text and 'Table' in text and 'No note.' in text and 'Note:' not in text, 'list rows and sections by example state')
    check_that('[street]' in text, 'a placeholder without an example shows its name in brackets')
    check_that('Springfield & Co_ $5' in text, 'special characters of an example show as text')
    images = frame.evaluate("() => [...document.querySelectorAll('#pages image')].map(i => (i.getAttribute('href') || i.getAttribute('xlink:href') || '').slice(0, 30))")
    check_that(len(images) == 1 and images[0].startswith('data:image/png'), f'the example picture is on the page {images}')
    check_that(frame.evaluate('() => window.typstEditor.state.problems.length') == 0, 'no problem in the example view')
    switch = frame.locator('#view-switch')
    widths = frame.evaluate("() => [...document.querySelectorAll('#view-switch [data-view-set]')].map(b => b.getBoundingClientRect().width)")
    box_before = switch.bounding_box()
    frame.locator('[data-view-set="template"]').click()
    wait_for_pages(page, frame)
    text = frame.evaluate(PAGE_TEXT)
    check_that('{{name}}' in text and '{{#hasNote}}' in text and 'John Doe' not in text, f'the template view shows the tags as their text ({text[:80]!r})')
    check_that(frame.evaluate("() => !document.querySelector('#stage').classList.contains('stale') && window.typstEditor.state.pages.length > 0"), 'the template view compiles')
    check_that(len(set(round(width) for width in widths)) == 1 and switch.bounding_box() == box_before, f'the switch keeps one width and its place {widths}')
    state = frame.evaluate("() => [document.activeElement.dataset.viewSet, document.querySelector('[data-view-set=template]').getAttribute('aria-checked')]")
    check_that(state == ['template', 'true'], f'the focus stays on the switch, its state is announced {state}')
    frame.locator('[data-view-set="example"]').click()
    wait_for_pages(page, frame)


def click_run(page, frame, words):
    """Clicks the middle of the text run of the pages that holds some words.

    Args:
        page (Page): the host page.
        frame (Frame): the editor's frame.
        words (str): the words.

    Returns:
        None: the click is done.
    """
    box = frame.evaluate("""words => { const run = [...document.querySelectorAll('#pages .typst-text')].find(r => (r.querySelector('.tsel') || r).textContent.includes(words));
        const rect = run.getBoundingClientRect(); return [rect.x + rect.width / 2, rect.y + rect.height / 2]; }""", words)
    frame_box = page.locator('#f').bounding_box()
    page.mouse.click(frame_box['x'] + box[0], frame_box['y'] + box[1])
    page.wait_for_timeout(400)


def check_map(page, frame):
    """Checks that a click on the pages leads to the code and that filled text stays read-only.

    Args:
        page (Page): the host page.
        frame (Frame): the editor's frame.

    Returns:
        None: the results are printed.
    """
    click_run(page, frame, 'Plain words here')
    editing = frame.evaluate("() => !!document.querySelector('.text-in-place')")
    place = frame.evaluate("() => document.querySelector('#code').selectionStart")
    check_that(editing and CODE.index('Plain words here') <= place <= CODE.index('Plain words here') + 16, f'copied text is edited on the page at its place in the code ({place})')
    frame.evaluate("() => { const field = document.querySelector('.text-in-place'); if (field) field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }")
    page.wait_for_timeout(300)
    click_run(page, frame, 'John Doe')
    editing = frame.evaluate("() => !!document.querySelector('.text-in-place')")
    place = frame.evaluate("() => document.querySelector('#code').selectionStart")
    line = CODE.index('Dear {{name}}')
    check_that(not editing and line <= place <= line + len('Dear {{name}}, thank you.'), f'text with an example is read-only and leads to its line in the code ({place})')


def check_exports(page, frame):
    """Checks that get and change carry the template, pdf answers, and the print title names the view.

    Args:
        page (Page): the host page.
        frame (Frame): the editor's frame.

    Returns:
        None: the results are printed.
    """
    page.evaluate(f"() => sendToEditor({{ type: '{PREFIX}:get' }})")
    page.wait_for_timeout(500)
    saves = page.evaluate(f"() => log.filter(m => m.type === '{PREFIX}:save')")
    check_that(saves and saves[-1]['content'] == CODE, '"get" answers with the template as written')
    page.evaluate(f"() => sendToEditor({{ type: '{PREFIX}:pdf' }})")
    page.wait_for_timeout(4000)
    pdf = page.evaluate(f"() => log.filter(m => m.type === '{PREFIX}:pdf').pop()")
    check_that(bool(pdf and pdf.get('pdf')), f'"pdf" answers in the view shown ({(pdf or {}).get("error")})')
    frame.evaluate("""() => { window.printTitles = []; window.print = () => printTitles.push('print:' + document.title); }""")
    frame.evaluate('() => window.typstEditor.print()')
    page.wait_for_timeout(600)
    titles = frame.evaluate('() => printTitles')
    check_that(any('Letter (example view)' in title for title in titles), f'the print title names the example view {titles}')
    frame.locator('#code').click()
    frame.locator('#code').press('Control+End')
    frame.locator('#code').type(' ')
    page.wait_for_timeout(1500)
    changes = page.evaluate(f"() => log.filter(m => m.type === '{PREFIX}:change')")
    check_that(changes and '{{name}}' in changes[-1]['content'] and 'John Doe' not in changes[-1]['content'], '"change" carries the template')


def check_pictures(page, frame):
    """Checks that the pictures of the pages show the template view while the pages show the example view.

    Args:
        page (Page): the host page.
        frame (Frame): the editor's frame.

    Returns:
        None: the results are printed.
    """
    shown = frame.evaluate('() => window.typstEditor.state.pages.map((p, i) => window.typstEditor.pageSvg(i))')
    pictures = frame.evaluate('() => window.typstEditor.pictureSvgs()')
    frame.locator('#btn-export').click()
    frame.select_option('#ex-format', 'svg')
    page.wait_for_timeout(1500)
    label = frame.evaluate("() => document.querySelector('#ex-size').textContent")
    frame.evaluate("() => document.querySelector('#export').close()")
    frame.locator('[data-view-set="template"]').click()
    wait_for_pages(page, frame)
    template = frame.evaluate('() => window.typstEditor.state.pages.map((p, i) => window.typstEditor.pageSvg(i))')
    again = frame.evaluate('() => window.typstEditor.pictureSvgs()')
    frame.locator('[data-view-set="example"]').click()
    wait_for_pages(page, frame)
    check_that(pictures != shown and pictures == template, f'in the example view the pictures of the pages are the template view ({len(pictures)} of {len(template)})')
    check_that(again == template, 'in the template view the pictures of the pages are the pages shown')
    check_that('template view' in label, f'the Export dialog names the template view for the pictures ({label!r})')


def check_provenance(page, frame):
    """Checks that copied text that reads like a filled string stays read-only on the pages.

    Args:
        page (Page): the host page.
        frame (Frame): the editor's frame.

    Returns:
        None: the results are printed.
    """
    code = '#set page(width: 14cm, height: auto, margin: 1cm)\n#let who = "{{name}}"\n#who\n\nJohn Doe\n\nOther words here.\n'
    page.evaluate("([code, template]) => sendToEditor({ type: 'PREFIX:load', name: 'Lookalike', content: code, template })".replace('PREFIX', PREFIX), [code, TEMPLATE])
    page.wait_for_timeout(1500)
    wait_for_pages(page, frame)
    runs = frame.evaluate("() => window.typstEditor.state.runs.map(run => [run.core, run.editable])")
    lookalikes = [editable for core, editable in runs if core == 'John Doe']
    check_that(len(lookalikes) == 2 and not any(lookalikes), f'copied words that also stand in a filled string stay read-only {runs}')
    check_that(['Other words here.', True] in runs, 'other copied text stays editable')


def check_box(page, frame):
    """Checks the "Placeholders" box: closed at the start, opens without moving the code, inserts as one undo step.

    Args:
        page (Page): the host page.
        frame (Frame): the editor's frame.

    Returns:
        None: the results are printed.
    """
    check_that(frame.evaluate("() => document.querySelector('[data-placeholder-list]').hidden"), 'the box is closed at the start')
    code_box = frame.locator('#code').bounding_box()
    header_box = frame.locator('[data-placeholder-toggle]').bounding_box()
    frame.locator('[data-placeholder-toggle]').click()
    page.wait_for_timeout(200)
    check_that(frame.locator('#code').bounding_box() == code_box and frame.locator('[data-placeholder-toggle]').bounding_box() == header_box, 'the box opens over the code without moving it')
    entries = frame.evaluate("() => [...document.querySelectorAll('.placeholder-entry')].map(e => [e.querySelector('.placeholder-label').textContent, e.querySelector('.placeholder-tag').textContent, e.getBoundingClientRect().height])")
    check_that(entries and entries[0][:2] == ['Name', '{{name}}'] and len({round(entry[2]) for entry in entries}) == 1, f'label, tag and example, one height {entries[:2]}')
    before = frame.evaluate('() => document.querySelector("#code").value')
    word_start = before.index('Plain words')
    frame.evaluate(f"() => {{ const t = document.querySelector('#code'); t.focus(); t.setSelectionRange({word_start}, {word_start + 5}); }}")
    frame.locator('.placeholder-entry', has_text='{{#items}}').click()
    page.wait_for_timeout(400)
    after = frame.evaluate('() => document.querySelector("#code").value')
    selection = frame.evaluate("() => { const t = document.querySelector('#code'); return t.value.slice(t.selectionStart, t.selectionEnd); }")
    check_that('{{#items}}Plain{{/items}} words' in after and selection == 'Plain', 'a section goes around the selection, which stays selected')
    frame.evaluate('() => window.typstEditor.undo()')
    page.wait_for_timeout(300)
    check_that(frame.evaluate('() => document.querySelector("#code").value') == before, 'one undo step takes it back')
    frame.locator('[data-placeholder-toggle]').click()


def check_panel(frame):
    """Checks that the side panel is closed at the start and its button keeps its place.

    Args:
        frame (Frame): the editor's frame.

    Returns:
        None: the results are printed.
    """
    shown = frame.evaluate("() => getComputedStyle(document.querySelector('#side-panel')).display")
    button = frame.locator('#btn-panel')
    place = button.bounding_box()
    preview_box = frame.locator('.draw-pane').bounding_box()
    button.click()
    opened = frame.evaluate("() => getComputedStyle(document.querySelector('#side-panel')).display")
    check_that(shown == 'none' and opened != 'none', f'the side panel is closed at the start and opens ({shown} -> {opened})')
    check_that(button.bounding_box() == place and frame.locator('.draw-pane').bounding_box() == preview_box, 'the panel opens over the pages, its button stays in its place')
    button.click()


def check_messages(page, frame):
    """Checks the template messages: another window ignored, a later list replaces, clear ends it.

    Args:
        page (Page): the host page.
        frame (Frame): the editor's frame.

    Returns:
        None: the results are printed.
    """
    other = {'type': f'{PREFIX}:template', 'placeholders': [{'name': 'name', 'kind': 'value', 'example': 'Mallory'}]}
    page.evaluate("message => document.getElementById('other').contentWindow.eval(`parent.frames[0].postMessage(${JSON.stringify(message)}, '*')`)", other)
    wait_for_pages(page, frame)
    check_that('Mallory' not in frame.evaluate(PAGE_TEXT), 'a template message from another window is ignored')
    page.evaluate('message => sendToEditor(message)', {'type': f'{PREFIX}:template', 'placeholders': [{'name': 'name', 'kind': 'value', 'label': 'Name', 'example': 'Jane Roe'}]})
    wait_for_pages(page, frame)
    text = frame.evaluate(PAGE_TEXT)
    check_that('Jane Roe' in text and 'A-17' not in text and '[orderNumber]' in text, f'a later message replaces the list ({text[:60]!r})')
    page.evaluate('message => sendToEditor(message)', {'type': f'{PREFIX}:template', 'clear': True})
    wait_for_pages(page, frame)
    text = frame.evaluate(PAGE_TEXT)
    check_that('Jane Roe' not in text and '[name]' in text, 'clear ends the examples; the tags of the document stay as their names in brackets')


def check_drawer_layout(browser):
    """Checks the drawer at desktop widths in English and German, and the view "Edit" on narrow screens.

    Args:
        browser (Browser): the browser.

    Returns:
        None: the results are printed.
    """
    for lang in ('en', 'de'):
        for width in DRAWER_WIDTHS + NARROW_WIDTHS:
            context = browser.new_context(viewport={'width': width, 'height': 900})
            page = context.new_page()
            page.goto(f'{EDITOR}?template=mustache&lang={lang}')
            page.wait_for_timeout(1500)
            label = f'{lang} {width} px'
            if width in NARROW_WIDTHS:
                preview = page.evaluate(READ_BAR, BAR_CONTROLS[:-1])
                check_that(not page.locator('#btn-panel').is_visible() and preview['free'][0], f'{label}: no drawer button, the view switch in the bar of the pages')
                page.locator('[data-pane="properties"]').click()
                page.wait_for_timeout(300)
                panel = page.evaluate("() => { const style = getComputedStyle(document.querySelector('#side-panel')); return [style.display, style.position]; }")
                check_that(panel[0] == 'flex' and panel[1] != 'absolute', f'{label}: the side panel is the view "Edit" in the flow of the page {panel}')
                context.close()
                continue
            closed = page.evaluate(READ_BAR, BAR_CONTROLS)
            page.locator('#btn-panel').click()
            page.wait_for_timeout(300)
            opened = page.evaluate(READ_BAR, BAR_CONTROLS)
            check_that(closed['lang'] == lang, f'{label}: the interface is in {lang}')
            check_that(all(opened['free']), f'{label}: every control of the bar stays uncovered while the drawer is open {dict(zip(BAR_CONTROLS, opened["free"]))}')
            check_that(opened['boxes'] == closed['boxes'] and opened['bar'] == closed['bar'] and opened['stage'] == closed['stage'], f'{label}: opening the drawer moves nothing')
            check_that(abs(opened['panel'][1] - (opened['bar'][1] + opened['bar'][3])) <= 1, f'{label}: the drawer starts below the bar {opened["panel"]} {opened["bar"]}')
            zoom_free = page.evaluate("() => { const zoom = document.querySelector('.stage .zoom').getBoundingClientRect(); const hit = document.elementFromPoint(zoom.x + zoom.width - 4, zoom.y + zoom.height / 2); return Boolean(hit && hit.closest('.zoom')); }")
            check_that(zoom_free, f'{label}: the zoom bar stays uncovered')
            page.locator('#btn-panel').click()
            page.wait_for_timeout(300)
            check_that(page.evaluate(READ_BAR, BAR_CONTROLS)['boxes'] == closed['boxes'], f'{label}: closing the drawer moves nothing')
            context.close()


def run_checks(browser, folder):
    """Runs the checks with the option and without it.

    Args:
        browser (Browser): the browser.
        folder (str): the folder the host pages are written to.

    Returns:
        None: the results are printed.
    """
    for query, name in (('&template=mustache', 'typst.html'), ('', 'typst-off.html')):
        html = HOST.replace('EDITOR', EDITOR).replace('QUERY', query).replace('PREFIX', PREFIX)
        html = html.replace('CODE', json.dumps(CODE).replace('</', '<\\/')).replace('TEMPLATE', json.dumps(TEMPLATE))
        Path(folder, name).write_text(html, encoding='utf-8')
    context = browser.new_context(viewport={'width': 1400, 'height': 900})
    requests = []
    context.on('request', lambda request: requests.append(request.url))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'http://127.0.0.1:{HOST_PORT}/typst.html')
    page.wait_for_timeout(5000)
    frame = page.frames[1]
    wait_for_pages(page, frame)
    check_views(page, frame)
    check_map(page, frame)
    check_box(page, frame)
    check_panel(frame)
    check_exports(page, frame)
    check_pictures(page, frame)
    check_messages(page, frame)
    check_provenance(page, frame)
    check_that(errors == [], f'no script errors {errors}')
    check_that([url for url in requests if 'x.invalid' in url] == [], 'no address that held a placeholder is requested')
    page.goto(f'http://127.0.0.1:{HOST_PORT}/typst-off.html')
    page.wait_for_timeout(4000)
    frame = page.frames[1]
    visible = frame.evaluate("() => ['#view-switch', '#placeholder-box', '#view-note'].map(s => getComputedStyle(document.querySelector(s)).display)")
    check_that(visible == ['none', 'none', 'none'], f'option off: no switch, no box, no note {visible}')
    check_that(frame.evaluate('() => window.typstEditor.state.viewMap') is None, 'option off: the compiler reads the code as written')
    context.close()


def main():
    """Runs the checks.

    Returns:
        None: the process ends with 1 when a check failed.
    """
    with tempfile.TemporaryDirectory() as folder:
        server = subprocess.Popen([sys.executable, '-m', 'http.server', str(HOST_PORT), '--bind', '127.0.0.1', '-d', folder], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.8)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), headless=True)
                run_checks(browser, folder)
                check_drawer_layout(browser)
                browser.close()
        finally:
            server.terminate()
    print(f'\n{len(failed)} failed' if failed else '\nall passed')
    sys.exit(1 if failed else 0)


main()
