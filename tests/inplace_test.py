"""Editing text in place on the pages: a click on text that is in the code
exactly as on the page opens a field over it; Enter writes the text into
the code (special characters escaped, one undo step), Escape cancels.
Text made by code is not edited on the page: a click goes to the code.
The field looks like the text it covers (size, bold, italic), which is
hidden while the field is open.
A picture dragged on the page moves its #figure(...) in the code, also to
another page and at another zoom; a click on it without moving still goes
to the code, Escape cancels, one Undo brings it back. Dropped on another
picture it goes directly before or after it; two pictures that are cells
of their own in a #grid or #table swap. With a finger, a
swipe that starts on a picture scrolls the pages, a long press drags it,
a tap is a click.

Start the editor first (php -S 127.0.0.1:8105 -t src src/php/router.php), then run this file."""
import base64
import os
import sys
import time

from playwright.sync_api import sync_playwright

EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8105/')
CODE = ('#set page(width: 12cm, height: 8cm, margin: 1cm)\n'
        '= Hello\n'
        'A plain "quoted" line -- with a dash.\n'
        '- First item\n'
        '- Second *strong* item\n'
        '#text(fill: blue)[Blue words]\n'
        '#upper("made by code")\n'
        '_Leaning_ words\n')
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'title-picture.jpg'), 'rb') as f:
    JPG = 'data:image/jpeg;base64,' + base64.b64encode(f.read()).decode()
FIG = '#figure(image("title-picture.jpg", width: 3cm), caption: [The title picture]) <titel>'
PICS = ('#set page(width: 12cm, height: 8cm, margin: 1cm)\n'
        '= Pictures\n'
        'Before the picture.\n\n'
        + FIG + '\n\n'
        'After the picture.\n\n'
        '#pagebreak()\n'
        '= Second page\n'
        'Last words.\n')
ROW = ('#set page(width: 12cm, height: auto, margin: 1cm)\n'
       'Pictures:\n\n'
       '#image("title-picture.jpg", height: 1.2cm)\n'
       '#image("picture-1.jpg", height: 1.2cm)\n'
       '#image("picture-3.jpg", height: 1.2cm)\n'
       '#image("picture-2.jpg", height: 1.2cm)\n\n'
       'After them.\n')
CELLS = ('#set page(width: 12cm, height: auto, margin: 1cm)\n'
         '#grid(columns: 3, gutter: 2mm,\n'
         '  image("picture-1.jpg", width: 100%),\n'
         '  image("picture-2.jpg", width: 100%),\n'
         '  image("picture-3.jpg", width: 100%),\n'
         ')\n\n'
         '#table(columns: 2, [#image("picture-1.jpg", width: 3cm)], [#image("picture-2.jpg", width: 3cm)])\n')
failed = []


