# PvPoke PHP → static HTML/JS conversion spec

Read this fully before converting anything. Every agent follows it so the output
stays consistent.

## What we are building

`src/` is becoming a **pure static site**: HTML + CSS + vanilla JS + JSON, served
by any dumb file server (`python -m http.server`, nginx, GitHub Pages, Netlify).
**No PHP, no build step at runtime, no database.**

`pages/` holds the *sources* for the HTML pages. `tools/build.mjs` expands include
markers and writes finished `.html` files into `src/`. The generated files are
committed, so serving `src/` requires nothing but a file server.

## Global URL mapping

`src/.htaccess` used to rewrite pretty URLs into query strings via Apache. That
rewriting now lives in `src/js/Router.js` (read it — it is the source of truth for
parameter names). Rewrite internal links like this:

| Old pretty URL            | New static link                              |
| ------------------------- | -------------------------------------------- |
| `$WEB_ROOT + 'battle/'`   | `/battle.html`                               |
| `$WEB_ROOT + 'rankings/'` | `/rankings.html`                             |
| `$WEB_ROOT + 'team-builder/'` | `/team-builder.html`                     |
| `$WEB_ROOT + 'train/'`    | `/train/index.html`                          |
| `$WEB_ROOT + 'train/analysis/'` | `/train/analysis.html`                |
| `$WEB_ROOT + 'tera/'`     | `/tera/index.html`                           |
| `$WEB_ROOT + 'moves/'`    | `/moves.html`                                |
| `$WEB_ROOT + 'articles/'` | `/articles/index.html`                       |
| `$WEB_ROOT + 'settings/'` | `/settings.html`                             |
| `$WEB_ROOT + 'contact/'`  | `/contact.html`                              |
| `$WEB_ROOT + 'privacy/'`  | `/privacy.html`                              |
| `$WEB_ROOT + 'custom-rankings/'` | `/custom-rankings.html`              |
| `$WEB_ROOT + 'attack-cmp-chart/'` | `/attack-cmp-chart.html`          |
| `$WEB_ROOT + 'gm-editor/'`| `/gm-editor/index.html`                      |
| `$WEB_ROOT + 'rss/'`      | `/rss/feed.xml`                              |

In **markup**, link to the bare `.html` file. Do **not** invent query strings for
parameterized pages in static HTML — the page's own JS reads `get` on load and
fills in the controls. Only add a query string when the original page did
(some pages have hardcoded variants).

## Page source format

```html
<!-- title: Battle | PvPoke -->
<!-- description: Simulate battles between two or more Pokemon. -->
<!-- sel: battle -->
<!-- css: train.css -->

<!--#include header-->

    ...page markup...

    <script src="/js/GameMaster.js"></script>

<!--#include footer-->
```

Directives are plain HTML comments, one per line, at the very top of the file.
Values:

- `title` — the `$META_TITLE` the page passed to `header.php`, minus the
  ` | PvPoke` suffix the header added. Omit to use the site default.
- `description` — `$META_DESCRIPTION`. Omit to use the site default.
- `canonical` — only if the original set `$CANONICAL`. Usually omit.
- `sel` — which top-level nav item to highlight: `battle`, `rankings`,
  `team-builder`, or `train`. Multiple allowed, space separated.
- `css` — extra stylesheet. Only `train.css` (train pages) and
  `article-extras.css` (article pages) exist.

`<!--#include header-->` replaces the page's `require_once 'header.php'`.
`<!--#include footer-->` replaces its `require_once 'footer.php'`.
Everything between them is the page's own body markup.

## Converting PHP to HTML

Work through the source file top to bottom.

1. **Nested includes get inlined.** If the page does
   `<?php require 'modules/pokeselect.php'; ?>`, copy that module's *body
   markup* into the page at that spot, recursively. Modules live in `src/modules/`.
   Do not leave any include markers other than header/footer.

2. **`<?php echo $WEB_ROOT; ?>` → `/`**, and `<?php echo $HOST; ?>` /
   `<?php echo $_SERVER['HTTP_HOST']; ?>` → drop the attribute if it only built
   an absolute URL (static markup should use root-relative paths).

3. **`<?php echo $SITE_VERSION; ?>` in a `?v=` cache-buster → drop it.**
   The header partial already emits `?v={{VERSION}}` for shared scripts, and the
   build validates that no template tokens leak through. For *page-level*
   `<script>` tags, write a plain `src="/js/Foo.js"` with no `?v=`.

