// wave14-viewerside 单双面契约测试（单元级，无浏览器）。
// 契约：查看器 web/main.js prepare() 对「无贴图、无顶点色」材质强制 FrontSide（防薄片背面闪烁的既有策略），
// 唯一豁免 = 材质 extras.pbDoubleSided === true——由装配端 scripts/export-zones.py 按
// baseline/doublesided-materials.json 白名单（材质基名，忽略 .NNN 后缀）给材质打标记，
// gltfpack -ke 保留进 cm 件、GLTFLoader 进 material.userData。只收真正的单层薄片（匾/旗/布幔/树叶片等）。
// oracle 完全独立于生成器输出：期望名单只从 baseline/doublesided-materials.json 读（配置是唯一真值）；
// 实测从 out-zone 分区件（raw GLB + cm GLB）的 materials[].extras 读，按节点引用记账（引用计数 0 的材质
// 会被 gltfpack 裁掉，不算被引用）。
// 断言：
//   C1 配置良构：schema=1、materials 非空数组、基名唯一、无空名；
//   C2 白名单基名全部在分区件里解析到「被引用」材质，raw 与 cm 双路都带 extras.pbDoubleSided === true
//      （查到 0 个 = FAIL，不静默缩圈）；
//   C3 没有任何未被白名单命中的「被引用」材质带 pbDoubleSided（标记只能来自白名单）；
//   C4 manifest 全部 zone 文件都参与检查（文件缺失 = FAIL）。
// 内嵌负例（故障注入实测断言会红，不靠旧版日志）：
//   NEG1 配置漂移：白名单塞不存在的名字 + 抽掉一个真实名字 → C2 必须红；
//   NEG2 剥标记：字节级改写某分区件 JSON chunk、删掉一个已标记材质的 pbDoubleSided → C2 必须红（改后字节还原并核对 sha）；
//   NEG3 越权标记：给一个未列入白名单的被引用材质注入 extras.pbDoubleSided=true（内存对象）→ C3 必须红。
// 用法：OUT_DIR=out-zone node tests/doubleside-contract-test.mjs（缺分区件时 SKIP——链内惯例；守卫另查重建流程）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const CFG = path.join(ROOT, 'baseline', 'doublesided-materials.json');
const MANIFEST = path.join(OUT, 'zones-manifest.json');

