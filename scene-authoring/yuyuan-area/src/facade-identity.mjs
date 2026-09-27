// facadeBay 稳定唯一身份 helper（goal-identity-20260927）。
// 设计冻结见 artifacts/DESIGN.md：id 只由 (parentBuilding, 自身几何毫米规范化指纹) 决定，
// 插入无关建筑不重排既有 id；重复/无法区分必须失败，不静默去重。
// 门型 variant 与旧 hashStr(旧id)%2 逐位对齐，保证换 id 不改变门窗画面。

export const FACADE_ID_SCHEME = 'facade-v2-parent-geomfp';

// FNV-1a 32-bit（确定性，不依赖 Node 版本/全局 counter）
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 毫米级规范化签名：position mm、rotY 毫弧度、width mm
export function facadeBaySignature(parentBuilding, geometry) {
  const px = Math.round(geometry.position[0] * 1000);
  const pz = Math.round(geometry.position[1] * 1000);
  const rY = Math.round((geometry.rotY || 0) * 1000);
  const wm = Math.round((geometry.width || 0) * 1000);
  return `${parentBuilding}|${px}|${pz}|${rY}|${wm}`;
}

export function facadeBayId(parentBuilding, geometry) {
  const parentShort = String(parentBuilding).replace(/^bld-/, '');
  const fp = fnv1a(facadeBaySignature(parentBuilding, geometry)).toString(36);
  return `facade-${parentShort}-${fp}`;
}

// 与 build-scene.mjs hashStr 完全一致的旧门型推导；旧 id 缺失时不可调用（生成期旧 id 恒存在）
export function legacyDoorVariant(oldId) {
  let h = 0;
  for (const ch of String(oldId)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 2 === 0 ? 'center' : 'offsetLeft';
}

// 唯一性守卫：同 parent+同几何（无法区分）二次注册必须失败
export function registerFacadeId(used, id, ctx = '') {
  if (used.has(id)) {
    throw new Error(`facadeBay id collision (indistinguishable bays): ${id} ${ctx}`);
  }
  used.add(id);
  return id;
}
