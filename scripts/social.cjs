const { chromium } = require('playwright');
const fs = require('node:fs/promises');
(async () => {
  await fs.mkdir('public/assets/images', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, reducedMotion: 'reduce' });
    for (const locale of ['en', 'fr']) {
    const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
    await page.goto(base + (locale === 'fr' ? '/fr/' : '/'), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: '.site-header{height:75px}.hero{min-height:555px;padding-top:20px}.hero-composition{min-height:490px}.hero-copy{padding:30px 0}.hero h1{font-size:76px}.hero-copy>p{font-size:14px;margin-top:23px}.hero-actions{margin-top:23px}.hero-bottom{display:none}.wind-art{min-height:480px}.art-bottom{bottom:20px}.main-nav,.header-actions{display:none}' });
    await page.waitForTimeout(300);
    const file = locale === 'fr' ? 'og-fr.png' : 'og.png';
    await page.screenshot({ path: 'public/assets/images/' + file });
    console.log('Social image generated: public/assets/images/' + file + ' (1200 × 630)');
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
