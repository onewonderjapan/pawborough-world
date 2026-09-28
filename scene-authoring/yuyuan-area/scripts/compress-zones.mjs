// meshopt compression of the runtime zone GLBs (owner decision G6 "compressed default", 2026-09-23 applied to area zones).
// zone-<id>.glb -> zone-<id>.cm.glb with gltfpack -cc -kn (EXT_meshopt_compression + KHR_mesh_quantization, node names kept,
// textures untouched). Positions 16-bit and UVs 14-bit: site modules are in world coordinates and use metric (tiling) UVs,
// so the default 14/12 bits would cost ~1 cm / ~3 % of a tile. Validator must report 0 errors; manifest gets cm entries.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateBytes } from 'gltf-validator';
const OUT = path.resolve(process.env.OUT_DIR || 'out');
const GLTFPACK = process.env.GLTFPACK ?? '/home/baibai/outbox/pawborough-lane-b-night-20260914/artifacts/N4/toolchain/src/build/gltfpack';
const ARGS = ['-cc', '-kn', '-ke', '-vp', '16', '-vt', '14'];   // -ke keeps node extras (viewer reads id/zone/kind)
// wave12-towerwin W3：lighting/presets.json（emissiveGroups + pointLights.sources）按「去 .NNN 的材质名」点亮夜间自发光。
// gltfpack 默认按内容合并材质：内容完全相同的两材质只剩第一个名字（btk-winback 与 btk-wood 同贴图同参数，被合并后
// 夜间点不亮）。按件自适应：先默认压，若受保护材质名被合并吃掉，该件带 -km（保留全部具名材质）重压一遍。
// 全局 -km 不可取：核心首屏每帧 WebGL 调用 479 → 1501，超 lighting-check S4 的 1200 预算（作用域收窄实测
// 1415；按需 -km 只有真正发生名字碰撞的件付出绘制代价，实测记录在工单包 artifacts/w3/）。
const PRESETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lighting', 'presets.json');
const PROTECTED = (() => {
  const p = JSON.parse(fs.readFileSync(PRESETS, 'utf8'));
  const s = new Set();
  for (const g of p.emissiveGroups || []) for (const m of g.materials || []) s.add(m);
  for (const src of (p.pointLights && p.pointLights.sources) || []) for (const m of src.materials || []) s.add(m);
  return s;
})();
const glbMaterialBases = (p) => {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(p + ': not GLB');
  const n = b.readUInt32LE(12);
  return (JSON.parse(b.slice(20, 20 + n).toString('utf8')).materials || []).map(m => String(m.name || '').replace(/\.\d{3}$/, ''));
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
  // 受保护材质名被按内容合并吃掉 → 该件带 -km 重压（保留全部具名材质，夜间按名点灯才接得上）
  let keepMaterials = false, mergedAway = [];
  const srcNames = glbMaterialBases(src);
  if (srcNames.some(n => PROTECTED.has(n))) {
    const present = new Set(glbMaterialBases(dst));
    mergedAway = [...PROTECTED].filter(n => !present.has(n) && srcNames.includes(n));
    if (mergedAway.length) {
      keepMaterials = true;
      pack([...args, '-km'], src, dst);
      const after = new Set(glbMaterialBases(dst));
      if (mergedAway.some(n => !after.has(n))) { console.error('protected material names still missing after -km', z.file, mergedAway); bad++; }
    }
  }
  const b = fs.readFileSync(dst);
  const res = await validateBytes(new Uint8Array(b));
  z.cm = { file: path.basename(dst), bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex'),
           ratio: +(b.length / z.bytes).toFixed(3), positionBits: +args[args.indexOf('-vp') + 1], keepMaterials, mergedAwayMaterials: mergedAway, validatorErrors: res.issues.numErrors, validatorWarnings: res.issues.numWarnings,
           withinCap: b.length <= m.capPerZoneBytes };
  if (res.issues.numErrors) { bad++; console.error('validator errors', z.file, JSON.stringify(res.issues.messages.slice(0, 3))); }
  console.log(`${z.file} ${(z.bytes / 1e6).toFixed(2)}MB -> ${z.cm.file} ${(b.length / 1e6).toFixed(2)}MB (x${z.cm.ratio}) km=${keepMaterials}${mergedAway.length ? ' lost=' + mergedAway.join(',') : ''} err=${res.issues.numErrors} warn=${res.issues.numWarnings}`);
}
m.compression = { tool, codec: 'gltfpack ' + ARGS.join(' ') + ' (EXT_meshopt_compression + KHR_mesh_quantization; textures untouched; per-part -vp from manifest cmPositionBits)',
                  runtimeDefault: 'cm', totalCmBytes: m.zones.reduce((s, z) => s + (z.cm?.bytes || 0), 0) };
fs.writeFileSync(mp, JSON.stringify(m, null, 1));
console.log(`COMPRESS DONE total ${(m.totalBytes / 1e6).toFixed(1)}MB -> ${(m.compression.totalCmBytes / 1e6).toFixed(1)}MB`);
process.exit(bad ? 2 : 0);
