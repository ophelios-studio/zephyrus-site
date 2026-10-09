const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4173';
(async () => {
  await fs.mkdir('artifacts', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'networkidle' });
    const field = page.locator('#build'), canvas = page.locator('#pixel-canvas');
    await field.scrollIntoViewIfNeeded(); await page.waitForTimeout(600);
    const idle = await canvas.evaluate(el => el.toDataURL());
    await page.waitForTimeout(350);
    assert((await canvas.evaluate(el => el.toDataURL())) !== idle, 'Pixels shimmer at rest');
    await page.getByRole('button', { name: 'Pause pixel animation' }).click();
    const paused = await canvas.evaluate(el => el.toDataURL());
    await page.waitForTimeout(350);
    assert((await canvas.evaluate(el => el.toDataURL())) === paused, 'Pixel pause freezes the image');
    await page.getByRole('button', { name: 'Resume pixel animation' }).click();
    await page.mouse.move(10, 10); await page.waitForTimeout(900);
    await field.screenshot({ path: 'artifacts/closing-en-desktop.png' });
    await canvas.evaluate(el => {
      const image = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      window.pixelBaseline = Uint8Array.from({ length: image.length / 4 }, (_, n) => Number(image[n * 4 + 3] > 0));
    });
    const rect = await canvas.boundingBox();
    for (let n = 0; n <= 24; n++) {
      await page.mouse.move(rect.x + rect.width * (.58 + n / 24 * .36), rect.y + rect.height * .31);
      await page.waitForTimeout(12);
    }
    const displacement = () => canvas.evaluate(el => {
      const image = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      let diff = 0, occupied = 0;
      window.pixelBaseline.forEach((value, n) => { occupied += value; diff += Number(value !== Number(image[n * 4 + 3] > 0)); });
      return diff / occupied;
    });
    const scattered = await displacement();
    assert(scattered > .15, 'Pointer breaks the pixel silhouette');
    await field.screenshot({ path: 'artifacts/closing-scattered-desktop.png' });
    await page.mouse.move(10, 10); await page.waitForTimeout(4500);
    const restored = await displacement();
    assert(restored < scattered * .2, 'The silhouette rebuilds after the pointer leaves');
    await field.screenshot({ path: 'artifacts/closing-restored-desktop.png' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(150);
    const still = await canvas.evaluate(el => el.toDataURL());
    await page.mouse.move(rect.x + rect.width * .8, rect.y + rect.height * .31);
    await page.waitForTimeout(450);
    assert((await canvas.evaluate(el => el.toDataURL())) === still, 'Reduced motion is static under the pointer');
    for (const locale of ['en', 'fr']) for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 960 });
      await page.goto(base + (locale === 'fr' ? '/fr/' : '/'), { waitUntil: 'networkidle' });
      await field.scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'CTA overflow ' + locale + ' ' + width);
      assert.equal(await page.locator('.closing-bottom a').getAttribute('href'), (locale === 'fr' ? '/fr' : '') + '/getting-started/introduction/');
      await field.screenshot({ path: 'artifacts/closing-' + locale + '-' + width + '.png' });
    }
    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const touch = await touchContext.newPage();
    await touch.goto(base, { waitUntil: 'networkidle' });
    await touch.locator('#build').scrollIntoViewIfNeeded(); await touch.waitForTimeout(500);
    const touchCanvas = touch.locator('#pixel-canvas');
    const touchRect = await touchCanvas.boundingBox();
    await touch.getByRole('button', { name: 'Pause pixel animation' }).click();
    await touch.getByRole('button', { name: 'Resume pixel animation' }).click();
    await touchCanvas.evaluate(el => {
      const image = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      window.touchBaseline = Uint8Array.from({ length: image.length / 4 }, (_, n) => Number(image[n * 4 + 3] > 0));
    });
    await touch.touchscreen.tap(touchRect.x + touchRect.width * .5, touchRect.y + touchRect.height * .46);
    await touch.waitForTimeout(150);
    const touchChange = await touchCanvas.evaluate(el => {
      const image = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      let diff = 0, occupied = 0;
      window.touchBaseline.forEach((value, n) => { occupied += value; diff += Number(value !== Number(image[n * 4 + 3] > 0)); });
      return diff / occupied;
    });
    assert(touchChange > .08, 'Touch disperses pixels');
    await touch.locator('#build').screenshot({ path: 'artifacts/closing-touch-mobile.png' });
    await touchContext.close();
    assert.deepEqual(errors, []);
    console.log('✓ Pixels animate and pause, scatter under the pointer and rebuild');
    console.log('  Silhouette change: ' + (scattered * 100).toFixed(1) + '% scattered; ' + (restored * 100).toFixed(1) + '% after rebuilding');
    console.log('✓ Static with reduced motion, touch interaction and bilingual layouts at four widths');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