4. **Conditionals on settings, drop the branch, keep the markup:**
   - `<?php if($_SETTINGS->ads == 1) : ?>…<?php endif; ?>` → keep the inside.
     (All ad modules are empty in this repo, so these usually vanish entirely.)
   - `<?php if(strpos($_SERVER['REQUEST_URI'], 'articles') !== false): ?>` →
     keep, and add `<!-- css: article-extras.css -->` to the page.
   - `<?php if($_SETTINGS->colorblindMode == 1): ?>class="colorblind"<?php endif; ?>`
     → drop the attribute; `Boot.js` applies the class at runtime.
   - `<?php if($_SETTINGS->theme == 'night'): ?>` / `!= "default"` → drop the
     branch, keep the markup. `Boot.js`/`BootPost.js` handle it at runtime.
   - `<?php if($_SETTINGS->gamemaster != "gamemaster"): ?>` → keep, and give the
     element `id="custom-gm-banner"` plus `style="display:none"` if it is the
     custom-gamemaster banner, since `BootPost.js` shows it. If the header
     already contains the banner, just delete this duplicate block.
   - Any `if(false)` block → delete entirely.

5. **`<?php if(isset($META_TITLE)) … else … ?>`** → the `<!-- title: -->` directive.

6. **`$_GET` used to vary markup** → move the logic into the page's JS, or delete
   it if the page's existing interface JS already covers it. Report anything you
   are unsure about rather than guessing.

7. **Remove every `<?php … ?>` block.** The finished page must contain zero PHP.
   Grep your own output to confirm.

8. **Keep all other markup byte-for-byte** — classes, ids, `data-` attributes,
   inline `<script>` blocks, whitespace inside markup. The JS selects on those and
   a stray edit breaks the page silently.

9. **Script tags at the bottom of the body stay in the same order.** Load order
   matters: `GameMaster.js`, then models, then interface, then `Main.js`.

## Script tags

The header partial already loads, in order: jQuery, `Router.js`, `Boot.js`,
`RSSReader.js`, `BootPost.js`. So a page body never needs to repeat those.

`modules/scripts/battle-scripts.php` is just this list, in this order:

```html
<script src="/js/battle/DamageCalculator.js"></script>
<script src="/js/battle/actions/ActionLogic.js"></script>
<script src="/js/battle/timeline/TimelineEvent.js"></script>
<script src="/js/battle/timeline/TimelineAction.js"></script>
<script src="/js/training/DecisionOption.js"></script>
<script src="/js/battle/Battle.js"></script>
```

`modules/scripts/train-scripts.php` is a similar list — read it and inline it.

## What to do with server endpoints

There are no PHP endpoints in the final site. If a converted page's JS referenced
one, leave the JS alone — it is being patched separately — but **note it in your
report**.

## Where files go

- `src/battle.php` → `pages/battle.html`
- `src/train/analysis.php` → `pages/train/analysis.html`
- `src/articles/community-day/23-01-chespin.php` → `pages/articles/community-day/23-01-chespin.html`
- `src/gm-editor/index.php` → `pages/gm-editor/index.html`

Mirror the path under `src/`, swapping `.php` for `.html`.

## Verify before you finish

- No `<?php` and no `?>` anywhere in the file you produced.
- No `require`, `include`, `$WEB_ROOT`, `$_GET`, `$_COOKIE`, `$_SETTINGS`,
  `$_SERVER`, `$SITE_VERSION`, `$META_` left.
- Every `href`/`src` that pointed at a PHP file now points at a real static file
  that exists (or will exist) in `src/`.
- Report anything you had to guess.

## Tooling

Everything under `tools/` is development-time only. Its output is committed, so
the site itself still needs nothing but a file server.

| Script                    | What it does                                              |
| ------------------------- | --------------------------------------------------------- |
| `build.mjs`               | Expands include markers and writes `src/*.html`.          |
| `inline-modules.mjs`      | One-time codemod: pastes module bodies into their pages.   |
| `patch-links.mjs`         | One-time codemod: rewrites `host + path` into `url(path)`. |
| `patch-settings.mjs`      | One-time codemod: replaces the settings cookie endpoint.    |
| `serve.mjs`               | Serves `src/` over HTTP for local preview.                  |
| `check-links.mjs`         | Flags internal references that 404.                        |
| `check-scripts.mjs`       | Flags duplicate and misordered `<script src>`.              |
| `smoke.mjs`               | Loads each page in headless Chrome, fails on any error.     |
| `check-render.mjs`        | Asserts each page actually populates its results.           |
| `check-sim.mjs`           | Runs a real battle and asserts the ratings are sane.        |
| `verify.mjs`              | Runs all of the above in order.                             |

Typical loop:

```bash
node tools/serve.mjs &          # preview at http://localhost:8000/
node tools/build.mjs            # regenerate src/ after editing pages/
node tools/verify.mjs           # static checks
node tools/verify.mjs --browser # plus the headless-Chrome checks
```

`verify.mjs --browser` needs the server running (`SMOKE_BASE` overrides the
port) and finds Chrome automatically on Windows, macOS, and Linux; set
`CHROME_PATH` if it lives somewhere unusual.

The browser checks matter because a static conversion has failure modes the
generated HTML cannot show you: a script 404 is invisible until the page tries to
use it, and a reloaded `class` declaration throws only once the browser parses
it.
