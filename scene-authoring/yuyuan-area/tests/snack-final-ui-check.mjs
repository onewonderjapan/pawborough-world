import assert from'node:assert/strict';import fs from'node:fs/promises';import{chromium}from'playwright';
const out='/home/baibai/outbox/pawborough-national-snacks-20261002/m14-ui';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-gpu','--use-gl=angle','--use-angle=gl']});
try{const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(new URL('?play=1&at=center',process.env.BASE??'http://127.0.0.1:5633/').href);await page.waitForFunction(()=>window.__play?.status().foodsReady&&window.__play.status().bikePlaced&&window.__streetLife?.status().ready,undefined,{timeout:120000});
await page.waitForTimeout(1000);assert.equal(await page.locator('#play-stamps .stamp').count(),6,'HUD bounded at six stamps');
await page.screenshot({path:out+'/day-play.png'});await page.evaluate(()=>window.__lighting.set('night'));await page.waitForTimeout(1200);
assert.equal(await page.evaluate(()=>window.__streetLife.status().lightCount),2);await page.screenshot({path:out+'/night-play.png'});
await page.keyboard.press('b');await page.waitForFunction(()=>window.__play.status().overlayOpen);await page.setViewportSize({width:360,height:800});await page.waitForTimeout(100);
const bounds=await page.locator('.pb-atlas-dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=360.5&&bounds.y>=0&&bounds.y+bounds.height<=800.5);await page.screenshot({path:out+'/atlas-mobile.png'});await page.keyboard.press('Escape');
assert.deepEqual(errors,[]);await fs.writeFile(out+'/report.json',JSON.stringify({errors,street:await page.evaluate(()=>window.__streetLife.status()),hudStamps:6,atlasNarrowBounds:bounds},null,2)+'\n','utf8');await page.close();console.log('FINAL_UI PASS: staticCSP, boundedHUD, nightstreetpool, narrow24atlas, no script errors');
}finally{await browser.close();}
