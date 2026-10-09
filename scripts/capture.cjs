const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
(async () => {
  await fs.mkdir('artifacts', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const locale of ['en', 'fr']) {
    const prefix = locale === 'en' ? '' : '/fr';
    for (const [name, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844], ['tablet', 768, 1024]]) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
      await page.goto(url + prefix + '/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(900);
      await page.screenshot({ path: 'artifacts/hero-' + locale + '-' + name + '.png' });
      for (let y = 0; y < await page.evaluate(() => document.body.scrollHeight); y += height * .75) {
        await page.evaluate(y => scrollTo(0, y), y); await page.waitForTimeout(120);
      }
      await page.waitForTimeout(900); await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: 'artifacts/landing-' + locale + '-' + name + '.png', fullPage: true });
      if (name !== 'tablet') {
        await page.locator('#tab-localization').click();
        await page.locator('#framework').screenshot({ path: 'artifacts/localization-' + locale + '-' + name + '.png' });
        for (const section of ['start', 'features', 'ecosystem', 'agents', 'roadmap', 'build']) await page.locator('#' + section).screenshot({ path: 'artifacts/' + section + '-' + locale + '-' + name + '.png' });
      }
      console.log(locale + ' ' + name + ' home', JSON.stringify({ width: await page.evaluate(() => document.documentElement.scrollWidth), errors }));
      await page.locator('.site-footer').screenshot({ path: 'artifacts/footer-' + locale + '-' + name + '.png' });
      await page.goto(url + prefix + '/getting-started/introduction/', { waitUntil: 'networkidle' });
      await page.screenshot({ path: 'artifacts/docs-' + locale + '-' + name + '.png', fullPage: true });
      console.log(locale + ' ' + name + ' docs', JSON.stringify({ width: await page.evaluate(() => document.documentElement.scrollWidth), errors }));
      await page.close();
    }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
