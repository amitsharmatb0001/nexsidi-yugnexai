---
name: landing-page
description: Use when building the public home or landing page of an app — a composed page that sells the product, not a hero and three cards.
agents: [aanya, vanya]
keywords: [landing, home page, homepage, hero, marketing, website, get started, public page]
---

# Landing page

A real first draft scored 5.95 out of 10 on design review: a centred hero
and three identical text cards, no imagery. A landing page must show the
product and make one action obvious.

## Composition
1. Hero: one sentence of value in the user's words, one primary button
   (Get Started) and one secondary (Sign In), and a real product preview
   built from the app's own components with sample data — a dashboard
   card, an invoice, a list row. Never a stock photo, gradient blob or
   empty box.
2. At least three more sections, each with a DIFFERENT layout, for example:
   how it works (numbered steps, because order matters), a feature split
   (text beside a preview), proof (numbers, who it is for), a closing call
   to action.
3. Footer with the product name and the essential links.

## Craft
- Content specific to this app's domain — nothing that could be pasted
  into another product unchanged.
- One accent colour for actions; everything else from the palette.
- Generous spacing on the 4 px grid; clear type scale with
  var(--font-display) for headings.
- Signed-in visitors go to /dashboard (middleware), so the landing page
  only serves signed-out visitors.
