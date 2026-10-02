// A single unavailable meal must cancel its restored eat pose and be retryable.
import assert from 'node:assert/strict';import{chromium}from'playwright';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:false,args:['--no-sandbox','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}});await page.bringToFront();
 await page.route('**/resources/foods/national/roujiamo.glb',route=>route.abort());
 await page.addInitScript(()=>localStorage.setItem('pawborough.play.walk.v2',JSON.stringify({schemaVersion:2,sceneVersion:'play-snacks-20261001',actorId:'gray-cat',catalogEdition:'pawborough-snack-atlas-v1-six',feet:null,yaw:0,pitch:0,heldItem:'roujiamo',basketItem:null,eating:{foodId:'roujiamo',elapsed:.5},tasted:['xiaolongbao'],discovered:['xiaolongbao','roujiamo'],milestones:[],orphanedProgress:{discovered:[],tasted:[]},trackedFoodId:null,trackedVendorId:null,vehicle:{placed:false,pos:null,yaw:0,viewYaw:0,riding:false}})));
 await page.goto(new URL('?play=1&at=center',process.env.BASE??'http://127.0.0.1:5613/').href);
 await page.waitForFunction(()=>window.__play?.status().foodsReady&&window.__play.status().bikePlaced&&window.__play.status().eating===null,undefined,{timeout:120000});
 await page.waitForTimeout(150);const failed=await page.evaluate(()=>window.__play.status());assert.deepEqual(failed.tasted,['xiaolongbao']);assert.equal(failed.heldItem,'roujiamo');assert.equal(failed.animation,'idle');assert.equal(failed.foodPose,null);
 assert.match(await page.locator('#play-msg').innerText(),/按 F.*备餐/);
 await page.unroute('**/resources/foods/national/roujiamo.glb');await page.keyboard.press('f');
 await page.waitForFunction(()=>window.__play.status().foodPose?.ok,undefined,{timeout:10000});assert.equal((await page.evaluate(()=>window.__play.status())).eating,null,'retry prepares only; it never auto-consumes');
 await page.keyboard.press('f');await page.waitForFunction(()=>window.__play.status().tasted.includes('roujiamo')&&!window.__play.status().eating,undefined,{timeout:10000});
 assert.deepEqual((await page.evaluate(()=>window.__play.status())).tasted.sort(),['roujiamo','xiaolongbao']);await page.close();
 console.log('FOOD_FAILURE_BROWSER PASS: single failure, restored eat cancelled, avatar released, same collection, F retry');
}finally{await browser.close();}
