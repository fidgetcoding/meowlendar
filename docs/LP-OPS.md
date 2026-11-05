# meowlendar.com: landing page ops

The marketing site lives in `apps/site/`: plain HTML, CSS and JS, no build step, no dependencies. This file keeps the optimization loop (the landing-ab ladder: L1 static, L2 watch, L3 test, L4 auto-iterate, L5 personalize) and the deploy notes in one place.

## Status

| Level | State |
|---|---|
| L1 Static | Done. Home `/` and Setup `/setup/`. |
| L2 Watch | Wired, **inactive until the PostHog key is in** (see Owed). |
| L3 Test | Pre-wired: `landing-ab` flag stub and `class="signup-cta"` on "Set it up". |
| L4 Auto-iterate | Not set up. |
| L5 Personalize | Not set up. Needs a consent banner first. |

## Owed

- **PostHog project key and region.** Both pages carry the snippet in `<head>` with `KEY = '<YOUR_PROJECT_KEY>'` and `HOST = 'https://us.i.posthog.com'`. While the key is the placeholder the snippet returns early, so nothing loads and nothing is sent. To turn it on, put the key into both files (and switch `HOST` to `https://eu.i.posthog.com` if the project is in the EU; a key/region mismatch returns 401s and no data):

  ```sh
  cd apps/site
  sed -i '' "s/<YOUR_PROJECT_KEY>/phc_XXXX/" index.html setup/index.html
  ```

- **Domain.** Point meowlendar.com at the Vercel project below.

## Layout

```
apps/site/
  index.html            Home
  setup/index.html      Setup
  assets/site.css       all styles (light only, never follows OS dark mode)
  assets/site.js        hook fitting, hero grid sizing, wires, intro, reveals, Copy buttons
  assets/favicon.svg, favicon-32.png, apple-touch-icon.png, og-image.png
  scripts/              og.html, apple-touch-icon.svg, render-assets.py (not deployed)
  vercel.json, .vercelignore
```

The copy and look come from the locked r4 design (`WORK/MEOWLENDAR-LAB/r4/FINAL.md`, copy from its `kit/content.js`, logo from `kit/brand.js`), baked into the HTML. Edit the HTML directly from here on. Copy rules: never name other calendar products, no "Why I made it", no Log in (there is no hosted Meowlendar), no em or en dashes.

### Run it locally

```sh
cd apps/site && python3 -m http.server 8794 --bind 127.0.0.1
# open http://127.0.0.1:8794/ and http://127.0.0.1:8794/setup/
```

### Re-render the PNG assets

After changing the hook, the wordmark or the colours, regenerate the PNGs (Python Playwright, server from the step above running):

```sh
python3 apps/site/scripts/render-assets.py
```

## Deploy (Vercel)

1. New Vercel project from `fidgetcoding/meowlendar`, **Root Directory `apps/site`**, Framework Preset **Other**. Leave the build command empty. It must be a separate project from the app (the repo-root `vercel.json` builds `apps/web`).
2. `apps/site/vercel.json` skips the install step (`installCommand: ""`), so the pnpm monorepo is never installed for this static site. `cleanUrls` and `trailingSlash: true` serve `/setup/` and redirect `/setup` to it.
3. Add the domains `meowlendar.com` and `www.meowlendar.com` (redirect www to the apex). Canonical, Open Graph and Twitter tags already point at `https://meowlendar.com`.
4. After the first deploy: open both pages, check the console is clean, and paste the URL into a link previewer to confirm the OG image.

## The primary CTA

"Set it up" (`a.signup-cta`, links to `/setup/`) appears twice on Home: the periwinkle button in the hero, and the white button in the "I'm not hosting this for you." panel. Both carry `signup-cta`, so an experiment that targets `.signup-cta` changes both. Target `.hero .signup-cta` to test the hero button alone.

## L2: Watch

Already in the snippet: `defaults: '2026-05-30'` and `capture_heatmaps: true` (the current name for the deprecated `enable_heatmaps`). Turn on session replay and heatmaps in the PostHog project settings. Let it collect for a week before reading anything.

## L3: Run an A/B test

Add `disable_web_experiments: false` to the `posthog.init` options on both pages, then PostHog Toolbar, Experiment, New, pick `signup-cta`, edit variant B, set the primary metric (clicks on `.signup-cta`, or `/setup/` pageviews), Launch (auto 50/50).

Call it ONLY at **95%+ chance to win AND 50 or more exposures per variant**. Set the run length BEFORE launch and don't peek: early stops ship false winners.

For a change the toolbar can't make, use the flag stub already in the snippet:

```js
posthog.onFeatureFlags(function () {
  if (posthog.getFeatureFlag('landing-ab') === 'test') {
    // version B
  }
})
```

## L4: Weekly optimizer loop

Connect the PostHog MCP read-only:

```sh
claude mcp add --transport http posthog "https://mcp.posthog.com/mcp?readonly=true" -s user
```

Weekly agent prompt:

```
You're my landing-page optimizer. Using the PostHog MCP (read-only), pull results
for experiment 'landing-ab'. If a variant has >95% chance to win and >=50
exposures/variant, reply with: the winner, the % lift, and ONE specific change to
test next. Wait for my "approved". On approval, edit apps/site in GitHub repo
fidgetcoding/meowlendar, open a PR, summarize. Never merge without my approval.
```

Schedule it with a GitHub Actions cron (Claude Code headless). Keep the human approval gate; write access only on the deploy step.

## L5: Personalize

Capture interest signals (`posthog.capture('viewed_setup')`), build a dynamic cohort ("performed X in the last 30 days"), then a multivariate flag `lp-personalize` with a JSON payload per variant, released to that cohort:

```js
posthog.onFeatureFlags(function () {
  const r = posthog.getFeatureFlagResult('lp-personalize')
  if (r?.payload) applyContent(r.payload)  // payload = { hero, cta, showPricing }
})
```

GDPR: cookies and GeoIP are personal data, so a consent banner comes before L5. Each cohort needs real volume before a tailored variant can be trusted.
