// M07 actual game: atlas input ownership, pause/ride/orbit camera, collection transfer and layout.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:5613/';
const art = process.env.ART_DIR || '/home/baibai/outbox/pawborough-national-snacks-20261002/m07';
await fs.mkdir(art, { recursive: true });
const gpu = process.env.GPU_WEBGL === '1';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: !gpu,
  args: ['--no-sandbox', ...(gpu ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])] });
const same = (a,b) => a.length === b.length && a.every((v,i) => Math.abs(v-b[i]) < 1e-6);
// Rapier settles the ground contact vertically after resume. Horizontal float32
// contact corrections below 0.1mm are independent of keyboard motion.
const stationaryXZ = (a,b) => Math.hypot(a[0]-b[0],a[2]-b[2]) < .0001;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('pawborough.play.walk.v1', JSON.stringify({ schemaVersion:1,sceneVersion:'play-snacks-20261001',actorId:'gray-cat',feet:null,yaw:0,pitch:0,heldItem:null,basketItem:null,eating:null,tasted:['xiaolongbao'],goalIndex:1,vehicle:{placed:false,pos:null,yaw:0,viewYaw:0,riding:false} })));
  await page.goto(new URL('?play=1&at=center', base).href);
  await page.waitForFunction(() => { const s=window.__play?.status();return s?.mode==='play'&&s.feet?.length===3&&s.foodsReady&&s.bikePlaced; }, undefined, {timeout:120000});
  assert.equal(await page.locator('#p-atlas').count(), 1, 'HUD must expose the atlas');
  await page.waitForFunction(() => window.__play.status().atlasReady, undefined, { timeout: 10000 });
  const status = () => page.evaluate(() => ({ play:window.__play.status(),walk:window.__walk.status() }));
  const open = async () => { await page.keyboard.press('b'); await page.waitForFunction(() => window.__play.status().overlayOpen); };
  const close = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => !window.__play.status().overlayOpen); };

  await open();
  assert.ok((await status()).play.paused);
  assert.ok(await page.locator('.pb-atlas').isVisible());
  assert.match(await page.locator('.pb-atlas').innerText(), /小笼包/);
  await page.screenshot({ path: path.join(art,'M07-desktop.png') });
  const frozen = await status(); await page.waitForTimeout(300);
  const still = await status(); assert.ok(same(frozen.walk.camera,still.walk.camera));
  await page.keyboard.down('w'); await page.waitForTimeout(100); await close(); await page.keyboard.up('w');
  assert.equal((await status()).play.mode,'play'); assert.equal((await status()).play.paused,false);
  const stopped = await status(); await page.waitForTimeout(300); const noSticky=await status();
  assert.ok(stationaryXZ(stopped.play.feet,noSticky.play.feet),'closing atlas needs fresh movement input');

  await page.locator('#p-pause').click(); await open(); await close();
  assert.ok((await status()).play.paused,'pre-existing user pause must survive atlas');
  await page.locator('#p-pause').click();
  await page.locator('#p-help').click(); await page.keyboard.press('b');
  await page.keyboard.press('Escape');
  assert.ok(await page.locator('#play-help').isVisible(),'Esc closes atlas first, preserves help');
  assert.ok(await page.locator('#play-help').evaluate(el => el.contains(document.activeElement)),'nested atlas returns focus to help');
  assert.ok((await status()).play.paused);
  await page.keyboard.press('Escape'); assert.equal((await status()).play.paused,false);

  await page.keyboard.press('r'); await page.waitForFunction(() => window.__play.status().riding);
  await page.keyboard.down('w'); await page.waitForTimeout(300); await page.keyboard.up('w');
  await open(); const rideFrozen=await status(); await page.waitForTimeout(300); assert.ok(same(rideFrozen.play.feet,(await status()).play.feet));
  await close(); assert.ok((await status()).play.riding);
  const rideStopped=await status(); await page.waitForTimeout(300); const rideLater=await status();
  assert.equal(rideStopped.play.rideSpeed,0); assert.equal(rideLater.play.rideSpeed,0);
  assert.equal(rideLater.play.rideInput.forward,0);
  assert.ok(stationaryXZ(rideStopped.play.feet,rideLater.play.feet),'ride resume should stay stopped');
  await page.keyboard.press('r'); await page.waitForFunction(() => !window.__play.status().riding);
  await page.locator('#p-view').click(); await page.waitForTimeout(200); await open();
  const orbitFrozen=await status(); await page.waitForTimeout(300); assert.ok(same(orbitFrozen.walk.camera,(await status()).walk.camera));
  await close(); assert.equal((await status()).play.mode,'orbit');
  await page.locator('#p-enter').click(); await page.waitForFunction(() => window.__play.status().mode==='play');

  await open();
  const beforeTransfer=await status();
  const backup = {schemaVersion:1,type:'pawborough-food-collection',catalogEdition:'test-edition',discovered:['congyoubing'],tasted:['congyoubing'],milestones:[],orphanedProgress:{discovered:[],tasted:[]},feet:[999,999,999],vehicle:{riding:true}};
  await page.locator('.pb-atlas input[type=file]').setInputFiles({name:'collection.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup),'utf8')});
  await page.waitForFunction(() => window.__play.status().tasted.includes('congyoubing'));
  assert.ok(same(beforeTransfer.play.feet,(await status()).play.feet));
  assert.equal((await status()).play.riding,false);
  const download = page.waitForEvent('download'); await page.locator('.pb-atlas-export-btn').click();
  const file = await (await download).path(); const exported=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(exported.type,'pawborough-food-collection'); assert.ok(!('feet' in exported)&&!('vehicle' in exported));
  assert.deepEqual(exported.tasted.sort(),['congyoubing','xiaolongbao']);
  await fs.writeFile(path.join(art,'M07-export-fixture.json'),JSON.stringify(exported,null,2)+'\n','utf8');
  await page.setViewportSize({width:360,height:800}); await page.waitForTimeout(150);
  const narrow=await page.locator('.pb-atlas-dialog').boundingBox(); assert.ok(narrow.x>=0&&narrow.x+narrow.width<=360.5&&narrow.y>=0&&narrow.y+narrow.height<=800.5);
  await page.screenshot({path:path.join(art,'M07-narrow.png')});
  await close(); assert.deepEqual(errors,[]);
  await page.close();
  console.log('SNACK_ATLAS_BROWSER PASS: play/pause/help/ride/orbit, transfer without pose changes, narrow layout');
} finally { await browser.close(); }
