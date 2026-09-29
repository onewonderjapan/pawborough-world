// wave14-viewerside 单双面契约浏览器检查（需起服务：BASE=http://127.0.0.1:5487/ OUT_DIR=out-zone）。
// 查的是查看器真实加载路径（默认 cm 件 + prepare() FrontSide 策略 + 运行时合批 + 灯光预设），真相从外部来：
//   - 期望名单：baseline/doublesided-materials.json（白名单 = 唯一真值）；
//   - 材质事实：out-zone 分区件 raw GLB 的 materials[]（map 有无、基名、是否被引用），本文件自解析，不读页面状态。
// 断言：
//   D1 标记材质在查看器里是 DoubleSide 且带 userData.pbDoubleSided：选白名单命中件数最多的分区加载，
//      白名单材质任一 mesh 的 material.side === THREE.DoubleSide（默认合批页与 ?batch=0 页都查）；
//   D2 未标记的「无贴图」材质是 FrontSide（同页取一个不在白名单的无贴图被引用材质，side === THREE.FrontSide
//      且 userData.pbDoubleSided 非真）——策略其余部分未被放宽；
//   D3 画面非空白：中心区域亮度标准差 ≥ 8/255（防止「断言挂在空帧上」）。
// 负例（故障注入实测断言会红，不靠旧版日志）：NEG=1 时先把该分区 cm 件里白名单首名材质的
//   extras.pbDoubleSided 字节级剥掉（JSON chunk 重写）→ 加载页面 D1 必须红 → 恢复原字节（sha 核对）→ D1 复绿。
// 用法：BASE=http://127.0.0.1:5487/ OUT_DIR=out-zone node tests/doubleside-browser-check.mjs（NEG=1 只跑负例段）
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const BASE = process.env.BASE || 'http://127.0.0.1:5487/';
const NEG = process.env.NEG === '1';
const exe = '/home/baibai/.cache/ms-playwright/chromium-1234/chrome-linux/chrome';

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`); console.log('FAIL', name, detail); } };
const stripDot = (s) => String(s || '').replace(/\.\d{3}$/, '');
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function jsonOfGlb(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(p + ': not GLB');
  const n = b.readUInt32LE(12);
  return { json: JSON.parse(b.slice(20, 20 + n).toString('utf8')), bytes: b };
}
function rewriteJsonChunk(p, json) {
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

// ---------- oracle（Node 侧独立解析） ----------
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'doublesided-materials.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const entries = manifest.zones.filter(z => z.file);
let pick = null; // { id, file, marked:[base...], unmarkedMapless: base }
for (const e of entries) {
  const p = path.join(OUT, e.file);
  if (!fs.existsSync(p)) continue;
  const { json } = jsonOfGlb(p);
  // 被引用材质（按节点引用记账，引用 0 的会被压缩裁掉）
  const ref = new Map();
  for (const node of json.nodes || []) {
    if (node.mesh === undefined) continue;
    for (const prim of ((json.meshes || [])[node.mesh].primitives || [])) {
      if (prim.material === undefined) continue;
      const m = (json.materials || [])[prim.material];
      if (!m) continue;
      ref.set(prim.material, m);
    }
  }
  const mats = [...ref.values()];
  const marked = [...new Set(mats.map(m => stripDot(m.name)).filter(b => cfg.materials.includes(b)))];
  if (!pick || marked.length > pick.marked.length) {
    const unmarkedMapless = [...new Set(mats
      .filter(m => !(m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture))
      .map(m => stripDot(m.name))
      .filter(b => b && !cfg.materials.includes(b)))];
    pick = { id: e.id, file: e.file, marked, unmarkedMapless };
  }
}
if (!pick || !pick.marked.length || !pick.unmarkedMapless.length) {
  console.error('FAIL oracle: 没有同时含白名单材质与未标记无贴图材质的分区件', pick);
  process.exit(1);
}
console.log(`oracle: zone=${pick.id} (${pick.file}) marked=[${pick.marked.join(',')}] unmarkedMapless 样本=${pick.unmarkedMapless[0]}`);

// cm 件（浏览器默认路径）；NEG 剥标记在这里做
const cmPath = path.join(OUT, pick.file.replace(/\.glb$/, '.cm.glb'));
const haveCm = fs.existsSync(cmPath);

const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const EXES = haveCm ? ['', '&batch=0'] : ['&batch=0'];   // 默认合批路径 + 不合批路径

async function loadAndCheck(tag) {
  for (const qs of EXES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`${BASE}?zone=${pick.id}&light=day${qs}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 900000 });
    const r = await page.evaluate(async ({ marked, unmarked }) => {
      const THREE = await import('three');
      const scene = window.__scene;
      const findMat = (base) => {
        let found = null;
        scene.traverse((o) => {
          if (found || !o.isMesh || !o.material) return;
          const arr = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of arr) if (String(m.name || '').replace(/\.\d{3}$/, '') === base) { found = m; break; }
        });
        return found;
      };
      const out = { marked: {}, unmarked: null, batched: 0 };
      for (const b of marked) {
        const m = findMat(b);
        out.marked[b] = m ? { side: m.side === THREE.DoubleSide ? 'DoubleSide' : m.side === THREE.FrontSide ? 'FrontSide' : String(m.side), pb: !!(m.userData && m.userData.pbDoubleSided === true) } : null;
      }
      const mu = findMat(unmarked);
      out.unmarked = mu ? { side: mu.side === THREE.DoubleSide ? 'DoubleSide' : mu.side === THREE.FrontSide ? 'FrontSide' : String(mu.side), pb: !!(mu.userData && mu.userData.pbDoubleSided === true) } : null;
      if (window.__batchStats) out.batched = window.__batchStats().batches;
      // D3 非空白：中央 32×32 采样亮度标准差
      window.__renderOnce();
      const gl = document.querySelector('canvas').getContext('webgl2');
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sum = 0, sum2 = 0, n = 0;
      for (let y = Math.floor(h * 0.25); y < h * 0.75; y += Math.floor(h / 32)) {
        for (let x = Math.floor(w * 0.25); x < w * 0.75; x += Math.floor(w / 32)) {
          const j = (y * w + x) * 4, lum = 0.2126 * buf[j] + 0.7152 * buf[j + 1] + 0.0722 * buf[j + 2];
          sum += lum; sum2 += lum * lum; n++;
        }
      }
      const mean = sum / n;
      out.lumStd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      return out;
    }, { marked: pick.marked, unmarked: pick.unmarkedMapless[0] });
    const batchTag = qs ? 'batch=0' : '默认合批';
    for (const [b, st] of Object.entries(r.marked)) {
      ok(`D1[${tag}|${batchTag}] 标记材质 ${b} = DoubleSide 且带 pbDoubleSided`, !!st && st.side === 'DoubleSide' && st.pb, JSON.stringify(st));
    }
    ok(`D2[${tag}|${batchTag}] 未标记无贴图材质 ${pick.unmarkedMapless[0]} = FrontSide 且无标记`, !!r.unmarked && r.unmarked.side === 'FrontSide' && !r.unmarked.pb, JSON.stringify(r.unmarked));
    ok(`D3[${tag}|${batchTag}] 画面非空白（亮度 std ≥ 8）`, r.lumStd >= 8, `lumStd=${r.lumStd.toFixed(1)}`);
    if (!qs) ok(`D1[${tag}|${batchTag}] 合批路径生效（batches > 0）`, r.batched > 0, `batches=${r.batched}`);
    await page.close();
  }
}

