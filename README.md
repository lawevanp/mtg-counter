# MTG Life Counter

A simple, phone-friendly life counter for Magic: The Gathering. No build step, no dependencies —
just static files. Works offline once installed.

## Features
- Life totals: big −/+ buttons, −5/−10/+5/+10, or type any amount and tap **Lose**/**Gain**
  (pressing Enter in the amount box counts as Lose)
- Running "−6" style indicator so you can see the total of a quick series of taps
- Poison counters (player is greyed out at 0 life or 10 poison)
- 1–6 players, starting life 20 / 25 / 30 / 40 / custom, random "who goes first"
- Creatures: card search with autocomplete (Scryfall) that fills in power/toughness and art,
  or type any name + stats manually (good for tokens)
  - +1/+1 and −1/−1 counters (they cancel each other out, per the rules)
  - Until-end-of-turn pumps, cleared with **End turn**
  - Extra counters (shield, stun, flying, custom…), tap/untap, copy, remove
  - Tap the card art to see the full card and its rules text
- "Screen on" keeps your phone from sleeping mid-game
- Game state saves automatically, so a refresh or closing the app won't lose it

## Getting it on your phone
Installable web apps need to be served over **HTTPS**. Easiest free options:

- **Netlify Drop**: go to https://app.netlify.com/drop and drag this folder onto the page.
- **GitHub Pages**: push this folder to a repo → Settings → Pages → deploy from the main branch.
- **Cloudflare Pages**: create a project and upload this folder.

Then open the URL on your phone:
- **Android (Chrome)**: tap the **Install** button in the app's header, or ⋮ menu → *Install app*.
- **iPhone (Safari)**: Share button → *Add to Home Screen*.

To try it on your computer, just open `index.html` in a browser (offline caching and install
only work once it's hosted).

## Updating
After changing files, bump `CACHE_VERSION` in `sw.js`, then redeploy.

Card data and images are provided by [Scryfall](https://scryfall.com). This is an unofficial fan tool, not
affiliated with Wizards of the Coast.