def check_that(ok, text):
    """Prints one result line and notes a failure.

    Args:
        ok (bool): True when the check holds.
        text (str): what is checked.

    Returns:
        None: the result is printed and a failure is noted.
    """
    print(('ok    ' if ok else 'FAIL  ') + text)
    if not ok:
        failed.append(text)

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


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1360, 'height': 860})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))

    def open_editor(lang):
        """Opens the editor in a language with the test document, compiled.

        Args:
            lang (str): the language code.

        Returns:
            None: the editor shows CODE.
        """
        page.goto(EDITOR + '?lang=' + lang, wait_until='load')
        wait_until(page, 'window.typstEditor && typstEditor.state.pages.length > 0')
        page.evaluate('c => typstEditor.setCode(c)', CODE)
        page.evaluate('typstEditor.compiled()')

    open_editor('en')
    code = lambda: page.evaluate('typstEditor.state.code')
    field = page.locator('.text-in-place')
    get_run = lambda t: page.locator('#pages .typst-text').filter(has=page.locator('.tsel', has_text=t)).first

    def select_run(t):
        """Clicks the text run with a text, which opens it for editing.

        Args:
            t (str): the run's text.

        Returns:
            None: the click is done.
        """
        get_run(t).click()
        page.wait_for_timeout(200)

    # The field looks like the text on the page
    look = lambda: page.evaluate('() => { const c = getComputedStyle(document.querySelector(".text-in-place")); return { size: parseFloat(c.fontSize), weight: +c.fontWeight, style: c.fontStyle }; }')
    box = lambda t: page.evaluate('t => [...document.querySelectorAll("#pages .typst-text")].find(g => g.querySelector(".tsel")?.textContent.trim() === t).querySelector("foreignObject").getBoundingClientRect().height', t)
    shown = lambda t: page.evaluate('t => getComputedStyle([...document.querySelectorAll("#pages .typst-text")].find(g => g.querySelector(".tsel")?.textContent.trim() === t)).visibility', t)
    select_run('Hello')
    heading = look()
    check_that(heading['weight'] >= 700, 'the field of a heading is bold: %s' % heading)
    check_that(shown('Hello') == 'hidden', 'the text on the page is hidden while its field is open')
    field.press('Escape')
    page.wait_for_timeout(200)
    check_that(shown('Hello') == 'visible', 'and shown again after Escape')
    select_run('A plain')
    body = look()
    field.press('Escape')
    check_that(body['weight'] == 400 and body['style'] == 'normal', 'the field of plain text is plain: %s' % body)
    want, got = box('Hello') / box('A plain “quoted” line – with a dash.'), heading['size'] / body['size']
    check_that(abs(got / want - 1) < 0.15, 'the heading\'s field is larger like the heading: %.2f for %.2f' % (got, want))
    select_run('strong')
    check_that(look()['weight'] >= 700, 'the field of a *strong* word is bold')
    field.press('Escape')
    select_run('Leaning')
    check_that(look()['style'] == 'italic', 'the field of an _emph_ word is italic')
    field.press('Escape')
    page.wait_for_timeout(200)

    select_run('Hello')
    check_that(field.count() == 1 and field.input_value() == 'Hello', 'a click on a heading opens a field with its text')
    check_that(page.evaluate("document.activeElement.classList.contains('text-in-place')"), 'the field has the focus')
    field.fill('Hi <you> & #1 *x*')
    field.press('Control+Enter')
    page.evaluate('typstEditor.compiled()')
    check_that(field.count() == 0, 'Enter closes the field')
    check_that('= Hi \\<you\\> & \\#1 \\*x\\*\n' in code(), 'the text is in the code, escaped: ' + code().split('\n')[1])
    check_that(code().count('#set page(') == 1 and '- First item' in code(), 'the rest of the code stays as it was')
    check_that(get_run('Hi <you> & #1 *x*').count() == 1, 'the page shows the text as typed')
    page.evaluate('typstEditor.undo()')
    page.evaluate('typstEditor.compiled()')
    check_that('= Hello\n' in code(), 'one Undo brings the old text back')

    select_run('A plain')
    check_that(field.count() == 1 and field.input_value() == 'A plain “quoted” line – with a dash.', 'smart quotes and shorthands are found in the code: ' + (field.input_value() if field.count() else ''))
    field.press('End')
    page.keyboard.type(' Done.')
    field.press('Control+Enter')
    page.evaluate('typstEditor.compiled()')
    check_that('A plain "quoted" line -- with a dash. Done.\n' in code(), 'quotes and dashes stay as written in the code: ' + code().split('\n')[2])

    select_run('First item')
    field.fill('Not this')
    field.press('Escape')
    page.wait_for_timeout(300)
    check_that(field.count() == 0 and '- First item\n' in code(), 'Escape cancels')

    select_run('Second')
    check_that(field.count() == 1 and field.input_value() == 'Second', 'text before markup is its own run')
    field.fill('Next')
    page.mouse.click(5, 300)
    page.evaluate('typstEditor.compiled()')
    check_that('- Next *strong* item\n' in code(), 'leaving the field also writes the text')

    select_run('Blue words')
    check_that(field.count() == 1 and field.input_value() == 'Blue words', 'text inside a content block [ ] is edited too')
    field.press('Escape')

    get_run('MADE BY CODE').click()
    page.wait_for_timeout(200)
    caret = page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionStart + 6); }')
    check_that(field.count() == 0, 'text made by code opens no field')
    check_that(caret.startswith('#upper'), 'a click on it goes to the code that made it: ' + repr(caret))

    # Moving a picture
    page.evaluate('([c, j]) => { typstEditor.state.assets = { "title-picture.jpg": j }; typstEditor.setCode(c); }', [PICS, JPG])
    page.evaluate('typstEditor.compiled()')
    picture = page.locator('#pages image.typst-image').first
    line = page.locator('#pages .picture-target')

    def start_drag():
        """Presses the mouse on the first picture and moves it a little, so the drag starts.

        Returns:
            None: the picture is being dragged.
        """
        b = picture.bounding_box()
        x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 3, y + 8, steps=3)

    def move_drag_to(t, share=0.9):
        """Drags the first picture onto a text run.

        Args:
            t (str): the run's text.
            share (float): where on the run's height the pointer stops.

        Returns:
            None: the pointer is over the run, still pressed.
        """
        start_drag()
        get_run(t).scroll_into_view_if_needed()
        b = get_run(t).bounding_box()
        page.mouse.move(b['x'] + 4, b['y'] + b['height'] * share, steps=6)

    check_that(page.evaluate("getComputedStyle(document.querySelector('#pages image.typst-image')).cursor") == 'grab', 'the cursor over a picture is a hand that grabs')
    move_drag_to('After the picture')
    check_that(line.count() == 1, 'while dragging, a line shows where the picture goes')
    page.mouse.up()
    page.evaluate('typstEditor.compiled()')
    check_that('After the picture.\n\n' + FIG + '\n\n#pagebreak()' in code() and code().count('#figure(') == 1, 'dropped below the next paragraph, the whole figure with its label moves there')
    check_that(line.count() == 0 and field.count() == 0, 'the line is gone and no field opened where it was dropped')
    sel = page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionEnd); }')
    check_that(sel == FIG, 'the code shows the moved figure selected')
    page.evaluate('typstEditor.undo()')
    page.evaluate('typstEditor.compiled()')
    check_that(code() == PICS, 'one Undo puts the picture back where it was')

    page.evaluate('typstEditor.zoomTo(0.6)')
    page.wait_for_timeout(200)
    move_drag_to('Last words')
    page.mouse.up()
    page.evaluate('typstEditor.compiled()')
    check_that(code().endswith('Last words.\n\n' + FIG + '\n') and 'Before the picture.\n\nAfter the picture.' in code(), 'at 60 % zoom the picture moves to the next page')
    check_that(page.evaluate('typstEditor.state.pages[1].querySelector("image.typst-image") != null'), 'the page shows it on the second page')
    page.evaluate('typstEditor.undo()')
    page.evaluate('typstEditor.compiled()')
    page.evaluate('typstEditor.zoomTo(1)')
    page.wait_for_timeout(200)

    move_drag_to('After the picture')
    page.keyboard.press('Escape')
    check_that(line.count() == 0, 'Escape takes the line away')
    page.mouse.up()
    page.wait_for_timeout(300)
    check_that(code() == PICS and field.count() == 0, 'after Escape the code stays as it was')

    move_drag_to('Before the picture', 0.95)
    page.mouse.up()
    page.wait_for_timeout(300)
    check_that(code() == PICS, 'dropped where it is already, nothing changes')

    picture.click()
    page.wait_for_timeout(200)
    caret = page.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionStart + 7); }')
    check_that(code() == PICS and caret == '#figure', 'a click on a picture without moving still goes to its code: ' + repr(caret))
    page.evaluate('c => typstEditor.setCode(c)', CODE)
    page.evaluate('typstEditor.compiled()')
    page.click('#zoom-fit')

    # Pictures beside each other: before or after another one, or swapped in cells
    pics = {n: JPG for n in ('title-picture.jpg', 'picture-1.jpg', 'picture-2.jpg', 'picture-3.jpg')}

    def apply_code(c):
        """Sets the code with the four pictures and waits for the compiler.

        Args:
            c (str): the Typst code.

        Returns:
            None: the pages show the code.
        """
        page.evaluate('([c, p]) => { typstEditor.state.assets = p; typstEditor.setCode(c); }', [c, pics])
        page.evaluate('typstEditor.compiled()')
        page.evaluate('document.querySelector("#scroller").scrollTop = 0')

    def move_picture_onto(i, j, fx, fy=0.5):
        """Drags a picture onto another one.

        Args:
            i (int): the index of the picture dragged.
            j (int): the index of the picture it goes onto.
            fx (float): the share of its width where the pointer stops.
            fy (float): the share of its height where the pointer stops.

        Returns:
            None: the pointer is over the other picture, still pressed.
        """
        page.evaluate('scrollTo(0, 0); document.querySelector("#scroller").scrollTop = 0')
        a = page.locator('#pages image.typst-image').nth(i).bounding_box()
        b = page.locator('#pages image.typst-image').nth(j).bounding_box()
        page.mouse.move(a['x'] + a['width'] / 2, a['y'] + a['height'] / 2)
        page.mouse.down()
        page.mouse.move(a['x'] + a['width'] / 2 + 5, a['y'] + a['height'] / 2 + 5, steps=3)
        page.mouse.move(b['x'] + b['width'] * fx, b['y'] + b['height'] * fy, steps=6)

    def get_picture_order():
        """Returns the pictures in the order of the code.

        Returns:
            list[str]: the names of the pictures, one per image( line.
        """
        return [l.split('"')[1] for l in code().split('\n') if 'image(' in l]

    apply_code(ROW)
    move_picture_onto(3, 1, 0.5, 0.2)
    check_that(page.evaluate('(() => { const l = document.querySelector("#pages .picture-target"); return !!l && !l.classList.contains("vertical") && Math.abs(parseFloat(l.style.width) - 78 / typstEditor.state.zoom) < 20; })()'),
          'over a picture stacked with others the line lies over its width')
    page.mouse.up()
    page.evaluate('typstEditor.compiled()')
    check_that(get_picture_order() == ['title-picture.jpg', 'picture-2.jpg', 'picture-1.jpg', 'picture-3.jpg'] and '#image("picture-2.jpg", height: 1.2cm)\n#image("picture-1.jpg"' in code(),
          'dropped on the upper half of another picture, it goes before it, on its own line: ' + repr(get_picture_order()))
    page.evaluate('typstEditor.undo()')
    page.evaluate('typstEditor.compiled()')
    check_that(code() == ROW, 'one Undo puts it back')
    move_picture_onto(0, 2, 0.5, 0.8)
    page.mouse.up()
    page.evaluate('typstEditor.compiled()')
    check_that(get_picture_order() == ['picture-1.jpg', 'picture-3.jpg', 'title-picture.jpg', 'picture-2.jpg'] and code().startswith(ROW.split('#image')[0] + '#image("picture-1.jpg"'),
          'dropped on the lower half, it goes after it: ' + repr(get_picture_order()))

    apply_code(CELLS)
    move_picture_onto(0, 2, 0.5)
    check_that(page.locator('#pages .picture-target.swap').count() == 1, 'over the middle of another cell a frame shows the swap')
    page.mouse.up()
    page.evaluate('typstEditor.compiled()')
    grid = lambda: code().split('#table')[0]
    check_that(get_picture_order()[:3] == ['picture-3.jpg', 'picture-2.jpg', 'picture-1.jpg'] and grid().count(',\n') == 4 and grid().endswith(')\n\n'),
          'dropped on its middle, two grid cells swap; the commas stay: ' + repr(get_picture_order()[:3]))
    page.evaluate('typstEditor.undo()')
    page.evaluate('typstEditor.compiled()')
    check_that(code() == CELLS, 'one Undo swaps them back')
    move_picture_onto(0, 2, 0.92)
    check_that(page.locator('#pages .picture-target.vertical').count() == 1, 'at the outer edge of a cell side by side it is an upright line again')
    page.mouse.up()
    page.evaluate('typstEditor.compiled()')
    check_that(get_picture_order()[:3] == ['picture-2.jpg', 'picture-3.jpg', 'picture-1.jpg'] and grid().count('image(') == 3 and grid().count(',\n') == 4,
          'dropped on the outer edge, it goes after that cell: ' + repr(get_picture_order()[:3]))
    page.evaluate('typstEditor.undo()')
    page.evaluate('typstEditor.compiled()')
    move_picture_onto(3, 4, 0.5)
    page.mouse.up()
    page.evaluate('typstEditor.compiled()')
    check_that(code().endswith('#table(columns: 2, [#image("picture-2.jpg", width: 3cm)], [#image("picture-1.jpg", width: 3cm)])\n'), 'pictures in [ ] cells of a table swap, brackets and commas stay')
    page.evaluate('c => typstEditor.setCode(c)', CODE)
    page.evaluate('typstEditor.compiled()')

    # Moving a picture with a finger
    ctx = browser.new_context(viewport={'width': 1360, 'height': 860}, has_touch=True, is_mobile=True)
    tp = ctx.new_page()
    tp.on('pageerror', lambda e: errors.append(str(e)))
    tp.goto(EDITOR + '?lang=en', wait_until='load')
    wait_until(tp, 'window.typstEditor && typstEditor.state.pages.length > 0')
    tp.evaluate('([c, j]) => { typstEditor.state.assets = { "title-picture.jpg": j }; typstEditor.setCode(c); }', [PICS, JPG])
    tp.evaluate('typstEditor.compiled()')
    tp.evaluate('typstEditor.zoomTo(1.6)')
    tp.evaluate('document.querySelector("#scroller").scrollTop = 0')
    cdp = ctx.new_cdp_session(tp)
    tcode = lambda: tp.evaluate('typstEditor.state.code')
    top = lambda: tp.evaluate('document.querySelector("#scroller").scrollTop')

    def send_touch(kind, x=0, y=0):
        """Sends a touch event through the DevTools protocol.

        Args:
            kind (str): touchStart, touchMove or touchEnd.
            x (float): where the finger is.
            y (float): where the finger is.

        Returns:
            None: the event is sent.
        """
        cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y}]})

    def get_middle(loc):
        """Returns the middle of an element on the screen.

        Args:
            loc (Locator): the element.

        Returns:
            tuple[float, float]: x and y of its middle.
        """
        b = loc.bounding_box()
        return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2

    tpicture = tp.locator('#pages image.typst-image').first
    x, y = get_middle(tpicture)
    before = top()
    send_touch('touchStart', x, y)
    for i in range(1, 9):
        send_touch('touchMove', x, y - 30 * i)
        time.sleep(0.016)
    send_touch('touchEnd')
    tp.wait_for_timeout(500)
    check_that(top() > before + 50 and tcode() == PICS, 'a swipe that starts on a picture scrolls the pages and moves nothing (%d -> %d)' % (before, top()))

    tp.evaluate('document.querySelector("#scroller").scrollTop = 0')
    tp.wait_for_timeout(100)
    x, y = get_middle(tpicture)
    send_touch('touchStart', x, y)
    tp.wait_for_timeout(600)
    check_that(tp.locator('#pages .picture-target').count() == 1, 'a long press on a picture starts dragging it')
    target = tp.locator('#pages .typst-text').filter(has=tp.locator('.tsel', has_text='After the picture')).first
    b = target.bounding_box()
    tx, ty = b['x'] + 4, b['y'] + b['height'] * 0.9
    for i in range(1, 9):
        send_touch('touchMove', x + (tx - x) * i / 8, y + (ty - y) * i / 8)
        time.sleep(0.016)
    still = top()
    send_touch('touchEnd')
    tp.evaluate('typstEditor.compiled()')
    check_that('After the picture.\n\n' + FIG + '\n\n#pagebreak()' in tcode() and tcode().count('#figure(') == 1, 'then moved and let go, the picture moves in the code')
    check_that(still == 0, 'the pages do not scroll while the finger drags')
    tp.evaluate('typstEditor.undo()')
    tp.evaluate('typstEditor.compiled()')

    tp.evaluate('document.querySelector("#scroller").scrollTop = 0')
    tp.wait_for_timeout(100)
    tp.evaluate('document.querySelector("#code").setSelectionRange(0, 0)')
    tp.touchscreen.tap(*get_middle(tpicture))
    tp.wait_for_timeout(300)
    caret = tp.evaluate('() => { const t = document.querySelector("#code"); return t.value.slice(t.selectionStart, t.selectionStart + 7); }')
    check_that(tcode() == PICS and caret == '#figure', 'a tap on a picture still goes to its code: ' + repr(caret))
    ctx.close()

    open_editor('de')
    select_run('Hello')
    check_that(field.count() == 1 and field.input_value() == 'Hello', 'also in the German interface, and the text itself is not translated')
    field.press('Escape')
    page.goto(EDITOR + '?lang=en', wait_until='load')
    check_that(not errors, 'no script errors: ' + '; '.join(errors))
    browser.close()

print()
print('all passed' if not failed else f'{len(failed)} failed')
sys.exit(1 if failed else 0)
