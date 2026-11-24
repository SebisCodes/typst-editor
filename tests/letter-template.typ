// An order letter with placeholders; the server fills them in comments too: {{name}}.
// Example values: John Doe, 1 Main Street, 8000 Springfield.
#set page(paper: "a4", margin: 25mm)
#set text(lang: "en", size: 11pt)
#let customer = "{{customerNumber}}"

#image("{{logo}}.png", width: 30mm)

{{name}} \
{{street}} \
{{postalCode}} {{city}}

#align(right)[{{date}}]

= Your order {{orderNumber}}

Dear {{name}},

thank you for your order. These items are on their way to *{{city}}*:

#table(
  columns: 3,
  [*Item*], [*Quantity*], [*Price*],
{{#items}}
  [{{label}}], [{{quantity}}], ["{{price}}"],
{{/items}}
)

The total of $sum p_i = {{total}}$ includes tax. Your customer number is #customer, as `{{customerNumber}}` in our system.

{{#hasNote}}
_Note:_ {{note}}
{{/hasNote}}
{{^hasNote}}
If you have questions, simply reply to this letter or #link("{{trackingLink}}")[track your parcel].
{{/hasNote}}

Kind regards \
{{senderName}}
