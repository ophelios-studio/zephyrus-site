# Zephyrus site

The Zephyrus showcase and documentation preview, built with **Zephyrus Leaf**. This is a standalone static site. It does not modify or depend on the working checkout of `zephyrus-core`.

## Preview

Requires the Leaf CLI and PHP 8.4+ with the extensions required by Leaf.

```sh
leaf dev --addr 127.0.0.1:4173
```

Open `http://127.0.0.1:4173` for English or `http://127.0.0.1:4173/fr/` for French. English is the default, without a URL prefix. Leaf rebuilds and reloads when content, templates or assets change.

## Build

```sh
leaf build
```

The deployable output is `dist/`. All styles, scripts and fonts are served locally. No CDN or frontend bundler is required. Set `leaf.production_url` in `config.yml` once the production domain is chosen, then rebuild to generate canonical links, the sitemap and robots file.

Stop `leaf dev` before running a separate `leaf build`, since both commands publish into `dist/`.

## Editing

- `templates/landing.latte`: landing composition.
- `locale/en/general.json` and `locale/fr/general.json`: interface copy, metadata and interactive labels, rendered with Leaf's native localization.
- `templates/layouts/` and `templates/partials/`: shared shell and navigation.
- `templates/docs/page.latte`: Markdown article layout.
- `content/`: English documentation pages with YAML front matter. Their French counterparts live in `content/fr/`. Leaf generates navigation, page order, the table of contents and a search index for each language.
- `public/assets/css/site.css`: design tokens, typography and responsive layouts.
- `public/assets/css/extensions.css`: language selector, localization demo, developer features, agent skill, Web3 roadmap and interactive closing CTA.
- `public/assets/js/wind.js`: the animated canvas ribbon. It responds to the pointer, pauses outside the viewport, supports the pause button and respects reduced motion.
- `public/assets/js/pixels.js`: the closing CTA's pixel logo. Pointer or touch movement scatters its particles, which spring back into the original brand path. It pauses outside the viewport and supports pause and reduced motion.
- `public/assets/js/site.js`: tabs, copy buttons, search, accordions and mobile navigation.

The documentation is deliberately a **visual preview**. Examples are illustrative. Setup instructions and the full API reference should be finalized after the core update.

The landing highlights capabilities verified in the core: JSON translation catalogs and regional fallback, explicit SQL Brokers, environment-scoped routes, constructor injection, composable guards and generator-based Server-Sent Events. Web3 access to smart contracts is presented separately as a coming-soon direction, without a release date or invented API.

The agent section links to the [Zephyrus skill](https://github.com/ophelios-studio/skills/tree/main/skills/zephyrus). Its standard installation command is:

```sh
npx skills add ophelios-studio/skills --skill zephyrus
```

The language switch preserves the current chapter and hash. Search uses the current locale and ignores accents.

## Browser verification

The QA tools require Node.js, Playwright and its Chromium browser. Install them if unavailable:

```sh
npm install
npx playwright install chromium
```

With the preview server running:

```sh
npm run qa
npm run capture
```

QA verifies both languages, all documentation destinations, locale switching and search, clipboard commands, responsive overflow, canvas animation and reduced motion. It also checks pixel dispersal, silhouette reconstruction, pause and touch behavior in the closing CTA. Captures include both languages on desktop, tablet and mobile, plus the developer, roadmap and CTA sections. They are saved to the ignored `artifacts/` directory. To test another local server, set `PREVIEW_URL`.

## Social image

```sh
npm run social
leaf build
```

This produces `public/assets/images/og.png` and `og-fr.png` from each localized hero, then includes them in the static output. Fonts are distributed with their SIL Open Font License files under `public/assets/fonts/`.

## Commits

Use a Conventional Commits subject only. Commit messages must have no body and no co-author or attribution trailers.
