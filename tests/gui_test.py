"""Browser test of the Typst editor (Playwright, Google Chrome).

    php -S 127.0.0.1:8105 -t src src/php/router.php          (in the project folder)
    python tests/gui_test.py

Checks the compiler (pages, problems), code <-> pages, editing text on the
page, typing help, document settings, insert, My documents, pictures and
files, AI links, export and the phone layout."""

import base64
import os
import sys
import time
import zlib

from playwright.sync_api import sync_playwright

URL = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8105/')
HERE = os.path.dirname(os.path.abspath(__file__))
failures = []


def check_that(cond, what):
    """Prints one result line and notes a failure.

    Args:
        cond (bool): True when the check holds.
        what (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if cond else 'FAIL  ') + what)
    if not cond:
        failures.append(what)

def wait_until(target, expr, timeout=30):
    """Waits until an expression is true in the editor page or frame (its CSP does not let
    Playwright's own polling run).

    Args:
        target (Page | Frame): where the expression runs.
        expr (str): a JavaScript expression.
        timeout (float): the longest wait in seconds.

    Returns:
        bool: True once the expression is true.

    Raises:
        TimeoutError: when it is not true within the time.
    """
    end = time.time() + timeout
    while time.time() < end:
        try:
            if target.evaluate('() => !!(' + expr + ')'):
                return True
        except Exception:
            pass
        time.sleep(0.1)
    raise TimeoutError('waited in vain for ' + expr)


def read_file(name):
    """Returns the text of a file next to this test.

    Args:
        name (str): the file name in the tests folder.

    Returns:
        str: the file's text.
    """
    with open(os.path.join(HERE, name), encoding='utf-8') as f:
        return f.read()


def set_code(page, typ):
    """Sets the editor's code and waits for the compiler.

    Args:
        page (Page): the editor page.
        typ (str): the Typst code.

    Returns:
        None: the editor holds the code, compiled.
    """
    page.evaluate('t => typstEditor.setCode(t)', typ)
    page.evaluate('typstEditor.compiled()')
    page.wait_for_timeout(150)


def get_state(page, expr):
    """Returns a value of the editor state.

    Args:
        page (Page): the editor page.
        expr (str): a JavaScript expression over S, the editor state.

    Returns:
        Any: the value of the expression.
    """
    return page.evaluate(f'() => {{ const S = typstEditor.state; return {expr}; }}')


def get_run(page, text):
    """Returns the text run on the page with this text.

    Args:
        page (Page): the editor page.
        text (str): the run's text.

    Returns:
        Locator: the run's .typst-text group.
    """
    return page.locator('#pages .typst-text').filter(has=page.locator('.tsel', has_text=text))


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL + '?lang=en', wait_until='networkidle')
    wait_until(page, 'typstEditor.state.pages.length > 0')
    page.wait_for_timeout(300)

    # --- First visit: the welcome example, compiled by Typst ---
    check_that(get_state(page, 'S.name') == 'Welcome', 'the first visit opens the welcome example')
    check_that(get_state(page, 'S.pages.length') == 1, 'the example fills one page')
    check_that(get_state(page, 'S.problems.length') == 0, 'the example has no problems')
    check_that(page.locator('#pages .sheet svg.typst-page').count() == 1 and page.locator('#pages .typst-text').count() > 30, 'the page is an SVG from the Typst renderer with text runs')
    check_that(page.locator('#pages script').count() == 0 and page.evaluate('[...document.querySelectorAll("#pages *")].some(e => [...e.attributes].some(a => /^on/i.test(a.name)))') is False, 'no scripts or event attributes on the pages')
    check_that(get_state(page, 'S.outline.map(o => o.title).join("|")') == 'What it can do|Pictures and files', 'the outline lists the headings')

    # --- A longer document: several pages, outline, references ---
    set_code(page, read_file('report.typ'))
    check_that(get_state(page, 'S.pages.length') >= 3, f'report: several pages ({get_state(page, "S.pages.length")})')
    check_that(get_state(page, 'S.problems.length') == 0, 'report: no problems')
    check_that(get_run(page, 'Contents').count() >= 1, 'report: #outline() makes a table of contents')
    page.click('#page-next')
    page.wait_for_timeout(200)
    check_that(page.inner_text('#page-label').startswith('2 /'), 'next page goes to page 2')

    # --- Problems from the compiler ---
    set_code(page, '= Title\nSome text.\n#let x = (\n#image("missing.png")\n')
    probs = get_state(page, 'S.problems.map(p => [p.kind, p.line, p.col, p.msg])')
    check_that(any(p[0] == 'error' and p[1] == 3 and p[2] == 10 and 'unclosed' in p[3] for p in probs), 'an unclosed bracket is an error with line and column: ' + repr(probs[:2]))
    check_that(page.locator('#code-error li').count() >= 1 and 'Line 3, column 10' in page.inner_text('#code-error'), 'problems are listed above the code with line and column')
    check_that(get_state(page, 'S.pages.length') >= 1 and page.evaluate('document.getElementById("stage").classList.contains("stale")'), 'the last good pages stay, marked as outdated')
    page.locator('#code-error [data-prob]').first.click()
    check_that(page.evaluate('document.activeElement.id') == 'code' and page.evaluate('() => { const t = document.getElementById("code"); return t.value.slice(t.selectionStart, t.selectionStart + 1); }') == '(', 'clicking a problem goes to its place in the code')
    set_code(page, '#image("missing.png")\n')
    check_that(any('file not found: missing.png' in p for p in get_state(page, 'S.problems.map(p => p.msg)')), 'a missing file is named')
    set_code(page, '#import "@preview/cetz:0.3.0": canvas\nText\n')
    probs = get_state(page, 'S.problems.map(p => p.msg + " / " + p.hints.join(";"))')
    check_that(any('not downloaded: @preview/cetz:0.3.0' in p for p in probs), 'a package from Typst Universe is named, not downloaded: ' + repr(probs))
    check_that('Hint:' in page.inner_text('#code-error'), 'the hint is shown with the problem')

    # --- Editing text on the page ---
    set_code(page, "= Intro\nThe quick brown\nfox jumps. It's *bold* here.\n")
    r = get_run(page, 'quick')
    check_that(r.count() == 1 and r.locator('.tsel').inner_text() == 'The quick brown fox jumps. It’s ', 'plain text over a line break is one run on the page')
    check_that(get_state(page, 'S.runs.filter(r => r.editable).length') >= 3, 'the runs are found in the code')
    box = r.bounding_box()
    page.mouse.click(box['x'] + box['width'] * 0.3, box['y'] + box['height'] / 2)
    page.wait_for_timeout(200)
    field = page.locator('.text-in-place')
    check_that(field.count() == 1 and field.input_value() == 'The quick brown fox jumps. It’s', 'a click opens a field over the text')
    left = page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(Math.max(0, t.selectionStart - 30), t.selectionStart).split("\\n").pop(); }')
    check_that(len(left) > 2 and 'The quick brown'.startswith(left), 'the code cursor goes to the clicked character: ' + repr(left))
    page.keyboard.type('X')
    page.keyboard.press('End')
    page.keyboard.type(' 50$ #1')
    page.keyboard.press('Control+Enter')
    page.evaluate('typstEditor.compiled()')
    page.wait_for_timeout(200)
    code = get_state(page, 'S.code')
    check_that(left + 'X' in code, 'typing goes where the click was')
    check_that("fox jumps. It's 50\\$ \\#1 *bold*" in code, 'Ctrl+Enter writes the text into the code, special characters escaped: ' + repr(code))
    check_that(get_run(page, '50$ #1').count() == 1, 'the page shows the edited text')
    get_run(page, 'Intro').click()
    page.wait_for_timeout(150)
    page.keyboard.press('Control+a')
    page.keyboard.type('Changed')
    page.keyboard.press('Escape')
    page.wait_for_timeout(200)
    check_that('= Intro' in get_state(page, 'S.code') and field.count() == 0, 'Escape cancels the edit')
    get_run(page, 'Intro').click()
    page.wait_for_timeout(150)
    page.keyboard.press('Control+a')
    page.keyboard.type('Start')
    page.mouse.click(5, 300)
    page.evaluate('typstEditor.compiled()')
    page.wait_for_timeout(200)
    check_that('= Start' in get_state(page, 'S.code'), 'a click elsewhere keeps the edit (headings too)')
    page.evaluate('() => document.querySelector("#code").blur()')
    page.keyboard.press('Control+z')
    page.wait_for_timeout(300)
    check_that('= Intro' in get_state(page, 'S.code'), 'Undo takes the edit on the page back')

    # --- Code <-> pages ---
    set_code(page, '= Alpha\nFirst paragraph.\n\n= Beta\n$x^2 + y^2$ after math.\n')
    page.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(t.value.indexOf("First"), t.value.indexOf("First")); t.dispatchEvent(new Event("click")); }')
    page.wait_for_timeout(150)
    check_that(page.locator('#pages .source').count() == 1, 'the cursor place is framed on the page')
    get_run(page, '𝑥').first.click()
    page.wait_for_timeout(150)
    caret = page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionStart + 4); }')
    check_that(caret == '$x^2', 'a click on math jumps to the formula in the code: ' + repr(caret))

    # --- Typing help ---
    page.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }')
    page.keyboard.type('- one')
    page.keyboard.press('Enter')
    page.keyboard.type('two')
    page.wait_for_timeout(300)
    check_that('- one\n- two' in get_state(page, 'S.code'), 'Enter in a list starts the next item')
    page.keyboard.press('Shift+Home')
    page.keyboard.press('Control+b')
    check_that('- *two*' in get_state(page, 'S.code') or '*- two*' in get_state(page, 'S.code'), 'Ctrl+B makes the selection bold')

    # --- Document settings edit the #set rules ---
    set_code(page, '= Settings\nText.\n')
    page.select_option('#d-paper', 'sq')
    page.select_option('#d-font', '"New Computer Modern"')
    page.select_option('#d-lang', 'de-ch')
    page.check('#d-nums')
    page.evaluate('typstEditor.compiled()')
    code = get_state(page, 'S.code')
    check_that('#set page(width: 120mm, height: 120mm, margin: 8mm, numbering: "1")' in code, 'paper: square size and page numbers in #set page: ' + repr(code.split('\n')[0]))
    check_that('#set text(font: "New Computer Modern", lang: "de", region: "ch")' in code, 'font and language in #set text')
    w, h = get_state(page, '[S.sizes[0].w, S.sizes[0].h]')
    check_that(abs(w - h) < 0.5 and abs(w - 120 * 72 / 25.4) < 0.5, 'the compiled page is square')
    page.fill('#d-title', 'A new "title"')
    page.wait_for_timeout(500)
    check_that('#set document(title: "A new \\"title\\"")' in get_state(page, 'S.code'), 'the title field edits #set document')
    page.select_option('#d-paper', 'a5')
    check_that('paper: "a5"' in get_state(page, 'S.code') and 'width:' not in get_state(page, 'S.code'), 'paper A5 replaces the size')

    # --- Insert ---
    page.click('[data-itab=insert]')
    page.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }')
    page.click('[data-ins=table]')
    check_that('table.header[*Left*]' in get_state(page, 'S.code'), 'Insert > Table')
    page.click('[data-sym="alpha"]')
    check_that('$alpha$' in get_state(page, 'S.code'), 'a Greek letter outside math goes into $…$')
    page.evaluate('typstEditor.compiled()')
    check_that(get_state(page, 'S.problems.filter(p => p.kind === "error").length') == 0, 'the inserted pieces compile')
    page.click('[data-itab=properties]')

    # --- My documents, templates ---
    for kind in ['article', 'letter', 'exercise', 'social']:
        page.click('#btn-new')
        page.click(f'[data-new={kind}]')
        page.evaluate('typstEditor.compiled()')
        check_that(get_state(page, 'S.problems.filter(p => p.kind === "error").length') == 0 and get_state(page, 'S.pages.length') >= 1, f'template "{kind}" compiles without errors')
    check_that(get_state(page, 'S.name') == 'Social media post', 'New > Social media post')
    page.click('#btn-files')
    check_that(page.locator('#files-grid .file-card').count() >= 5, 'My documents lists the documents')
    page.locator('#files-grid .file-card', has_text='Welcome').locator('.file-open').click()
    check_that(get_state(page, 'S.name') == 'Welcome', 'a document opens from My documents')

    # --- Pictures ---
    set_code(page, '= Picture\nBelow.\n')
    page.evaluate('() => { const t = document.querySelector("#code"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }')
    page.set_input_files('#file', os.path.join(HERE, 'title-picture.jpg'))
    page.wait_for_timeout(600)
    page.evaluate('typstEditor.compiled()')
    check_that('title-picture.jpg' in get_state(page, 'Object.keys(S.assets)'), 'a picture is stored with the document')
    check_that('#image("title-picture.jpg"' in get_state(page, 'S.code') and page.locator('#pages image').count() == 1, 'the picture reaches the compiler and is on the page')

    # --- Pictures tab ---
    page.click('[data-itab=pictures]')
    check_that(page.locator('#pics-wrap .picture-card').count() == 1 and 'used 1×' in page.inner_text('#pics-wrap'), 'Pictures tab: the picture with where it is used')
    page.evaluate("() => typstEditor.setCode(typstEditor.state.code + '\\n#let d = csv(\"data.csv\")\\n')")
    page.wait_for_timeout(500)
    check_that('data.csv' in page.inner_text('#pics-wrap .missing-pictures'), 'Pictures tab: a file the code reads but is missing')
    page.click('[data-pic-ren="title-picture.jpg"]')
    page.fill('.picture-rename', 'cover')
    page.keyboard.press('Enter')
    page.wait_for_timeout(500)
    page.evaluate('typstEditor.compiled()')
    check_that('cover.jpg' in get_state(page, 'Object.keys(S.assets)') and '"cover.jpg"' in get_state(page, 'S.code') and 'title-picture' not in get_state(page, 'S.code'), 'Rename changes the file and the code')
    check_that(page.locator('#pages image').count() == 1, 'the page still shows it')
    csv = os.path.join(HERE, '_data.csv')
    with open(csv, 'w') as f:
        f.write('a,b\n1,2\n')
    with page.expect_file_chooser() as fc:
        page.click('[data-pic-fill="data.csv"]')
    fc.value.set_files(csv)
    page.wait_for_timeout(600)
    os.remove(csv)
    page.evaluate('typstEditor.compiled()')
    check_that('data.csv' in get_state(page, 'Object.keys(S.assets)') and page.locator('#pics-wrap .missing-pictures').count() == 0 and get_state(page, 'S.problems.length') == 0, '"Add file…" fills a missing data file under its name, and the compiler reads it')
    page.click('[data-pic-del="data.csv"]')
    page.click('#ask-ok')
    page.wait_for_timeout(300)
    page.evaluate('typstEditor.compiled()')
    check_that('data.csv' not in get_state(page, 'Object.keys(S.assets)') and any('data.csv' in p for p in get_state(page, 'S.problems.map(p => p.msg)')), 'Remove takes the file away; the compiler reports it missing')
    page.click('[data-itab=properties]')

    # --- AI link to a new document, and a pasted terminal answer ---
    typ = '= From the AI\nText.\n'
    z = base64.urlsafe_b64encode(zlib.compress(typ.encode())).decode().rstrip('=')
    page.goto(URL + '#z=' + z + '&file=new&name=AI%20report', wait_until='networkidle')
    wait_until(page, 'typstEditor.state.name === "AI report" && typstEditor.state.pages.length > 0')
    page.evaluate('typstEditor.compiled()')
    check_that(get_run(page, 'From the AI').count() == 1, 'an AI link makes a new document')
    link = 'https://typst.giit.ch/#b64=' + base64.urlsafe_b64encode('= Pasted'.encode()).decode() + '&mode=add'
    answer = 'Here is the link:\n' + link[:40] + '\n' + link[40:] + '\nClick it.'
    page.click('#btn-ai')
    page.fill('#ai-paste', answer)
    page.wait_for_timeout(400)
    check_that(not page.locator('#ask').is_visible(), 'a link changes the document without a question')
    page.wait_for_timeout(300)
    page.evaluate('typstEditor.compiled()')
    check_that(get_run(page, 'Pasted').count() == 1, 'a link broken over lines can be pasted')
    tl = 'https://typst.giit.ch/#typ=' + '%3D%20Plain%20link'
    page.evaluate('l => { location.hash = l.split("#")[1]; }', tl)
    page.wait_for_timeout(600)
    if page.locator('#ask').is_visible():
        page.click('#ask-ok')
    page.evaluate('typstEditor.compiled()')
    check_that(get_state(page, 'S.code') == '= Plain link', '#typ= carries URL-encoded Typst')

    # --- Export ---
    page.click('#btn-export')
    page.select_option('#ex-format', 'pdf')
    with page.expect_download() as d:
        page.click('#ex-download')
    with open(d.value.path(), 'rb') as f:
        pdf = f.read()
    check_that(d.value.suggested_filename == 'AI report.pdf' and pdf.startswith(b'%PDF-') and b'/Font' in pdf, 'export: PDF from the compiler with fonts (real text)')
    page.select_option('#ex-format', 'png')
    with page.expect_download() as d:
        page.click('#ex-download')
    with open(d.value.path(), 'rb') as f:
        png = f.read()
    check_that(d.value.suggested_filename.endswith('.png') and png.startswith(b'\x89PNG') and len(png) > 3000, 'export: page as PNG')
    page.select_option('#ex-format', 'svg')
    with page.expect_download() as d:
        page.click('#ex-download')
    with open(d.value.path(), encoding='utf-8') as f:
        svg = f.read()
    check_that(svg.startswith('<svg') and '<use' in svg and 'foreignObject' not in svg and '<script' not in svg, 'export: page as SVG with its glyphs, without the text layer')
    page.select_option('#ex-format', 'typ')
    with page.expect_download() as d:
        page.click('#ex-download')
    check_that(d.value.suggested_filename == 'AI report.typ', 'export: .typ')
    page.keyboard.press('Escape')

    # --- Phone ---
    page.set_viewport_size({'width': 390, 'height': 800})
    page.wait_for_timeout(300)
    check_that(page.locator('.views').is_visible(), 'phone: Code / Preview / Document tabs')
    check_that(page.evaluate('document.documentElement.scrollWidth') <= 391, 'phone: no sideways scrolling')
    page.click('[data-pane=code]')
    check_that(page.locator('#code').is_visible(), 'phone: the code view')

    check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
    browser.close()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
