"""PDF of the page's document for the page (typsteditor:pdf).

    php -S 127.0.0.1:8105 -t src src/php/router.php          (in the project folder)
    python tests/pdf_test.py

A host page embeds the editor with ?embed=1&save=0, loads a two-page A4
document with a picture and asks for a PDF. Checks: the answer is a PDF
data URI made by the Typst compiler (real text with embedded fonts, the
picture, two A4 pages), the id is that of the loaded document, before a
load and for a document with errors there is an error instead of a PDF."""

import base64
import json
import os
import re
import subprocess
import tempfile
import time

from playwright.sync_api import sync_playwright

EDITOR = os.environ.get('EDITOR_URL', 'http://127.0.0.1:8105/')
# The test's own host servers; HOST_PORT / HOST_PORT2 choose other ports when those are taken.
HP = os.environ.get('HOST_PORT', '8096')
HP2 = os.environ.get('HOST_PORT2', '8097')
HERE = os.path.dirname(os.path.abspath(__file__))
TEX = '#set page(paper: "a4")\n#set document(title: "Dossier PDF")\nErste Seite.\n\n#image("title-picture.jpg", width: 4cm)\n#pagebreak()\nZweite Seite.\n'
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
window.load = async () => {
  const b = await (await fetch('title-picture.jpg')).blob();
  const jpg = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
  send({ type: P + ':load', name: 'Dossier PDF', content: TEX, assets: { 'title-picture.jpg': jpg } });
};
addEventListener('message', e => { if (e.source === frame.contentWindow) log.push(e.data); });
</script>"""

with tempfile.TemporaryDirectory() as d:
    with open(os.path.join(d, 'host.html'), 'w') as f:
        f.write(HOST.replace('EDITOR', EDITOR).replace('TEX', json.dumps(TEX)))
    with open(os.path.join(HERE, 'title-picture.jpg'), 'rb') as a, open(os.path.join(d, 'title-picture.jpg'), 'wb') as b:
        b.write(a.read())
    server = subprocess.Popen(['php', '-S', '127.0.0.1:' + HP2, '-t', d], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel='chrome', headless=True)
            page = browser.new_page(viewport={'width': 1360, 'height': 860})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto('http://127.0.0.1:' + HP2 + '/host.html', wait_until='load')
            page.wait_for_timeout(2500)
            log = lambda: page.evaluate('log')
            answers = lambda: [m for m in log() if m.get('type') == 'typsteditor:pdf']

            page.evaluate("send({ type: 'typsteditor:pdf' })")
            page.wait_for_timeout(800)
            a = answers()
            check_that(len(a) == 1 and a[0].get('error') and 'pdf' not in a[0], 'before a load: an error, no PDF')

            page.evaluate('load()')
            page.wait_for_timeout(1000)
            frame = next(fr for fr in page.frames if fr.url.startswith(EDITOR))
            wait_until(frame, 'typstEditor.state.name === "Dossier PDF" && typstEditor.state.pages.length > 0')
            loaded = next((m for m in reversed(log()) if m['type'] == 'typsteditor:loaded'), None)
            check_that(loaded is not None, 'the document is loaded')

            page.evaluate("send({ type: 'typsteditor:pdf', dpi: 100 })")
            page.wait_for_function("log.filter(m => m.type === 'typsteditor:pdf').length >= 2", timeout=30000)
            a = answers()[-1]
            check_that(a.get('id') == loaded['id'] and a.get('name') == 'Dossier PDF', 'the answer is about the loaded document')
            check_that(a.get('pages') == 2, 'two pages')
            uri = a.get('pdf') or ''
            check_that(uri.startswith('data:application/pdf;base64,'), 'a PDF data URI')
            pdf = base64.b64decode(uri.split(',', 1)[1]) if uri else b''
            check_that(re.match(rb'%PDF-1\.\d', pdf) is not None and pdf.rstrip().endswith(b'%%EOF'), 'a PDF file: starts with %PDF-1.x and ends with %%EOF')
            check_that(len(re.findall(rb'/Type\s*/Page(?![s\w])', pdf)) == 2, 'two pages')
            boxes = re.findall(rb'/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]', pdf)
            check_that(len(boxes) >= 1 and all(abs(float(w) - 595.3) < 2 and abs(float(h) - 841.9) < 2 for w, h in boxes), 'A4 pages (595 x 842 pt)')
            check_that(b'/FontFile' in pdf and b'/ToUnicode' in pdf, 'real text: embedded fonts with a text mapping (selectable)')
            check_that(re.search(rb'/Subtype\s*/Image', pdf) is not None, 'the picture of the page is in the PDF')
            check_that(b'Dossier PDF' in pdf or 'Dossier PDF'.encode('utf-16-be') in pdf, 'the document title is in the PDF')

            # A document with errors: an error instead of a PDF
            page.evaluate("send({ type: 'typsteditor:load', name: 'Dossier PDF', content: '#let x = (' })")
            page.wait_for_timeout(800)
            n = len(answers())
            page.evaluate("send({ type: 'typsteditor:pdf' })")
            page.wait_for_function(f"log.filter(m => m.type === 'typsteditor:pdf').length > {n}", timeout=30000)
            a = answers()[-1]
            check_that(a.get('error') and 'pdf' not in a, 'a document with errors: an error, no PDF: ' + str(a.get('error')))

            if os.environ.get('PDF_OUT'):
                open(os.environ['PDF_OUT'], 'wb').write(pdf)
            check_that(not errors, 'no script errors' + (': ' + '; '.join(errors) if errors else ''))
            browser.close()
    finally:
        server.terminate()

print('\n' + ('All checks passed.' if not failures else f'{len(failures)} failed.'))
raise SystemExit(1 if failures else 0)
