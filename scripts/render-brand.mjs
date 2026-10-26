// Rasterizes the vector Morrow mark into the PNG favicon and a size preview sheet.
// Usage: node scripts/render-brand.mjs
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const svg = await readFile(root + 'app/assets/morrow-mark.svg', 'utf8');
const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0;background:transparent"><img id="mark" src="${data}" width="64" height="64" style="display:block"></body>`);
await page.locator('#mark').screenshot({ path: root + 'app/assets/morrow-favicon.png', omitBackground: true });
await mkdir(root + 'artifacts/brand', { recursive: true });
const sizes = [16, 24, 32, 48, 64, 96, 160];
await page.setViewportSize({ width: 980, height: 420 });
await page.setContent(`<body style="margin:0;font:600 12px Inter,system-ui;color:#716257">
  ${['#f7f3ed', '#ffffff', '#342a23'].map(bg => `<div style="display:flex;align-items:flex-end;gap:28px;padding:20px 24px;background:${bg}">
    ${sizes.map(s => `<figure style="margin:0;text-align:center"><img src="${data}" width="${s}" height="${s}" style="display:block;margin:0 auto 6px"><figcaption>${s}</figcaption></figure>`).join('')}
    <div style="display:flex;align-items:center;gap:10px;margin-left:auto"><img src="${data}" width="48" height="48"><span style="font:800 30px Manrope,Inter,system-ui;letter-spacing:-1.3px;color:${bg === '#342a23' ? '#fff3dd' : '#493024'}">morrow</span></div>
  </div>`).join('')}</body>`);
await page.screenshot({ path: root + 'artifacts/brand/morrow-mark-sizes.png', fullPage: true });
await browser.close();
console.log('Wrote app/assets/morrow-favicon.png and artifacts/brand/morrow-mark-sizes.png');
