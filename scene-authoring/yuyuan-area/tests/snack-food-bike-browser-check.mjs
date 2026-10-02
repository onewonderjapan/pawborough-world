import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium}from'playwright';
const base=process.env.BASE??'http://127.0.0.1:5613/',out='/home/baibai/outbox/pawborough-national-snacks-20261002/m04-cycle';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:false,args:['--no-sandbox','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720},recordVideo:{dir:out,size:{width:640,height:360}}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.bringToFront();
 await page.goto(new URL('?play=1&at=center',base).href);await page.waitForFunction(()=>window.__play?.status().foodsReady&&window.__play.status().bikePlaced,undefined,{timeout:120000});
 const status=()=>page.evaluate(()=>window.__play.status());
 const vendor=(await status()).vendors.find(v=>v.foodId==='roujiamo');assert.ok(vendor.enabled);
 await page.evaluate(v=>window.__walk.controller.teleport([v.customerPoint.x,v.groundY+.04,v.customerPoint.z],0,0),vendor);
 await page.waitForTimeout(1500);await page.keyboard.press('e');
 if((await status()).heldItem!=='roujiamo'){await page.waitForTimeout(1000);await page.keyboard.press('e');}
 await page.waitForFunction(()=>window.__play.status().heldItem==='roujiamo',undefined,{timeout:10000});
 await page.waitForFunction(()=>window.__scene.getObjectByName('cat_body').skeleton.bones.length===16,undefined,{timeout:5000});
 const before=await page.evaluate(()=>({uuid:window.__scene.getObjectByName('play-held-roujiamo').uuid,joints:window.__scene.getObjectByName('cat_body').skeleton.bones.length}));assert.equal(before.joints,16);
 const bike=(await status()).vehicle.pos;await page.evaluate(p=>window.__walk.controller.teleport([p[0]+.9,p[1]+.02,p[2]],0,0),bike);
 await page.keyboard.press('r');await page.waitForFunction(()=>window.__play.status().riding);
 const mounted=await status();assert.equal(mounted.heldItem,null);assert.equal(mounted.basketItem,'roujiamo');
 const inBasket=await page.evaluate(()=>({uuid:window.__scene.getObjectByName('play-held-roujiamo').uuid,joints:window.__scene.getObjectByName('cat_body').skeleton.bones.length,foodArm:!!window.__scene.getObjectByName('armL_forearm')}));assert.equal(inBasket.uuid,before.uuid);assert.equal(inBasket.joints,12);assert.equal(inBasket.foodArm,false);
 await page.keyboard.press('b');await page.keyboard.press('Escape');assert.ok((await status()).riding);
 await page.keyboard.press('r');await page.waitForFunction(()=>!window.__play.status().riding);assert.equal((await status()).heldItem,'roujiamo');
 await page.waitForFunction(()=>window.__scene.getObjectByName('cat_body').skeleton.bones.length===16,undefined,{timeout:5000});
 const restored=await page.evaluate(()=>({uuid:window.__scene.getObjectByName('play-held-roujiamo').uuid,joints:window.__scene.getObjectByName('cat_body').skeleton.bones.length}));assert.equal(restored.uuid,before.uuid);assert.equal(restored.joints,16);
 // Use the native free-look view to record uninterrupted eating from the front.
 await page.evaluate(()=>window.__walk.controller.yaw+=Math.PI);await page.keyboard.press('f');
 try{await page.waitForFunction(()=>window.__play.status().tasted.includes('roujiamo')&&!window.__play.status().eating,undefined,{timeout:10000});}
 catch(error){console.log('Cycle eating failure',JSON.stringify(await status()));throw error;}
 assert.equal(await page.evaluate(()=>window.__scene.getObjectByName('play-held-roujiamo')===undefined),true);
 assert.equal(await page.evaluate(()=>window.__scene.getObjectByName('cat_body').skeleton.bones.length),12);
 assert.deepEqual(errors,[]);const video=page.video();await page.close();
 await fs.writeFile(`${out}/M04-food-bike-cycle.json`,JSON.stringify({scope:'Actual E/R/B/Esc/R/F inputs; fixture relocation only between vendor and bicycle, no route claim',before,inBasket,restored,errors,video:await video.path()},null,2)+'\n','utf8');
 console.log('FOOD_BIKE_BROWSER PASS: one food instance, 16→12→16→12 joint ownership, real eating and video');
}finally{await browser.close();}
