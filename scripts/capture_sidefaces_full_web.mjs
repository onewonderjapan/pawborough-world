// A4 — sidefaces-full WebGL evidence: the 8 bridge cameras through the real
// page (?ds=fangbang-temple-v2&skins=1) on the v1-candidate dev server.
// Every shot passes the blank guard before saving.
// Run: EVIDENCE_PORTS='530[23]' EVIDENCE_DIR=kit/out/sidefaces-full/web \
//        BASE_URL=http://127.0.0.1:5302 node scripts/capture_sidefaces_full_web.mjs
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../node_modules/playwright/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5302';
const VIEWS = ['junction-west', 'west-road-mid', 'placeholder-band', 'shanmen-from-road',
  'forecourt-oblique', 'axis-long', 'temple-side-east', 'aerial-overview'];

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
let failures = 0;
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
try {
  await page.goto(BASE + '/fangbang.html?ds=fangbang-temple-v2&skins=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fangbangRecord, null, { timeout: 300000 });
  await page.waitForTimeout(1200);
  const rec = await page.evaluate(() => window.__fangbangRecord());
  if (!rec.routeCheck?.pass || rec.skins?.count !== 21) {
    console.log(`FAIL telemetry: skins=${JSON.stringify(rec.skins)} route=${rec.routeCheck?.pass}`);
    failures++;
  } else console.log(`ok  page loaded: ${rec.resources.triangles} tris incl ${rec.skins.placedTris} skin tris`);
  for (const view of VIEWS) {
    try {
      await page.evaluate((vid) => {
        const btn = document.querySelector(`button[data-view="${vid}"]`);
        if (btn) btn.click();
        const src = document.querySelector('#app canvas');
        const c2 = document.createElement('canvas');
        c2.width = 160; c2.height = 100;
        const ctx = c2.getContext('2d');
        ctx.drawImage(src, 0, 0, 160, 100);
        const d = ctx.getImageData(0, 0, 160, 100).data;
        const lum = [];
        for (let i = 0; i < 160 * 100; i++)
          lum.push(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]);
        const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
        const std = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / lum.length);
        if (std < 2) throw new Error(`BLANK std=${std.toFixed(2)}`);
      }, view);
      await page.waitForTimeout(300);
      await page.click('button:has-text("保存实测图")');
      await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('已保存'), null, { timeout: 20000 });
      console.log(`ok  sidefaces-full-${view}`);
    } catch (e) { failures++; console.log(`FAIL ${view}: ${e.message.split('\n')[0]}`); }
  }
} catch (e) { failures++; console.log(`FAIL load: ${e.message.split('\n')[0]}`); }
await page.close(); await browser.close();
console.log(failures === 0 ? 'SIDEFACES_FULL_WEB_PASS' : `SIDEFACES_FULL_WEB FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
