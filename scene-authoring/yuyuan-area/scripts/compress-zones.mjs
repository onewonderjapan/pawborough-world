// meshopt compression of the runtime zone GLBs (owner decision G6 "compressed default", 2026-09-23 applied to area zones).
// zone-<id>.glb -> zone-<id>.cm.glb with gltfpack -cc -kn (EXT_meshopt_compression + KHR_mesh_quantization, node names kept,
// textures untouched). Positions 16-bit and UVs 14-bit: site modules are in world coordinates and use metric (tiling) UVs,
// so the default 14/12 bits would cost ~1 cm / ~3 % of a tile. Validator must report 0 errors; manifest gets cm entries.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateBytes } from 'gltf-validator';
const OUT = path.resolve(process.env.OUT_DIR || 'out');
const GLTFPACK = process.env.GLTFPACK ?? '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/N4/toolchain/src/build/gltfpack';
const ARGS = ['-cc', '-kn', '-ke', '-vp', '16', '-vt', '14'];   // -ke keeps node/material extras (viewer reads id/zone/kind; winback reads pbRole)
// wave12-towerwin W3：lighting/presets.json（emissiveGroups + pointLights.sources）按「去 .NNN 的材质名」点亮夜间自发光。
// gltfpack 默认按内容合并材质：内容完全相同的两材质只剩第一个名字。
// wave12 R1：保名不再靠按件 -km（-km 让整件全部具名材质停止合并，核心首屏每帧调用 479→731，实测在工单包 artifacts/w3/）。
// btk-winback 改带材质级语义 extras pbRole=window-backing（build_tower.py），gltfpack -ke 下材质比较含 extras
// （本地 gltfpack 1.2 material.cpp keep_extras 路径），与 btk-wood 内容相同也不再合并，默认压缩即保名。
// 本文件的保护检测相应改为核对「实际被 primitive 引用的材质」的语义与三角量（引用计数为 0 的材质会被正常裁掉，不算丢失）：
//   1) src 被引用的受保护材质基名，压缩后仍要有被引用的同基名材质（防 winback 被并入 wood 后整体消失）；
//   2) 受保护基名上的引用三角数压缩前后相等（防木料反向并入 winback——别的材质并进来三角数会变多，夜间错误点亮；
//      同基名互相合并不改变总和，不误报）；
//   3) 压缩后被引用的 btk-winback 必须仍带 extras.pbRole=window-backing（extras 丢了迟早重演 1)）。
// 触发即硬报错退出，不再回退 -km 重压：extras 方案下合法产物永远不该触发，真触发就是管线回归
// （源码丢 extras / 新增受保护材质重演内容合并），报错让它在重建时暴露，而不是悄悄付整件的绘制代价。
const PRESETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lighting', 'presets.json');
const PROTECTED = (() => {
  const p = JSON.parse(fs.readFileSync(PRESETS, 'utf8'));
  const s = new Set();
  for (const g of p.emissiveGroups || []) for (const m of g.materials || []) s.add(m);
  for (const src of (p.pointLights && p.pointLights.sources) || []) for (const m of src.materials || []) s.add(m);
  return s;
})();
const glbMatStats = (p) => {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(p + ': not GLB');
  const n = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + n).toString('utf8'));
  const trisOf = (prim) => prim.indices !== undefined ? j.accessors[prim.indices].count / 3 : j.accessors[prim.attributes.POSITION].count / 3;
  // 按节点引用记账（每个会画出来的实例算一次）：gltfpack 默认 mesh_dedup 会把完全相同的实例网格合并共享，
  // 按 mesh 记账会把共享后的重数丢掉，误报三角数变化。
  const refTris = new Map();                       // material index -> triangles of node-referenced primitives
  for (const node of j.nodes || []) {
    if (node.mesh === undefined) continue;
    for (const prim of ((j.meshes || [])[node.mesh].primitives || [])) {
      if (prim.material === undefined) continue;
      refTris.set(prim.material, (refTris.get(prim.material) || 0) + trisOf(prim));
    }
  }
  return (j.materials || []).map((m, i) => ({
    base: String(m.name || '').replace(/\.\d{3}$/, ''), extras: m.extras || null, refTris: refTris.get(i) || 0,
  }));
};
const mp = path.join(OUT, 'zones-manifest.json');
const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
let tool = 'gltfpack';
try { tool = execFileSync(GLTFPACK, ['-v'], { encoding: 'utf8' }).split('\n')[0].trim(); } catch (e) { tool = String(e.stdout || e.stderr || '').split('\n')[0].trim() || tool; }
const pack = (args, src, dst) => execFileSync(GLTFPACK, [...args, '-i', src, '-o', dst], { stdio: 'pipe' });
let bad = 0;
for (const z of m.zones.filter(z => z.file)) {
  const src = path.join(OUT, z.file), dst = src.replace(/\.glb$/, '.cm.glb');
  let args = z.file.includes('fangbang') ? [...ARGS, '-tc'] : [...ARGS];
  // 件级位置量化位数（export-zones 写 manifest cmPositionBits；目前只有 garden-halls 件 = 13，理由见 export-zones.py HALLS_CM_POSITION_BITS）
  if (z.cmPositionBits) args[args.indexOf('-vp') + 1] = String(z.cmPositionBits);
  pack(args, src, dst);
  // wave12 R1：保护语义核查（硬报错，无 -km 兜底；检测口径见文件头）
  const srcMats = glbMatStats(src);
  const dstMats = glbMatStats(dst);
  const dstRef = (base) => dstMats.filter(m => m.base === base && m.refTris > 0);
  const dstTris = (base) => dstRef(base).reduce((s, m) => s + m.refTris, 0);
  const problems = [];
  const protectedSrc = srcMats.filter(m => PROTECTED.has(m.base) && m.refTris > 0);
  const srcTris = (base) => protectedSrc.filter(m => m.base === base).reduce((s, m) => s + m.refTris, 0);
  for (const base of new Set(protectedSrc.map(m => m.base))) {
    if (!dstRef(base).length) problems.push(`protected material ${base} lost after compression (src refs ${srcTris(base)} tris)`);
    else if (Math.abs(dstTris(base) - srcTris(base)) > 1e-6) problems.push(`protected material ${base} referenced tris changed: src ${srcTris(base)} -> dst ${dstTris(base)} (foreign material merged into the protected name, or protected tris lost)`);
  }
  for (const dm of dstMats.filter(m => m.refTris > 0 && m.base === 'btk-winback')) {
    if (!(dm.extras && dm.extras.pbRole === 'window-backing')) problems.push('btk-winback kept by name but extras.pbRole=window-backing missing (semantic marker lost; content merge will follow)');
  }
  problems.forEach(p2 => console.error('PROTECTION', z.file, p2));
  if (problems.length) bad++;
  const b = fs.readFileSync(dst);
  const res = await validateBytes(new Uint8Array(b));
  z.cm = { file: path.basename(dst), bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex'),
           ratio: +(b.length / z.bytes).toFixed(3), positionBits: +args[args.indexOf('-vp') + 1],
           protectedMaterials: [...new Set(protectedSrc.map(m => m.base))].sort(),
           validatorErrors: res.issues.numErrors, validatorWarnings: res.issues.numWarnings,
           withinCap: b.length <= m.capPerZoneBytes };
  if (res.issues.numErrors) { bad++; console.error('validator errors', z.file, JSON.stringify(res.issues.messages.slice(0, 3))); }
  console.log(`${z.file} ${(z.bytes / 1e6).toFixed(2)}MB -> ${z.cm.file} ${(b.length / 1e6).toFixed(2)}MB (x${z.cm.ratio}) protected=[${z.cm.protectedMaterials.join(',')}] err=${res.issues.numErrors} warn=${res.issues.numWarnings}`);
}
m.compression = { tool, codec: 'gltfpack ' + ARGS.join(' ') + ' (EXT_meshopt_compression + KHR_mesh_quantization; textures untouched; per-part -vp from manifest cmPositionBits)',
                  runtimeDefault: 'cm', totalCmBytes: m.zones.reduce((s, z) => s + (z.cm?.bytes || 0), 0) };
fs.writeFileSync(mp, JSON.stringify(m, null, 1));
console.log(`COMPRESS DONE total ${(m.totalBytes / 1e6).toFixed(1)}MB -> ${(m.compression.totalCmBytes / 1e6).toFixed(1)}MB`);
process.exit(bad ? 2 : 0);
