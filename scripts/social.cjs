const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const base = (process.env.PREVIEW_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
(async () => {
  await fs.mkdir('public/assets/images', { recursive: true });
  const template = await fs.readFile('resources/social.html', 'utf8');
  const mark = await fs.readFile('templates/partials/mark.latte', 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
    for (const locale of ['en', 'fr']) {
      const { social } = JSON.parse(await fs.readFile(`locale/${locale}/general.json`, 'utf8'));
      const values = { ...social, locale, locale_label: locale === 'fr' ? 'FR / CA' : 'EN / CA', base, mark };
      const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => key === 'mark' ? mark : escapeHTML(values[key]));
      await page.goto(base);
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.fonts.check('500 68px Space')), true, 'Brand typeface must be loaded');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1200);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 630);
      const filename = locale === 'fr' ? 'og-fr.png' : 'og.png';
      await page.screenshot({ path: 'public/assets/images/' + filename });
      console.log(`Social card: ${filename} (1200 × 630)`);
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
