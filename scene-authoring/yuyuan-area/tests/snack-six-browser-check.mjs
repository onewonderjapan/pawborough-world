// Real game input/assets/poses; explicit fixture relocation is NOT route proof.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.BASE??'http://127.0.0.1:5613/',out=process.env.ART_DIR??'/home/baibai/outbox/pawborough-national-snacks-20261002/m08';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:false,args:['--no-sandbox','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/foods\/.*\.glb/.test(r.url()))requests.push(r.url());});
 await page.goto(new URL('?play=1&at=center',base).href);
 await page.waitForFunction(()=>window.__play?.status().foodsReady&&window.__play.status().bikePlaced,undefined,{timeout:120000});
 const initial=await page.evaluate(()=>window.__play.status());
 const initialRequests=requests.length;assert.ok(initialRequests<=3,`birth first batch<=3 actual${initialRequests}`);
 await page.evaluate(()=>window.__walk.controller.teleport([69.335,.04,-21.932],0,0));
 await page.waitForFunction(()=>window.__play.status().stallsReady===6,undefined,{timeout:60000});
 const active=await page.evaluate(()=>window.__play.status());
 assert.equal(active.vendorFailures.length,0,JSON.stringify(active.vendorFailures));assert.equal(active.vendors.length,6);assert.equal(active.cartCount,1);
 const results=[];
 for(const vendor of active.vendors){
  await page.evaluate(v=>{window.__walk.resume();window.__walk.controller.teleport([v.customerPoint.x,v.groundY+.04,v.customerPoint.z],0,0);},vendor);
  await page.waitForFunction(id=>window.__play.status().discovered.includes(id),vendor.foodId,{timeout:10000});
  await page.waitForTimeout(600);await page.keyboard.press('e');
  if((await page.evaluate(()=>window.__play.status())).heldItem!==vendor.foodId){await page.waitForTimeout(800);await page.keyboard.press('e');}
  await page.waitForFunction(id=>window.__play.status().heldItem===id,vendor.foodId,{timeout:10000});
  await page.keyboard.press('f');await page.waitForFunction(()=>window.__play.status().eating?.elapsed>=1.05,undefined,{timeout:5000});
  await page.keyboard.press('p');
  const frozen=await page.evaluate(()=>window.__play.status());
  assert.ok(frozen.paused);assert.ok(frozen.eating.elapsed<2.5);
  if(frozen.foodPose){assert.ok(frozen.foodPose.ok,JSON.stringify(frozen.foodPose));for(const v of Object.values(frozen.foodPose.contacts))assert.ok(Number.isFinite(v.gap)&&v.gap<=.03);}
  await page.waitForTimeout(200);assert.equal((await page.evaluate(()=>window.__play.status())).eating.elapsed,frozen.eating.elapsed);
  for(const [name,position]of [['front',[0,.65,1.45]],['side',[1.45,.65,.25]],['back',[0,.65,-1.45]]]){
   await page.evaluate(async p=>{const T=await import('three'),a=window.__scene.getObjectByName('play-gray-cat');a.updateMatrixWorld(true);const eye=a.localToWorld(new T.Vector3(...p)),target=a.localToWorld(new T.Vector3(0,.45,.13));window.__camPose(eye.toArray(),target.toArray());},position);
   await page.waitForTimeout(100);await page.screenshot({path:`${out}/${vendor.foodId}-${name}.png`});
  }
  await page.keyboard.press('p');await page.waitForFunction(id=>window.__play.status().tasted.includes(id)&&!window.__play.status().eating,vendor.foodId,{timeout:10000});
  results.push({foodId:vendor.foodId,pose:frozen.foodPose,elapsed:frozen.eating.elapsed});
 }
 assert.equal((await page.evaluate(()=>window.__play.status())).stamps,6);
 await page.keyboard.press('b');await page.screenshot({path:`out/atlas-six.png`.replace('out/',out+'/')});await page.keyboard.press('Escape');
 const final=await page.evaluate(()=>window.__play.status());assert.ok(final.complete);assert.ok(final.foodResources.residentCount<=8);assert.ok(final.foodResources.loadingCount<=2);
 assert.deepEqual(errors,[]);
 await fs.writeFile(`${out}/M08-six-actual-assets.json`,JSON.stringify({scope:'actual input/food contact/pause/completion, explicit fixture relocation; continuous route proof separate',initialRequests,results,final,errors},null,2)+'\n','utf8');
 console.log('SNACK_SIX_BROWSER PASS: 6 real assets, actual E/F, measured custom palms, paused phases, six unique completion');
 await page.close();
}finally{await browser.close();}
