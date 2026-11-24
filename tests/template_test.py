"""Template placeholders (?template=mustache or angle), run in Node: how the Typst editor reads them.

    python3 tests/template_test.py

  letter    an order letter with placeholders in markup, a heading, strong text, a table whose rows
            stand in a section, a string, a link, a picture file name, raw text, math and comments
            (tests/letter-template.typ) has no placeholder problem with the syntax "mustache"; the
            code view shows every tag as plain text in the colors around it
  angle     the same letter in the syntax "angle" (tests/letter-template-angle.typ)
  context   each tag's kind of code: markup, code, string, comment, raw text, math
  template  the template view: every tag as its own text for its place (markup escaped, math and
            code a string, a section tag in code a comment; strings, comments and raw text as
            written), copied text unchanged, each tag's text leading to its tag; a picture whose
            file name holds a tag gets a placeholder picture
  example   the example view: no tag left, examples written for their place, list rows repeated,
            sections by their example state, the label in brackets without an example, the example
            picture among the compiler's files under a name of its own; the map leads copied text
            to the same character and each fill to its tag
  escape    a text written for markup, math, code, a string, a comment and raw text
  result    the compiler's places on the example view lead back to the code
  code      a value in code is reported at the tag in the shape of the compiler's problems
  errors    a section left open and a stray end tag are errors at the tag, with line, column and end
  pictures  a picture whose file name holds a placeholder gets a placeholder picture of its format;
            the document's own files stay as they are
  off       with the option off the highlighting is the plain Typst highlighting and no tag is read
Needs Node."""
import html
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(os.path.dirname(HERE), 'src', 'js')
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


def run_report(cases):
    """Runs tests/template/report.mjs in Node on the cases.

    Args:
        cases (list[dict]): each with `code` (str), `template` (str or None), optional `files` (dict[str, str])
            and optional `examples` (dict, the page's template message).

    Returns:
        tuple[list[dict], dict]: one result per case, in order, and the texts written for each kind of code.
    """
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as file:
        json.dump(cases, file)
    try:
        run = subprocess.run(['node', os.path.join(HERE, 'template', 'report.mjs'), SCRIPTS, file.name],
                             capture_output=True, text=True, timeout=120)
    finally:
        os.unlink(file.name)
    if run.returncode:
        print(run.stderr)
        sys.exit('report.mjs failed')
    report = json.loads(run.stdout)
    return report['cases'], report['writes']


def check_map(view, code, text):
    """Checks that a view's map covers its text, copied text equals the code and each fill stands for a tag.

    Args:
        view (dict): the view of a case result (text and map).
        code (str): the template.
        text (str): what is checked, for the result line.

    Returns:
        None: the result is printed.
    """
    segments = view['map']
    covered = all(segments[k]['viewEnd'] == segments[k + 1]['viewStart'] for k in range(len(segments) - 1)) and segments[0]['viewStart'] == 0 and segments[-1]['viewEnd'] == len(view['text'])
    copies = all(view['text'][seg['viewStart']:seg['viewEnd']] == code[seg['codeStart']:seg['codeEnd']] for seg in segments if seg['kind'] == 'copy')
    fills = all(code[seg['codeStart']] in '{<' and code[seg['codeEnd'] - 1] in '}>' for seg in segments if seg['kind'] == 'fill')
    check_that(covered and copies and fills, text)


def get_plain_text(highlighted):
    """Returns the plain text of highlighted HTML.

    Args:
        highlighted (str): the HTML of the code view.

    Returns:
        str: the text with the tags removed and the entities decoded.
    """
    return html.unescape(re.sub(r'<[^>]+>', '', highlighted))


def get_contexts(result):
    """Returns the kind of code of each tag of a result.

    Args:
        result (dict): one case result of report.mjs.

    Returns:
        dict[str, set[str]]: the kinds of code each tag text stands in.
    """
    contexts = {}
    for tag in result['tags']:
        contexts.setdefault(tag['text'], set()).add(tag['context'])
    return contexts


PICTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
EXAMPLES = {
    'placeholders': [
        {'name': 'name', 'label': 'Name', 'example': 'John Doe'},
        {'name': 'city', 'label': 'City', 'example': 'Springfield'},
        {'name': 'customerNumber', 'label': 'Customer number', 'example': 'C-1 "x"'},
        {'name': 'logo', 'kind': 'image', 'label': 'Logo', 'image': 'logo.png'},
        {'name': 'total', 'label': 'Total', 'example': '42.50'},
        {'name': 'street', 'label': 'Street'},
        {'name': 'hasNote', 'kind': 'section', 'label': 'With a note', 'shown': False},
        {'name': 'items', 'kind': 'list', 'label': 'Items', 'fields': [{'name': 'label', 'label': 'Item'}, {'name': 'quantity', 'label': 'Quantity'}],
         'rows': [{'label': 'Chair', 'quantity': '2'}, {'label': 'Table #1', 'quantity': '1'}]},
    ],
    'assets': {'logo.png': PICTURE},
}


def check_letter(result, code, syntax_name, written):
    """Checks the letter template of one syntax in both views.

    Args:
        result (dict): the case result of report.mjs.
        code (str): the template.
        syntax_name (str): "mustache" or "angle".
        written (callable): writes a tag of the syntax from a sign and a name, e.g. ('', 'name') -> '{{name}}'.

    Returns:
        None: the results are printed.
    """
    check_that(result['problems'] == [], f'{syntax_name}: no placeholder problem (got {result["problems"]})')
    contexts = get_contexts(result)
    expected = {written('', 'name'): {'markup', 'comment'}, written('', 'customerNumber'): {'string', 'raw'}, written('', 'logo'): {'string'},
                written('', 'total'): {'math'}, written('', 'trackingLink'): {'string'}, written('#', 'items'): {'code'}, written('', 'label'): {'markup'}}
    check_that(all(contexts.get(tag) == kinds for tag, kinds in expected.items()), f'{syntax_name}: each tag stands in its kind of code {contexts}')
    check_that(get_plain_text(result['highlighted']) == code, f'{syntax_name}: the highlighted text is the code')
    check_that('class="tp"' not in result['highlighted'], f'{syntax_name}: no tag is colored in the code view')
    escaped = lambda text: re.sub(r'([\\#*_`$<>@\[\]{}/~\-=+.:])', r'\\\1', text)
    view = result['template']
    check_map(view, code, f'{syntax_name}: template view: the map covers the text, copied text is the code, each tag text leads to its tag')
    check_that('\n' + escaped(written('', 'name')) + ' \\\n' in view['text'], f'{syntax_name}: template view: a value in markup is its text, escaped')
    check_that('\n' + escaped(written('#', 'items')) + '\n' not in view['text'] and '/*' + written('#', 'items') + '*/' in view['text'], f'{syntax_name}: template view: a section tag in code is a comment')
    check_that('"' + written('', 'total') + '"' in view['text'], f'{syntax_name}: template view: a value in math is a string of its text')
    check_that('"' + written('', 'customerNumber') + '"' in view['text'] and '`' + written('', 'customerNumber') + '`' in view['text'] and written('', 'name') + '.' in view['text'],
               f'{syntax_name}: template view: strings, raw text and comments keep their tags as written')
    check_that(view['files'] == {written('', 'logo') + '.png': 'data:image/png;base64'}, f'{syntax_name}: template view: the picture file name gets a placeholder PNG ({view["files"]})')
    view = result['example']
    text = view['text']
    check_map(view, code, f'{syntax_name}: example view: the map covers the text, copied text is the code, each fill leads to its tag')
    check_that(written('', 'name') not in text and '<<' not in text and '{{' not in text, f'{syntax_name}: example view: no tag is left')
    check_that('\nJohn Doe \\\n' in text and 'on their way to *Springfield*' in text, f'{syntax_name}: example view: values in markup')
    check_that('\\[Street\\] \\\n' in text, f'{syntax_name}: example view: a value without an example shows its label in brackets')
    check_that('[Chair], [2]' in text and '[Table \\#1], [1]' in text and text.count('"[Price]"') == 0, f'{syntax_name}: example view: the list repeats its rows, each value escaped')
    check_that('_Note:_' not in text and 'If you have questions' in text, f'{syntax_name}: example view: the section is hidden by its example state, the inverted one shown')
    check_that('$sum p_i = "42.50"$' in text, f'{syntax_name}: example view: a value in math is a string')
    check_that('"C-1 \\"x\\""' in text and '`C-1 "x"`' in text, f'{syntax_name}: example view: a value in a string is escaped, in raw text written as it is')
    pictures = [seg for seg in view['map'] if seg['picture']]
    check_that(view['files'] == {'template-examples/1.png.png': 'data:image/png;base64'} and len(pictures) == 1 and '#image("template-examples/1.png.png"' in text and view['fileData'].get('template-examples/1.png.png') == PICTURE,
               f'{syntax_name}: example view: the example picture is among the compiler\'s files under a name of its own')


