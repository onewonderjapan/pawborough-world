// wave14-stalllight A 灯光：摊位点光参数判据（巡检 #19：夜间摊位点光呈粉色大光斑、舞台感）。
// 期望值全部从设计常量独立推导（不读生成器输出）：
//   摊柜台面高 CTR_H = 0.9 m（build_bazaar_stalls.py CTR_H，spec counter 0.9）；
//   棚布中段高 AWN_MID = 2.35 m（build_awning 前缘 2.2 / 后缘 2.5、z=0 中点线性插值 = 2.35）。
//   点光位置 = 摊位锚点(0,0,0) + offsetY（presets.pointLights.sources[id=stall]，查看器 web/lighting.js 与
//   Blender render-control-passes.py 同参）。
// 判据（astra R2 措辞收窄：L1/L2 是设计常量上的参数筛选，不是光斑/色温的实测证明）：
//   L1 降高方向约束（平方反比照度比，忽略遮挡、入射角与材质）：灯到台面的照度 ∝ 1/(offsetY−CTR_H)²
//      不小于灯到棚布的照度 ∝ 1/(AWN_MID−offsetY)²——等价 |offsetY−CTR_H| ≤ |AWN_MID−offsetY|，
//      即 offsetY ≤ 1.625。它只证明降高方向正确（棚布照度不再指数级压过台面），配合像素证据属
//      「改善、partial」口径：不能单独证明光斑已限制在台面内（截图仍有地面泛光，见 SUMMARY partial 项）。
//      修前 offsetY=2.3：灯距棚布 0.05 m、距台面 1.4 m，棚布照度是台面的 (1.4/0.05)² ≈ 784 倍 → 棚布炸亮成
//      大光斑（舞台感）。此判据在修前参数上红。
//   L2 琥珀色带筛选规则（sRGB R>G>B 且 G/R ∈ [0.60,0.95]；不是色温测量）：点光色须落在琥珀带；
//      粉色（R 高、G/R < 0.6，如 #ff6e9c G/R=0.43）判红。
//   L3 stall 自发光组（摊柜台面内透，模拟摊灯照亮台面）：组存在、含 palewood、color 同为琥珀带、intensity > 0。
// 负例（STALL_LIGHT_NEG）：
//   STALL_LIGHT_NEG=legacy  用修前参数（offsetY 2.3）代入判据 → L1 红；
//   STALL_LIGHT_NEG=pink    用粉色 #ff6e9c 代入判据 → L2 红。
// 用法：[STALL_LIGHT_NEG=legacy|pink] node tests/stall-light-params-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEG = process.env.STALL_LIGHT_NEG || null;
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'lighting', 'presets.json'), 'utf8'));

const CTR_H = 0.9, AWN_MID = 2.35;
const amberBand = (hex) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return { r, g, b, ok: r > g && g > b && g / r >= 0.60 && g / r <= 0.95 };
};

let fails = 0;
const fail = (m) => { console.error('FAIL ' + m); fails++; };
const ok = (m) => console.log('PASS ' + m);

const stallSrc = P.pointLights.sources.find(s => s.id === 'stall');
if (!stallSrc) { fail('pointLights.sources 无 id=stall 条目'); process.exit(1); }
const offsetY = NEG === 'legacy' ? 2.3 : stallSrc.offsetY;
const color = NEG === 'pink' ? '#ff6e9c' : P.pointLights.color;

// L1 降高方向约束（光斑是否限制在台面另由像素证据 partial 口径评估）
const dCtr = Math.abs(offsetY - CTR_H), dAwn = Math.abs(AWN_MID - offsetY);
if (!(dCtr <= dAwn))
  fail(`L1 灯 offsetY=${offsetY} 离台面 ${dCtr.toFixed(2)} m > 离棚布 ${dAwn.toFixed(2)} m（棚布照度/台面照度 = ${(dCtr / dAwn) ** 2} 倍 → 棚布炸亮大光斑；要求 offsetY ≤ ${(CTR_H + AWN_MID) / 2}）`);
else
  ok(`L1 灯 offsetY=${offsetY}：台面照度 ≥ 棚布照度（台距 ${dCtr.toFixed(2)} m ≤ 棚距 ${dAwn.toFixed(2)} m，降高方向约束成立）`);
if (!(offsetY > CTR_H)) fail(`L1b 灯 offsetY=${offsetY} 不高于台面 ${CTR_H}（无意义）；`);

// L2 琥珀色带筛选（非色温测量）
const c = amberBand(color);
if (!c.ok)
  fail(`L2 点光色 ${color} 非琥珀带（sRGB R=${c.r} G=${c.g} B=${c.b}，G/R=${(c.g / c.r).toFixed(2)} 要求 0.60–0.95 且 R>G>B；G/R<0.6 呈粉）`);
else
  ok(`L2 点光色 ${color} 为琥珀带（G/R=${(c.g / c.r).toFixed(2)}）`);

// L3 stall emissive 组
const grp = (P.emissiveGroups || []).find(g => g.id === 'stall');
if (!grp) fail('L3 emissiveGroups 无 id=stall 组');
else {
  if (!grp.materials.includes('palewood')) fail(`L3 stall 组材质不含 palewood: ${grp.materials}`);
  const gc = amberBand(grp.color);
  if (!gc.ok) fail(`L3 stall 组色 ${grp.color} 非琥珀带（G/R=${(gc.g / gc.r).toFixed(2)}）`);
  if (!(grp.intensity > 0)) fail(`L3 stall 组 intensity=${grp.intensity} ≤ 0`);
  if (!fails || fails === (grp.materials.includes('palewood') ? 0 : 1)) ok(`L3 stall 组 palewood × ${grp.color} intensity ${grp.intensity} 合规`);
}

console.log(`${NEG ? '[NEG ' + NEG + '] ' : ''}stall-light-params-test: ${fails} failure(s)`);
if (NEG) {
  if (!fails) { console.error(`负例 ${NEG} 未变红——测试抓不住该故障`); process.exit(1); }
  console.log(`负例 ${NEG} 如预期 FAIL`);
  process.exit(0);
}
process.exit(fails ? 1 : 0);
