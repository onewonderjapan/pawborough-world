// A leave/re-enter before download completion must not create orphan displays.
export { getVendorDressingTemplate, hasVendorDressing, createVendorDressing } from './vendor-dressing.js';
export function cancelVendorDisplay(vendor,foods){
  vendor.displayGeneration=(vendor.displayGeneration??0)+1;
  vendor.displayWanted=false;vendor.display?.removeFromParent();vendor.display=null;
  foods.release(vendor.foodId,vendor);
}
export function requestVendorDisplay(vendor,foods,createDisplay){
  if(vendor.display||vendor.displayWanted)return Promise.resolve(vendor.display??null);
  vendor.displayWanted=true;
  const generation=vendor.displayGeneration=(vendor.displayGeneration??0)+1;
  return foods.acquire(vendor.foodId,vendor).then(()=>{
    if(generation!==vendor.displayGeneration||!vendor.displayWanted||vendor.enabled===false||vendor.display)return null;
    vendor.display=createDisplay(vendor);if(!vendor.display)throw new Error('display unavailable');return vendor.display;
  }).catch(()=>{if(generation===vendor.displayGeneration)cancelVendorDisplay(vendor,foods);return null;});
}