with open(os.path.join(HERE, 'letter-template.typ'), encoding='utf-8') as fixture:
    LETTER = fixture.read()
with open(os.path.join(HERE, 'letter-template-angle.typ'), encoding='utf-8') as fixture:
    ANGLE = fixture.read()
CODE = 'Dear {{name}},\n#let total = {{total}}\n#let items = ({{#items}}"{{label}}", {{/items}})\n'
BROKEN = 'Dear {{name}},\n\n{{#hasNote}}\nA note.\n\n{{/items}}\n'
PICTURES = '#image("{{logo}}")\n#image("img/{{photo}}.JPG")\n#image("own-{{x}}.png")\n#image("plain.png")\n#csv("{{data}}.csv")\n'
LITERALS = '$ "a $ {{name}}" + x /* " */ $\n#let a = "first\n{{city}}"\n#let b = `{{street}}`\n#"{{note}}" and $ /* " */ {{total}} $\n'
OWN = {'own-{{x}}.png': 'data:image/png;base64,AAAA'}
TAKEN = {'template-examples/1.png': 'data:image/png;base64,AAAA'}

(letter, letter_off, angle, code_case, broken, pictures, pictures_off, literals), writes = run_report([
    {'code': LETTER, 'template': 'mustache', 'examples': EXAMPLES}, {'code': LETTER, 'template': None}, {'code': ANGLE, 'template': 'angle', 'examples': EXAMPLES},
    {'code': CODE, 'template': 'mustache'}, {'code': BROKEN, 'template': 'mustache'},
    {'code': PICTURES, 'template': 'mustache', 'files': OWN}, {'code': PICTURES, 'template': None, 'files': OWN},
    {'code': LITERALS, 'template': 'mustache'}])
(taken,), _ = run_report([{'code': '#image("{{logo}}")\n#image("template-examples/1.png")\n', 'template': 'mustache', 'files': TAKEN, 'examples': EXAMPLES}])

print('-- the letter template (mustache)')
check_letter(letter, LETTER, 'mustache', lambda sign, name: '{{' + sign + name + '}}')

print('-- the letter template (angle)')
check_letter(angle, ANGLE, 'angle', lambda sign, name: '<<' + ('?' if sign == '#' else sign) + name + '>>')

print('-- escaping for each kind of code')
check_that(writes['markup'] == 'A "b" \\\\ \\#c \\*d\\* \\`e\\` \\*\\/ \\<f\\> \\@g\\ h', f'markup: special characters with a backslash, a line break as Typst\'s ({writes["markup"]!r})')
check_that(writes['math'] == writes['code'] == '"A \\"b\\" \\\\ #c *d* `e` */ <f> @g h"', f'math and code: a string ({writes["math"]!r})')
check_that(writes['string'] == 'A \\"b\\" \\\\ #c *d* `e` */ <f> @g\\nh', f'string: quotes, backslashes and line breaks escaped ({writes["string"]!r})')
check_that(writes['comment'] == 'A "b" \\ #c *d* `e` * / <f> @g h' and writes['raw'] == 'A "b" \\ #c *d* e */ <f> @g\nh', f'comment and raw text: nothing that ends them ({writes["comment"]!r}, {writes["raw"]!r})')

check_that(writes['nestedComment'] == 'a / * b * / c', f'comment: neither an opening nor a closing comment mark stays ({writes["nestedComment"]!r})')

