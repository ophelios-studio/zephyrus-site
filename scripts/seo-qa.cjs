const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
const production = 'https://zephyrus.ophelios.com';
const chapters = ['getting-started/introduction', 'getting-started/project-structure', 'fundamentals/routing', 'fundamentals/http', 'fundamentals/configuration', 'fundamentals/localization', 'fundamentals/data', 'fundamentals/security'];
(async () => {
  const browser = await chromium.launch({ headless: true });
  const checked = [], titles = new Set(), descriptions = new Set();
  try {
    const page = await browser.newPage();
    for (const locale of ['en', 'fr']) {
      const prefix = locale === 'en' ? '' : '/fr';
      for (const chapter of ['', ...chapters]) {
        const path = prefix + '/' + (chapter ? chapter + '/' : '');
        const response = await page.goto(base + path, { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200);
        const meta = await page.evaluate(() => {
          const get = key => document.querySelector(`meta[name="${key}"], meta[property="${key}"]`)?.content;
          return { title: document.title, description: get('description'), lang: document.documentElement.lang, robots: get('robots'), canonical: document.querySelector('link[rel=canonical]')?.href,
            alternates: Object.fromEntries([...document.querySelectorAll('link[hreflang]')].map(link => [link.hreflang, link.href])),
            url: get('og:url'), image: get('og:image'), imageAlt: get('og:image:alt'), imageType: get('og:image:type'), ogLocale: get('og:locale'), twitterImage: get('twitter:image'), twitterTitle: get('twitter:title'), twitterDescription: get('twitter:description'), twitterCard: get('twitter:card'),
            h1Count: document.querySelectorAll('h1').length, schema: JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent), headers: [...document.querySelectorAll('h1,h2,h3,h4')].map(heading => heading.textContent.trim()) };
        });
        assert.equal(meta.lang, locale);
        assert.equal(meta.h1Count, 1, 'One main heading: ' + path);
        assert(meta.description.length >= 40 && meta.description.length <= 180, 'Useful description: ' + path);
        // Sibling translations may share technical chapter names, but locale appears in the title.
        assert(!titles.has(meta.title), 'Unique title: ' + path);
        assert(!descriptions.has(meta.description), 'Unique description: ' + path);
        titles.add(meta.title); descriptions.add(meta.description);
        assert.equal(meta.canonical, production + path);
        assert.equal(meta.url, meta.canonical);
        const suffix = '/' + (chapter ? chapter + '/' : '');
        assert.deepEqual(meta.alternates, { en: production + suffix, fr: production + '/fr' + suffix, 'x-default': production + suffix });
        assert.equal(meta.image, production + '/assets/images/' + (locale === 'fr' ? 'og-fr' : 'og') + '.png');
        assert.equal(meta.image, meta.twitterImage);
        assert.equal(meta.imageType, 'image/png');
        assert(meta.imageAlt && meta.imageAlt.length > 25);
        assert.equal(meta.twitterTitle, meta.title);
        assert.equal(meta.twitterDescription, meta.description);
        assert.equal(meta.twitterCard, 'summary_large_image');
        assert(meta.robots.includes('index, follow'));
        assert.equal(meta.schema['@context'], 'https://schema.org');
        const graph = meta.schema['@graph'];
        assert(graph.some(entity => entity['@type'] === 'SoftwareSourceCode' && entity.codeRepository === 'https://github.com/zephyrus-framework/core'));
        const webPage = graph.find(entity => entity['@type'] === 'WebPage');
        assert.equal(webPage.url, meta.canonical);
        assert.equal(webPage.inLanguage, locale);
        if (chapter) assert.equal(graph.find(entity => entity['@type'] === 'BreadcrumbList').itemListElement.at(-1).item, meta.canonical);
        checked.push(path);
      }
      for (const filename of [locale === 'fr' ? 'og-fr.png' : 'og.png']) {
        const image = await page.request.get(base + '/assets/images/' + filename);
        assert.equal(image.status(), 200);
        const png = await image.body();
        assert.equal(png.readUInt32BE(16), 1200);
        assert.equal(png.readUInt32BE(20), 630);
      }
      await page.goto(base + (locale === 'fr' ? '/fr/404/' : '/404.html'));
      assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex, follow');
      assert.equal(await page.locator('link[rel=canonical]').count(), 0);
    }
    const sitemap = await (await page.request.get(base + '/sitemap.xml')).text();
    const entries = await page.evaluate(xml => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('Invalid sitemap XML');
      return [...doc.getElementsByTagName('url')].map(node => ({ location: node.getElementsByTagName('loc')[0].textContent, alternates: [...node.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'link')].map(link => link.getAttribute('href')) }));
    }, sitemap);
    assert.deepEqual(entries.map(entry => entry.location).sort(), checked.map(path => production + path).sort());
    for (const entry of entries) {
      assert.equal(entry.alternates.length, 3);
      assert(entry.alternates.includes(entry.location));
    }
    const robots = await (await page.request.get(base + '/robots.txt')).text();
    assert(robots.includes('Allow: /'));
    assert(robots.includes('Sitemap: ' + production + '/sitemap.xml'));
    await fs.mkdir('artifacts', { recursive: true });
    await fs.writeFile('artifacts/seo-qa.json', JSON.stringify({ status: 'passed', pages: checked, sitemapEntries: entries.length, imageDimensions: '1200x630' }, null, 2));
    console.log('✓ 18 pages: unique localized metadata, canonical URLs, reciprocal hreflang and structured data');
    console.log('✓ Both social cards: localized, absolute URLs, 1200 × 630, Open Graph and Twitter');
    console.log('✓ Sitemap: 18 indexable pages, locale alternates; error pages excluded and noindex');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
