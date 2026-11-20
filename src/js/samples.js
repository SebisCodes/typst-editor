/**
 * The documents the editor starts from: the empty page of a new document, the welcome
 * example of the first visit and the templates of the "New" menu.
 */

/**
 * A document the editor can start from.
 * @typedef {object} Sample
 * @property {string} name - the name the new document gets.
 * @property {string} code - its Typst code.
 */

/** The code of a new empty document: an A4 page in English. */
export const BLANK = `#set page(paper: "a4")
#set text(lang: "en")

`;

/**
 * The welcome example, the first document of a first visit.
 * @type {Sample}
 */
export const START = {
    name: 'Welcome',
    code: `#set document(title: "Welcome to the Typst Editor")
#set page(paper: "a4", numbering: "1")
#set text(size: 11pt, lang: "en")
#set par(justify: true)
#set heading(numbering: "1.")

#align(center, text(18pt)[*Welcome to the Typst Editor*])

Write Typst on the left and see the pages here as you type. Click any text on the page to change it right there, or to jump to its place in the code.

= What it can do
- Headings, lists, *bold*, _italic_ and \`code\`
- Math: $a^2 + b^2 = c^2$, and displayed:
  $ sum_(k=1)^n k = (n(n+1)) / 2 $
- Tables and figures with captions, like @prices.

#figure(
  table(
    columns: 3,
    align: (left, right, right),
    table.header[*Fruit*][*Count*][*Price*],
    [Apples], [3], [2.40],
    [Pears], [5], [4.50],
  ),
  caption: [A small table],
) <prices>

= Pictures and files
Add pictures in the _Pictures_ tab and use them with \`#image("name.png")\`. Data files such as CSV or JSON work too.#footnote[Everything stays in your browser.]

The _Document_ tab sets paper, font, margins and numbering; _Export_ makes a PDF.
`,
};

/**
 * The templates of the "New" menu, by the key of their menu entry (data-new).
 * @type {Object<string, Sample>}
 */
export const TEMPLATES = {
    article: {
        name: 'Article',
        code: `#set document(title: "The Title of the Article", author: "Your Name")
#set page(paper: "a4", margin: 2.5cm, numbering: "1")
#set text(size: 11pt, lang: "en")
#set par(justify: true)
#set heading(numbering: "1.")

#align(center)[
  #text(17pt)[*The Title of the Article*] \\
  #v(0.4em)
  Your Name \\
  #datetime.today().display("[day] [month repr:long] [year]")
]

#block(inset: (x: 2em))[
  *Abstract.* A short summary of the article: what it is about, what was done and what came out of it.
]

= Introduction
Start writing here. Refer to sections with labels, like @method.

= Method <method>
Describe how it was done.

$ E = m c^2 $

= Results
#figure(
  table(columns: 2, [*Measure*], [*Value*], [A], [1.2], [B], [3.4]),
  caption: [The results],
)

= Conclusion
What it means.
`,
    },
    letter: {
        name: 'Letter',
        code: `#set page(paper: "a4", margin: (left: 2.5cm, right: 2cm, top: 2cm, bottom: 2cm))
#set text(size: 11pt, lang: "en")
#set par(justify: false)

Jane Sender \\
Main Street 1 \\
8000 Zurich

#v(2cm)

Mr John Receiver \\
Example Ltd \\
Station Road 12 \\
3000 Bern

#v(1cm)
#align(right)[Zurich, #datetime.today().display("[day] [month repr:long] [year]")]

#v(0.5cm)
*Subject of the letter*

Dear Mr Receiver,

Write the letter here.

Kind regards

#v(1.5cm)
Jane Sender
`,
    },
    exercise: {
        name: 'Exercise sheet',
        code: `#set page(paper: "a4", margin: 2cm, numbering: "1",
  header: [_Mathematics_ #h(1fr) Exercise sheet 1])
#set text(size: 11pt, lang: "en")
#set enum(numbering: "a)")

#let task(n, body) = block(above: 1.2em)[*Exercise #n.* #body]

#task(1)[
  Solve the equations:
  + $x^2 - 5x + 6 = 0$
  + $2^x = 32$
]

#task(2)[
  Compute $integral_0^1 x^2 dif x$.
]

== Solutions
+ $x_1 = 2$, $x_2 = 3$; and $x = 5$.
+ $integral_0^1 x^2 dif x = [x^3 / 3]_0^1 = 1/3$

\`\`\`python
def f(x):
    return x ** 2
\`\`\`
`,
    },
    social: {
        name: 'Social media post',
        code: `#set page(width: 120mm, height: 120mm, margin: 10mm, fill: rgb("#14213d"))
#set text(fill: white, size: 14pt)

#align(center + horizon)[
  #text(36pt, weight: "bold", fill: rgb("#fca311"))[Big news]
  #v(4mm)
  #text(18pt)[Something worth sharing]
  #v(8mm)
  #box(fill: rgb("#fca311"), inset: 3mm, radius: 2mm)[
    #text(fill: rgb("#14213d"), weight: "bold")[example.com]
  ]
]
`,
    },
};