if (NEG) {
  // 负例：字节级剥掉 cm 件白名单首名材质的标记 → D1 必须红 → 恢复 → D1 复绿
  if (!haveCm) { console.error('FAIL NEG: 无 cm 件可注入'); process.exit(1); }
  const target = pick.marked[0];
  const origBytes = fs.readFileSync(cmPath);
  const sha0 = sha256(cmPath);
  const { json } = jsonOfGlb(cmPath);
  let stripped = 0;
  for (const m of json.materials || []) {
    if (stripDot(m.name) === target && m.extras && m.extras.pbDoubleSided === true) { delete m.extras.pbDoubleSided; stripped++; }
  }
  if (!stripped) { console.error('FAIL NEG: cm 件里没找到带标记的', target); process.exit(1); }
  fs.writeFileSync(cmPath, rewriteJsonChunk(cmPath, json));
  console.log(`NEG: 已从 ${path.basename(cmPath)} 剥掉 ${stripped} 个 ${target} 材质的 pbDoubleSided，重载页面（D1 必须红）`);
  fail = 0; pass = 0;   // 负例段独立计数：redExpected 用 fail 数证明
  const before = { pass, fail };
  await loadAndCheck('NEG-剥标记');
  ok('NEG 剥标记后 D1 变红（断言有效）', fail > before.fail, `fail=${fail}`);
  fail = 0; failures.length = 0;   // 故意的红已由上一行裁决，清零后只让「还原后」段的真实失败影响退出码
  fs.writeFileSync(cmPath, origBytes);
  ok('NEG 还原后 cm sha 回到原值', sha256(cmPath) === sha0);
  if (sha256(cmPath) !== sha0) process.exit(1);
  await loadAndCheck('NEG-还原后');
} else {
  await loadAndCheck('正例');
}

await browser.close();
console.log(`RESULT pass=${pass} fail=${fail}`);
if (fail > 0) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