print('-- the compiler\'s result led back to the code')
converted = letter['converted']
check_that(converted['problems'][0]['pos'] == len(LETTER) and converted['problems'][0]['line'] == LETTER.count('\n') + 1, f'a problem at the end of the example view is at the end of the code {converted["problems"][0]}')
copied = ''.join(LETTER[start:end] for start, end, kind in converted['ast']['text'])
check_that('{{' not in copied and 'Dear ' in copied and all(LETTER[start:end] in letter['example']['text'] for start, end, kind in converted['ast']['text']), 'the plain text of the syntax tree keeps only copied text, at its places in the code')

print('-- a value in code')
total_at = CODE.index('{{total}}')
check_that(code_case['problems'] == [{'kind': 'error', 'msg': 'Write the placeholder in code as a string: "{{total}}"', 'hints': [], 'pos': total_at, 'end': total_at + 9,
                                     'line': 2, 'col': 14, 'file': '', 'isEditorText': True}], f'a value in code is reported at the tag {code_case["problems"]}')
check_that('#let total = "{{total}}"' in code_case['template']['text'] and '#let total = "[total]"' in code_case['example']['text'], 'a value in code is a string in both views')
check_that(get_contexts(code_case).get('{{label}}') == {'string'} and get_contexts(code_case).get('{{#items}}') == {'code'}, 'a value in a string of code is fine, a section in code is a comment in the template view')

print('-- literals')
check_that(get_contexts(literals) == {'{{name}}': {'string'}, '{{city}}': {'string'}, '{{street}}': {'raw'}, '{{note}}': {'string'}, '{{total}}': {'math'}} and literals['problems'] == [],
           f'a string in math, a string across lines, raw text in code and #"…" keep their tags; a comment in math leaves the math {get_contexts(literals)}')
total_at = LITERALS.index('{{total}}')
check_that(literals['template']['text'][:total_at] == LITERALS[:total_at], 'template view: the strings, raw text and comments read as written')

print('-- placeholder errors')
expected = [{'kind': 'error', 'msg': 'The section {{#hasNote}} stays open - add {{/hasNote}}', 'hints': [], 'pos': BROKEN.index('{{#hasNote}}'), 'end': BROKEN.index('{{#hasNote}}') + 12, 'line': 3, 'col': 1, 'file': '', 'isEditorText': True},
            {'kind': 'error', 'msg': '{{/items}} is a stray end tag - remove it or add {{#items}} before it', 'hints': [], 'pos': BROKEN.index('{{/items}}'), 'end': BROKEN.index('{{/items}}') + 10, 'line': 6, 'col': 1, 'file': '', 'isEditorText': True}]
check_that(broken['problems'] == expected, f'a section left open and a stray end tag in the shape of the compiler\'s problems: {broken["problems"]}')
check_that('{{' not in broken['example']['text'] and '\\{\\{\\#hasNote\\}\\}' in broken['template']['text'], 'with broken sections both views are made: no tag in the example view, the tags as text in the template view')

print('-- pictures')
files = pictures['template']['files']
check_that(files.get('{{logo}}', '').startswith('data:image/svg+xml') and files.get('img/{{photo}}.JPG') == 'data:image/jpeg;base64',
           f'template view: a placeholder picture of the format of the file name ({files})')
check_that(pictures['template']['filesKept'] and 'plain.png' not in files and '{{data}}.csv' not in files, 'template view: the document\'s own files stay; other files are reported by the compiler')
files = pictures['example']['files']
check_that(files.get('[logo]', '').startswith('data:image/svg+xml') and files.get('img/[photo].JPG') == 'data:image/jpeg;base64' and pictures['example']['filesKept'],
           f'example view: a picture whose file name holds filled text gets a placeholder picture, the document\'s files stay ({files})')

check_that('#image("template-examples/2.png")' in taken['example']['text'] and taken['example']['fileData']['template-examples/2.png'] == PICTURE and taken['example']['filesKept'],
           'example view: the name of an example picture is one no file of the document has')

print('-- option off')
check_that(letter_off['problems'] == [] and letter_off['tags'] == [] and 'example' not in letter_off, 'option off: no tag is read and no view is made')
check_that(letter_off['highlighted'] == letter_off['plainHighlighted'], 'option off: the plain Typst highlighting')

print(f'\n{len(failed)} failed' if failed else '\nall passed')
sys.exit(1 if failed else 0)
