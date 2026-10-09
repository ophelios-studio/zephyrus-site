const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [], checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failures.push(response.status() + ' ' + response.url()); });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.deepEqual(failures, [], 'Initial assets must load before interaction checks');
    for (const icon of await page.locator('.github-link .tabler-icon, .feature-entry-top .tabler-icon, .roadmap-path-top .tabler-icon').all()) {
      const box = await icon.evaluate(svg => { const rect = svg.getBBox(); return { width: rect.width, height: rect.height }; });
      assert(box.width > 3 && box.height > 3, 'SVG icon must have visible geometry');
    }
    assert.equal(await page.title(), 'Zephyrus · PHP framework, clear by design');
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('[data-language-link="en"]').getAttribute('aria-current'), 'true');
    assert.deepEqual(await page.locator('.built-sites > a').evaluateAll(links => links.map(link => link.href)), [
      'https://codequill.xyz/', 'https://leaf.ophelios.com/', 'https://agreely.ca/', 'https://corvee.ca/'
    ]);
    assert.equal(await page.locator('.brand-mark').first().count(), 1);
    assert(!(await page.locator('body').textContent()).includes('{syntax'));
    assert(!(await page.locator('body').textContent()).includes('—'));
    const canvas = page.locator('#wind-canvas');
    const firstFrame = await canvas.evaluate(el => el.toDataURL());
    await page.waitForTimeout(650);
    assert((await canvas.evaluate(el => el.toDataURL())) !== firstFrame, 'The hero should animate');
    await page.getByRole('button', { name: 'Pause hero animation' }).click();
    const pausedFrame = await canvas.evaluate(el => el.toDataURL());
    await page.waitForTimeout(450);
    assert((await canvas.evaluate(el => el.toDataURL())) === pausedFrame, 'Pause should stop the canvas');
    checks.push('Hero renders, animates and pauses');
    await page.getByRole('button', { name: 'Copy Composer command' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'composer require zephyrus-framework/core');
    assert.equal(await page.locator('.closing-link').count(), 0);
    checks.push('Core installation command copies correctly and GitHub uses an icon in the CTA');

    await page.getByRole('tab', { name: /HTTP/ }).click();
    assert(await page.locator('#panel-responses').isVisible());
    await page.getByRole('button', { name: 'Copy code example' }).click();
    assert((await page.evaluate(() => navigator.clipboard.readText())).includes('Cache-Control'));
    await page.getByRole('tab', { name: /Configuration/ }).click();
    assert.equal(await page.locator('.file-name').textContent(), 'config.yml');
    await page.getByRole('tab', { name: /Configuration/ }).press('Home');
    assert.equal(await page.locator('#tab-routing').getAttribute('aria-selected'), 'true');
    assert(await page.locator('#panel-routing').isVisible());
    checks.push('Code tabs, keyboard navigation and clipboard');

    await page.locator('#tab-localization').click();
    assert.equal(await page.locator('[data-demo-greeting]').textContent(), 'Hello, Sam');
    assert.equal(await page.locator('[data-demo-items]').textContent(), '3 items');
    await page.locator('[data-example-locale="fr"]').click();
    assert.equal(await page.locator('[data-demo-greeting]').textContent(), 'Bonjour, Sam');
    assert.equal(await page.locator('[data-demo-items]').textContent(), '3 articles');
    await page.locator('#tab-data').click();
    assert((await page.locator('#panel-data').textContent()).includes('selectOne'));
    await page.locator('[data-copy-target="skill-install-command"]').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npx skills add ophelios-studio/skills --skill zephyrus');
    assert((await page.locator('#roadmap').textContent()).includes('ON THE ROADMAP'));
    checks.push('JSON locale demo, explicit SQL, agent skill command and coming-soon roadmap');

    await page.locator('.architecture-list summary').nth(1).click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.architecture-list details[open]').count(), 1);
    assert(await page.locator('.architecture-list details').nth(1).getAttribute('open') !== null);
    checks.push('Architecture accordion');

    const allURLs = new Set(await page.locator('a[href^="/"]').evaluateAll(links => links.map(link => link.getAttribute('href'))));
    await page.goto(base + '/getting-started/introduction/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('h1').textContent(), 'Introduction');
    assert.equal(await page.locator('.sidebar-link[aria-current="page"]').textContent(), 'Introduction');
    assert.equal(await page.locator('.toc-link').count(), 4);
    const markdownCode = await page.locator('.prose pre code').textContent();
    await page.getByRole('button', { name: 'Copy code block' }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), markdownCode);
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.search-dialog[open] .search-result');
    await page.getByRole('searchbox').fill('routing');
    assert.equal(await page.locator('.search-result h3').first().textContent(), 'Routing');
    await page.getByRole('searchbox').fill('a-chapter-that-does-not-exist');
    assert(await page.locator('.search-empty').isVisible());
    await page.getByRole('searchbox').fill('configuration');
    await page.getByRole('searchbox').press('Enter');
    await page.waitForURL('**/fundamentals/configuration/');
    assert.equal(await page.locator('h1').textContent(), 'Configuration');
    checks.push('Markdown, sidebar selection, TOC, copy and keyboard search');
    for (const href of await page.locator('a[href^="/"]').evaluateAll(links => links.map(link => link.getAttribute('href')))) allURLs.add(href);
    const pages = ['/getting-started/introduction/', '/getting-started/project-structure/', '/fundamentals/routing/', '/fundamentals/http/', '/fundamentals/configuration/', '/fundamentals/localization/', '/fundamentals/data/', '/fundamentals/security/'];
    for (const prefix of ['', '/fr']) {
      const index = await (await page.request.get(base + prefix + '/search.json')).json();
      assert.equal(index.length, 8);
      for (const route of pages) {
        await page.goto(base + prefix + route, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('html').getAttribute('lang'), prefix ? 'fr' : 'en');
        assert.equal(await page.locator('.sidebar-link[aria-current="page"]').count(), 1, 'Active chapter ' + prefix + route);
        assert(!(await page.locator('body').textContent()).includes('—'));
        for (const href of await page.locator('a[href^="/"]').evaluateAll(links => links.map(link => link.getAttribute('href')))) allURLs.add(href);
      }
    }
    for (const href of allURLs) {
      const target = new URL(href, base);
      const response = await page.request.get(target.href);
      assert.equal(response.status(), 200, 'Local link: ' + href);
      if (target.hash) assert((await response.text()).includes('id="' + target.hash.slice(1) + '"'), 'Anchor: ' + href);
    }
    checks.push('Eight chapters in both languages, locale search indexes and every local destination');

    await page.goto(base + '/fundamentals/localization/#regional-fallback', { waitUntil: 'networkidle' });
    await page.locator('[data-language-link="fr"]').click();
    await page.waitForURL('**/fr/fundamentals/localization/#regional-fallback');
    assert.equal(await page.locator('h1').textContent(), 'Localisation');
    await page.locator('[data-language-link="en"]').click();
    await page.waitForURL('**/fundamentals/localization/#regional-fallback');
    await page.goto(base + '/fr/fundamentals/localization/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Rechercher dans la documentation' }).click();
    await page.getByRole('searchbox').fill('securite');
    assert.equal(await page.locator('.search-result h3').first().textContent(), 'Sécurité');
    await page.getByRole('searchbox').press('Enter');
    await page.waitForURL('**/fr/fundamentals/security/');
    await page.locator('[data-language-link="en"]').click();
    await page.waitForURL('**/fundamentals/security/');
    checks.push('Language switch preserves chapters and hashes, French search ignores accents');

    for (const width of [320, 390, 600, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['/', '/getting-started/introduction/', '/fr/', '/fr/getting-started/introduction/']) {
        await page.goto(base + route, { waitUntil: 'networkidle' });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Overflow at ' + width + ' ' + route);
        if (route === '/' || route === '/fr/') {
          assert.equal(await page.locator('.roadmap-path').count(), 6);
          assert.equal(await page.locator('.ecosystem-leaf .tabler-icon').count(), 1);
          assert.equal(await page.locator('.built-sites .product-mark').count(), 4);
          assert.equal(await page.locator('.feature-entry-top .tabler-icon').count(), 4);
        }
      }
    }
    checks.push('Both locales have no horizontal overflow at seven widths, 320 to 1920 px');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base, { waitUntil: 'networkidle' });
    assert((await page.locator('h1').innerText()).includes('Powerful by nature.'));
    await page.getByRole('button', { name: 'Open navigation' }).click();
    assert(await page.locator('#mobile-nav').isVisible());
    await page.locator('#mobile-nav').getByRole('link', { name: 'Documentation' }).click();
    await page.waitForURL('**/getting-started/introduction/');
    await page.getByRole('button', { name: /Chapters/ }).click();
    assert.equal(await page.locator('.docs-sidebar').evaluate(el => el.inert), false);
    await page.locator('.sidebar-link').filter({ hasText: /^Routing$/ }).click();
    await page.waitForURL('**/fundamentals/routing/');
    assert.equal(await page.locator('.docs-sidebar').evaluate(el => el.inert), true);
    await page.getByRole('button', { name: 'Search documentation' }).click();
    await page.getByRole('searchbox').fill('HTTP');
    assert.equal(await page.locator('.search-result h3').first().textContent(), 'HTTP');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.search-dialog[open]', { state: 'hidden' });
    assert.equal(await page.locator('.search-dialog').getAttribute('open'), null);
    checks.push('Mobile menu, chapter drawer and search');

    await page.goto(base + '/fr/', { waitUntil: 'networkidle' });
    assert((await page.locator('h1').innerText()).includes('Puissant par nature.'));
    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
    await page.locator('#mobile-nav').getByRole('link', { name: 'Documentation' }).click();
    await page.waitForURL('**/fr/getting-started/introduction/');
    await page.getByRole('button', { name: /Chapitres/ }).click();
    await page.locator('.sidebar-link').filter({ hasText: /^Localisation$/ }).click();
    await page.waitForURL('**/fr/fundamentals/localization/');
    await page.getByRole('button', { name: 'Copier le bloc de code' }).first().click();
    assert((await page.evaluate(() => navigator.clipboard.readText())).includes('greeting'));
    checks.push('French mobile navigation, chapters and translated clipboard controls');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(base, { waitUntil: 'networkidle' });
    const still = await canvas.evaluate(el => el.toDataURL());
    await page.waitForTimeout(450);
    assert((await canvas.evaluate(el => el.toDataURL())) === still, 'Reduced motion should render a static ribbon');
    assert.equal(await page.locator('[data-reveal]').first().evaluate(el => getComputedStyle(el).opacity), '1');
    checks.push('Reduced motion, static ribbon and visible content');
    await page.goto(base + '/404.html', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('h1').textContent(), 'A little off course.');
    const noJS = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 960 } });
    const fallback = await noJS.newPage();
    await fallback.goto(base + '/getting-started/introduction/');
    assert.equal(await fallback.locator('h1').textContent(), 'Introduction');
    checks.push('Custom 404 and readable documentation without JavaScript');
    await noJS.close();
    assert.deepEqual(failures, [], 'Browser and asset errors');
    checks.push('No JavaScript errors or failed assets');
    await fs.mkdir('artifacts', { recursive: true });
    await fs.writeFile('artifacts/qa.json', JSON.stringify({ status: 'passed', checks }, null, 2));
    for (const check of checks) console.log('✓ ' + check);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
