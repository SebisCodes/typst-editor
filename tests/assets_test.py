"""Pictures of the page's document, and the keys inside a page.

    php -S 127.0.0.1:8105 -t src src/php/router.php          (in the project folder)
    python tests/assets_test.py

A host page embeds the editor with ?embed=1&save=0 and loads a document
with pictures, a CSV file the code reads and a PDF it does not use. Checks:
the picture and the CSV reach the compiler, save carries all files (with
assetsChanged / assetsRemoved), a new, replaced or removed picture is a
change, a load with assets replaces the pictures, the PDF stays untouched,
Ctrl+S works from anywhere, F5 / Ctrl+R go to the page instead of
reloading, and there is no Save button."""

import base64
import os
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8105/')
# The test's own host servers; HOST_PORT / HOST_PORT2 choose other ports when those are taken.
HP = os.environ.get('HOST_PORT', '8096')
HP2 = os.environ.get('HOST_PORT2', '8097')
HERE = os.path.dirname(os.path.abspath(__file__))
PDF = 'data:application/pdf;base64,' + base64.b64encode(b'%PDF-1.4\n% plan\n').decode()
CSV = 'data:text/csv;base64,' + base64.b64encode('Zimmer,5\nFläche,180\n'.encode()).decode()
TEX = '= Plan\n#image("title-picture.jpg", width: 4cm)\n#table(columns: 2, ..csv("values.csv").flatten())\n'
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


HOST = """<!doctype html><meta charset="utf-8"><title>host</title>
<iframe id="f" src="EDITOR?embed=1&save=0" style="width:1300px;height:820px;border:0"></iframe>
<script>
const P = 'typsteditor', ORIGIN = new URL('EDITOR').origin, frame = document.getElementById('f');
window.log = [];
window.send = m => frame.contentWindow.postMessage(m, ORIGIN);
addEventListener('message', async e => {
  if (e.source !== frame.contentWindow) return;
  log.push(e.data);
  if (e.data.type === P + ':ready') {
    const b = await (await fetch('title-picture.jpg')).blob();
    window.jpg = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    send({ type: P + ':load', name: 'Dossier 17', content: TEX, assets: { 'title-picture.jpg': jpg, 'plan.pdf': 'PDFURI', 'alt.jpg': jpg, 'values.csv': 'CSVURI' } });
  }
});
</script>"""

with tempfile.TemporaryDirectory() as d:
    import json
    with open(os.path.join(d, 'host.html'), 'w') as f:
        f.write(HOST.replace('EDITOR', EDITOR).replace('TEX', json.dumps(TEX)).replace('PDFURI', PDF).replace('CSVURI', CSV))
    with open(os.path.join(HERE, 'title-picture.jpg'), 'rb') as a, open(os.path.join(d, 'title-picture.jpg'), 'wb') as b:
        b.write(a.read())
    server = subprocess.Popen(['php', '-S', '127.0.0.1:' + HP, '-t', d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            page = browser.new_page(viewport={'width': 1360, 'height': 860})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://127.0.0.1:' + HP + '/host.html', wait_until='load')
            page.wait_for_timeout(1000)
            frame = next(fr for fr in page.frames if fr.url.startswith(EDITOR))
            wait_until(frame, 'typstEditor.state.name === "Dossier 17" && typstEditor.state.pages.length > 0')
            frame.evaluate('typstEditor.compiled()')
            log = lambda: page.evaluate('log')
            last = lambda t: next((m for m in reversed(log()) if m['type'] == 'typsteditor:' + t), None)
            check_that(not frame.locator('#btn-save').is_visible(), '?save=0: no Save button')
            check_that(frame.evaluate('typstEditor.state.problems.length') == 0, 'the document from the page compiles with its files')
            check_that(frame.locator('#pages image').count() == 1, 'the picture from the page reaches the compiler and is on the page')
            texts = frame.evaluate('[...document.querySelectorAll("#pages .tsel")].map(t => t.textContent)')
            check_that('Zimmer' in texts and '180' in texts, 'the CSV file from the page reaches the compiler: its values are in the table')

            # Ctrl+S from the preview (not the code) still saves to the page
            frame.click('#stage', position={'x': 8, 'y': 8})
            page.keyboard.press('Control+s')
            page.wait_for_timeout(400)
            s = last('save')
            check_that(s is not None and set(s['assets']) == {'title-picture.jpg', 'plan.pdf', 'alt.jpg', 'values.csv'} and s['assets']['plan.pdf'] == PDF and s['assets']['values.csv'] == CSV, 'Ctrl+S anywhere: save carries all files, the PDF and the CSV untouched')
            check_that(s['assetsChanged'] == [] and s['assetsRemoved'] == [], 'nothing changed since load')

            # A new picture is a change, and save says which
            n = len(log())
            frame.set_input_files('#file', os.path.join(HERE, 'title-picture.jpg'))
            page.wait_for_timeout(1000)
            ch = [m for m in log()[n:] if m['type'] == 'typsteditor:change']
            check_that(ch and 'title-picture-2.jpg' in ch[-1].get('assetsChanged', []), 'a new picture is reported as a change')
            # Remove one
            if frame.get_attribute('#btn-panel', 'aria-expanded') != 'true':
                frame.click('#btn-panel')
            frame.click('[data-itab=pictures]')
            frame.click('[data-pic-del="alt.jpg"]')
            frame.click('#ask-ok')
            page.wait_for_timeout(700)
            ch = [m for m in log()[n:] if m['type'] == 'typsteditor:change']
            check_that(ch and 'alt.jpg' in ch[-1].get('assetsRemoved', []), 'removing a picture is a change too')
            page.evaluate("send({ type: 'typsteditor:get' })")
            page.wait_for_timeout(300)
            g = last('save')
            check_that('title-picture-2.jpg' in g['assets'] and 'alt.jpg' not in g['assets'] and g['assetsChanged'] == ['title-picture-2.jpg'] and g['assetsRemoved'] == ['alt.jpg'], 'get: all pictures, assetsChanged and assetsRemoved')
            page.evaluate("send({ type: 'typsteditor:get' })")
            page.wait_for_timeout(300)
            check_that(last('save')['assetsChanged'] == [] and last('save')['assetsRemoved'] == [], 'after that the page has them all')

            # A load with assets replaces the pictures
            page.evaluate("send({ type: 'typsteditor:load', name: 'Dossier 17', content: " + json.dumps(TEX) + ", assets: { 'title-picture.jpg': jpg } })")
            page.wait_for_timeout(800)
            check_that(frame.evaluate('Object.keys(typstEditor.state.assets)') == ['title-picture.jpg'], 'a load with assets replaces the document\'s pictures')
            frame.evaluate('typstEditor.compiled()')
            check_that(any('values.csv' in m for m in frame.evaluate('typstEditor.state.problems.map(p => p.msg)')), 'the compiler no longer has the removed CSV file')

            # F5 / Ctrl+R inside the editor go to the page
            n = len(log())
            frame.click('#stage', position={'x': 8, 'y': 8})
            page.keyboard.press('F5')
            page.keyboard.press('Control+r')
            page.wait_for_timeout(500)
            rl = [m for m in log()[n:] if m['type'] == 'typsteditor:reload']
            check_that(len(rl) == 2 and rl[0]['id'] == frame.evaluate('typstEditor.state.fileId') and frame.evaluate('!!window.typstEditor'), 'F5 and Ctrl+R do not reload but ask the page')
            check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
            browser.close()
    finally:
        server.terminate()

print(f'\n{len(failures)} failed' if failures else '\nall passed')
sys.exit(1 if failures else 0)