let pass = 0, fail = 0, skipped = 0;
const failures = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`); console.log('FAIL', name, detail); } };

// ---------- GLB JSON 解析（GLB：magic ver len | chunkLen chunkType JSON | BIN） ----------
function jsonOfGlb(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(p + ': not GLB');
  const n = b.readUInt32LE(12);
  return { json: JSON.parse(b.slice(20, 20 + n).toString('utf8')), bytes: b, jsonLen: n };
}
function rewriteJsonChunk(p, json) {
  // 字节级重写 JSON chunk（负例注入用）：JSON 长度 4 对齐补空格，BIN chunk 原样跟在后面
  const b = fs.readFileSync(p);
  const n = b.readUInt32LE(12);
  const binStart = 20 + n, binLen = b.readUInt32LE(binStart), binType = b.slice(binStart + 4, binStart + 8);
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (js.length % 4)) % 4;
  if (pad) js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + binLen, 8);
  head.writeUInt32LE(js.length, 12); head.writeUInt32LE(0x4E4F534A, 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binLen, 0); binType.copy(binHead, 4);
  return Buffer.concat([head, js, binHead, b.slice(binStart + 8)]);
}
const stripDot = (s) => String(s || '').replace(/\.\d{3}$/, '');
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// ---------- 分区件被引用材质（与 compress-zones.mjs glbMatStats 同口径：按节点引用记账） ----------
function referencedMats(p) {
  const { json } = jsonOfGlb(p);
  const trisOf = (prim) => prim.indices !== undefined ? json.accessors[prim.indices].count / 3 : json.accessors[prim.attributes.POSITION].count / 3;
  const out = new Map(); // matIndex -> { name, base, extras, refTris }
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    for (const prim of ((json.meshes || [])[node.mesh].primitives || [])) {
      if (prim.material === undefined) continue;
      const m = (json.materials || [])[prim.material];
      if (!m) continue;
      const e = out.get(prim.material) || { name: String(m.name || ''), base: stripDot(m.name), extras: m.extras || null, refTris: 0 };
      e.refTris += trisOf(prim);
      out.set(prim.material, e);
    }
  }
  return [...out.values()];
}

// ---------- 检查体（负例对同一函数换输入重跑，证明断言能红） ----------
function checkAll(cfg, zones) {
  const fails = [];
  // C1 配置良构
  const names = Array.isArray(cfg && cfg.materials) ? cfg.materials.map(String) : [];
  if (!cfg || cfg.schema !== 1) fails.push('C1 schema 必须 = 1');
  if (!names.length) fails.push('C1 materials 必须非空');
  if (new Set(names).size !== names.length) fails.push('C1 materials 有重复');
  if (names.some(n => !n.trim())) fails.push('C1 materials 有空名');
  const want = [...new Set(names)];
  // C2 白名单解析 + 双路标记
  for (const base of want) {
    let rawHit = 0, cmHit = 0, rawUnmarked = 0, cmUnmarked = 0;
    for (const z of zones) {
      for (const m of z.raw) if (m.base === base) { rawHit++; if (!(m.extras && m.extras.pbDoubleSided === true)) rawUnmarked++; }
      for (const m of z.cm) if (m.base === base) { cmHit++; if (!(m.extras && m.extras.pbDoubleSided === true)) cmUnmarked++; }
    }
    if (!rawHit) fails.push(`C2 白名单 ${base} 在任何分区件里都没有被引用的材质（查到 0 个）`);
    else if (rawUnmarked) fails.push(`C2 白名单 ${base} 有 ${rawUnmarked} 个被引用 raw 材质缺 pbDoubleSided=true`);
    if (zHasCm(zones) && cmHit && cmUnmarked) fails.push(`C2 白名单 ${base} 有 ${cmUnmarked} 个被引用 cm 材质缺 pbDoubleSided=true`);
    if (zHasCm(zones) && rawHit && !cmHit) fails.push(`C2 白名单 ${base} raw 有被引用材质但 cm 一路全部丢失（-ke 丢 extras?）`);
  }
  // C3 越权标记
  const wantSet = new Set(want);
  for (const z of zones) {
    for (const m of [...z.raw, ...z.cm]) {
      if (m.extras && m.extras.pbDoubleSided === true && !wantSet.has(m.base)) fails.push(`C3 ${z.file} 材质 ${m.name}（基名 ${m.base}）不在白名单却带 pbDoubleSided=true`);
    }
  }
  return fails;
}
const zHasCm = (zones) => zones.some(z => z.cm.length);

// ---------- 主流程 ----------
if (!fs.existsSync(CFG)) { console.log('SKIP doubleside-contract-test -', CFG, '不存在（契约未接线）'); process.exit(0); }
if (!fs.existsSync(MANIFEST)) { console.log('SKIP doubleside-contract-test -', MANIFEST, '不存在（无分区件）'); process.exit(0); }
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const zoneFiles = manifest.zones.filter(z => z.file);
if (!zoneFiles.length) { console.log('SKIP doubleside-contract-test - manifest 无 zone 文件'); process.exit(0); }

const cfg = JSON.parse(fs.readFileSync(CFG, 'utf8'));
const zones = [];
for (const z of zoneFiles) {
  const rawP = path.join(OUT, z.file);
  const cmP = rawP.replace(/\.glb$/, '.cm.glb');
  ok(`C4 ${z.file} 存在`, fs.existsSync(rawP));
  if (!fs.existsSync(rawP)) { zones.push({ file: z.file, raw: [], cm: [] }); continue; }
  zones.push({ file: z.file, raw: referencedMats(rawP), cm: fs.existsSync(cmP) ? referencedMats(cmP) : [] });
}

let f = checkAll(cfg, zones);
ok('C1+C2+C3 契约全量（配置良构 / 白名单双路带标记 / 无越权标记）', f.length === 0, f.join(' | '));
console.log(`census: zones=${zones.length} raw+cm 材质条目=${zones.reduce((s, z) => s + z.raw.length + z.cm.length, 0)} 白名单=${cfg.materials.length}`);

// ---------- 内嵌负例（必须红；红不了 = 断言无效 = 本测试自身失败） ----------
{
  // NEG1 配置漂移
  const drifted = { schema: 1, materials: ['no-such-material-xyz', ...cfg.materials.slice(1)] };
  const f1 = checkAll(drifted, zones);
  ok('NEG1 配置漂移（塞假名+抽真名）→ C2 红', f1.some(x => x.startsWith('C2')), f1.join(' | ') || '断言没有红');
}
{
  // NEG2 字节级剥标记（改盘上文件 → 跑 → 还原 → 核对 sha 回到原值）
  const target = zones.find(z => z.raw.some(m => m.extras && m.extras.pbDoubleSided === true && m.base === cfg.materials[0]));
  if (!target) ok('NEG2 剥标记', false, '找不到已标记材质可注入（先让 C2 过了再谈负例）');
  else {
    const p = path.join(OUT, target.file);
    const origBytes = fs.readFileSync(p);
    const sha0 = crypto.createHash('sha256').update(origBytes).digest('hex');
    const { json } = jsonOfGlb(p);
    let stripped = 0;
    for (const m of json.materials || []) {
      if (stripDot(m.name) === cfg.materials[0] && m.extras && m.extras.pbDoubleSided === true) { delete m.extras.pbDoubleSided; stripped++; }
    }
    if (!stripped) { ok('NEG2 剥标记', false, `在 ${target.file} 里没定位到已标记材质 ${cfg.materials[0]}`); }
    else {
      fs.writeFileSync(p, rewriteJsonChunk(p, json));
      const mutated = referencedMats(p).filter(m => m.base === cfg.materials[0]);
      const f2 = checkAll(cfg, zones.map(z => z.file === target.file ? { ...z, raw: referencedMats(p) } : z));
      ok('NEG2 剥标记 → C2 红', f2.some(x => x.startsWith('C2')), f2.join(' | ') || '断言没有红');
      ok('NEG2 注入生效（被改材质已无标记）', mutated.length > 0 && mutated.every(m => !(m.extras && m.extras.pbDoubleSided === true)));
      fs.writeFileSync(p, origBytes);
      ok('NEG2 还原后 sha 回到原值', sha256(p) === sha0);
    }
  }
}
{
  // NEG3 越权标记（内存注入，不落盘）
  const z0 = zones.find(z => z.raw.length);
  if (!z0) ok('NEG3 越权标记', false, '无 raw 材质可注入');
  else {
    const victim = { ...z0.raw[0], extras: { ...(z0.raw[0].extras || {}), pbDoubleSided: true } };
    const injected = zones.map(z => z.file === z0.file ? { ...z, raw: [victim, ...z.raw.slice(1)] } : z);
    const f3 = checkAll(cfg, injected);
    ok('NEG3 越权标记 → C3 红', f3.some(x => x.startsWith('C3')), f3.join(' | ') || '断言没有红');
  }
}

console.log(`RESULT pass=${pass} fail=${fail}${skipped ? ` skipped=${skipped}` : ''}`);
if (fail > 0) { for (const x of failures) console.log('  FAIL:', x); process.exit(1); }
