// wave14-viewerside 单双面契约浏览器检查（需起服务：BASE=http://127.0.0.1:5487/ OUT_DIR=out-zone）。
// 查的是查看器真实加载路径（默认 cm 件 + prepare() FrontSide 策略 + 运行时合批 + 灯光预设），真相从外部来：
//   - 期望名单：baseline/doublesided-materials.json（白名单 = 唯一真值）；
//   - 材质事实：out-zone 分区件 raw GLB 的 materials[]（map 有无、基名、是否被引用），本文件自解析，不读页面状态。
// 断言：
//   D1 覆盖白名单**每个基名**、场景里**每个实际材质变体**（运行时按名字收集全部实例，不是每基名只取第一个）：
//      选中覆盖全白名单的最小分区集逐区加载，每个变体 material.side === THREE.DoubleSide 且带
//      userData.pbDoubleSided（默认合批页与 ?batch=0 页都查）；
//   D2 未标记的「无贴图」材质是 FrontSide（主分区取一个不在白名单的无贴图被引用材质）——策略其余部分未被放宽；
//   D3 画面非空白：中心区域亮度标准差 ≥ 8/255（防止「断言挂在空帧上」）。
// 负例（NEG=1）：**请求拦截注入**——page.route 拦截目标分区 cm 件请求、fulfill 剥掉目标材质 pbDoubleSided 的
//   内存副本（不写盘、无恢复竞态）→ 加载页面 D1 必须红，且红必须**精确命中目标材质**（其余材质 / D2 / D3
//   出现任何连带失败都算 FAIL）；失败账本不整段清零，只有逐字命中的目标行被豁免（expectedNegRed），其余失败
//   进 unexpectedFail 并决定退出码。注：多件区 ?zone=<id> 一页拉全部分件，canvas 在 part1、btk 玻璃在楼阁件。
// Chromium 解析：CHROME_PATH 环境变量优先；否则交给 Playwright 管理的浏览器（registry / 默认缓存动态扫描）。
// 用法：BASE=http://127.0.0.1:5487/ OUT_DIR=out-zone node tests/doubleside-browser-check.mjs（NEG=1 只跑负例段）
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const BASE = process.env.BASE || 'http://127.0.0.1:5487/';
const NEG = process.env.NEG === '1';

let pass = 0, fail = 0;
const failures = [];
const expectedRed = new Set();   // NEG 段被精确豁免的失败行（逐字匹配，防「任意失败数增加」冒充）
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; failures.push(`${name}${detail ? ': ' + detail : ''}`); console.log('FAIL', name, detail); } };
const stripDot = (s) => String(s || '').replace(/\.\d{3}$/, '');
function jsonOfGlb(p) {
  const b = fs.readFileSync(p);
  if (b.readUInt32LE(0) !== 0x46546C67) throw new Error(p + ': not GLB');
  const n = b.readUInt32LE(12);
  return { json: JSON.parse(b.slice(20, 20 + n).toString('utf8')), bytes: b };
}
function rewriteJsonChunk(bytes, json) {
  // 字节级重写 JSON chunk（对内存 Buffer 操作，请求拦截注入用；不落盘）
  const n = bytes.readUInt32LE(12);
  const binStart = 20 + n, binLen = bytes.readUInt32LE(binStart), binType = bytes.slice(binStart + 4, binStart + 8);
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  const pad = (4 - (js.length % 4)) % 4;
  if (pad) js = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + binLen, 8);
  head.writeUInt32LE(js.length, 12); head.writeUInt32LE(0x4E4F534A, 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(binLen, 0); binType.copy(binHead, 4);
  return Buffer.concat([head, js, binHead, bytes.slice(binStart + 8)]);
}

// ---------- oracle（Node 侧独立解析）：按分区 id 分组（多件区一页全拉），贪心最小覆盖全白名单 ----------
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'doublesided-materials.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'zones-manifest.json'), 'utf8'));
const groups = new Map(); // id -> { id, files: [{file, cmPath}], marked: Set, unmarkedMapless: [base...] }
for (const e of manifest.zones.filter(z => z.file)) {
  const p = path.join(OUT, e.file);
  if (!fs.existsSync(p)) continue;
  const { json } = jsonOfGlb(p);
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
  if (!marked.length) continue;
  const unmarkedMapless = [...new Set(mats
    .filter(m => !(m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture))
    .map(m => stripDot(m.name))
    .filter(b => b && !cfg.materials.includes(b)))];
  const g = groups.get(e.id) || { id: e.id, files: [], marked: new Set(), unmarkedMapless: [] };
  g.files.push({ file: e.file, cmPath: p.replace(/\.glb$/, '.cm.glb'), relFile: path.basename(p).replace(/\.glb$/, '.cm.glb') });
  for (const b of marked) g.marked.add(b);
  if (!g.unmarkedMapless.length && unmarkedMapless.length) g.unmarkedMapless = unmarkedMapless;
  groups.set(e.id, g);
}
// 贪心最小覆盖：白名单每个基名都必须被至少一个选中分区覆盖（覆盖不了 = oracle 失败，不缩圈）
const want = [...cfg.materials];
const covered = new Set();
const cover = [];
while (covered.size < want.length) {
  let best = null;
  for (const g of groups.values()) {
    const gain = [...g.marked].filter(b => !covered.has(b)).length;
    if (gain > 0 && (!best || gain > best.gain)) best = { g, gain };
  }
  if (!best) break;
  cover.push(best.g);
  for (const b of best.g.marked) covered.add(b);
}
if (covered.size < want.length) {
  console.error('FAIL oracle: 白名单基名没有被任何分区件覆盖，缺：', want.filter(b => !covered.has(b)));
  process.exit(1);
}
const primary = cover.reduce((a, b) => (b.marked.size > a.marked.size ? b : a), cover[0]);
if (!primary.unmarkedMapless.length) {
  console.error('FAIL oracle: 主分区', primary.id, '没有未标记的无贴图材质可做 D2 样本');
  process.exit(1);
}
// 选中分区的 cm 件必须成对存在（缺失 = FAIL，不许跳过默认路径）
for (const g of cover) for (const f of g.files) {
  if (!fs.existsSync(f.cmPath)) { console.error('FAIL oracle: cm 件缺失（raw/cm 必须成对）', f.cmPath); process.exit(1); }
}
console.log(`oracle: cover=[${cover.map(g => g.id).join(',')}] 主分区=${primary.id} 白名单覆盖=[${want.join(',')}] D2 样本=${primary.unmarkedMapless[0]}`);

// ---------- Chromium 解析（R1 必修4：去个人绝对路径；CHROME_PATH 覆盖，否则 Playwright 自管） ----------
function resolveChromiumExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    if (fs.existsSync(chromium.executablePath())) return null;   // Playwright registry 管理的默认浏览器
  } catch { /* registry 未配置，走缓存扫描 */ }
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const revs = fs.readdirSync(cache)
      .map(d => { const m = /^chromium-(\d+)$/.exec(d); return m ? { d, rev: Number(m[1]) } : null; })
      .filter(Boolean).sort((a, b) => b.rev - a.rev);
    for (const { d } of revs) {
      const p = path.join(cache, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* 无默认缓存目录 */ }
  return null;
}
const launchArgs = ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];
const exe = resolveChromiumExecutable();
// GPU_WEBGL=1：机器 swiftshader WebGL 全灭时改走真 GPU（headless:false + 外部 DISPLAY/XAUTHORITY 环境变量，
// 例 GPU_WEBGL=1 DISPLAY=:0 XAUTHORITY=/run/user/1000/gdm/Xauthority）。默认仍 headless swiftshader。
const GPU = process.env.GPU_WEBGL === '1';
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), ...(GPU ? { headless: false } : {}), args: launchArgs });

async function loadAndCheck(tag, g, inject = null) {
  for (const qs of ['', '&batch=0']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    if (inject) await page.route('**/' + inject.file, route => route.fulfill({ body: inject.body, contentType: 'model/gltf-binary' }));
    page.on('pageerror', e => console.warn(`[warn][${tag}|zone=${g.id}] pageerror:`, String(e).slice(0, 200)));
    await page.goto(`${BASE}?zone=${g.id}&light=day${qs}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__firstLoadReady === true, null, { timeout: 900000 });
    const markedBases = [...g.marked];
    const r = await page.evaluate(async ({ marked, unmarked }) => {
      const THREE = await import('three');
      const scene = window.__scene;
      const out = { marked: {}, unmarked: null, batched: 0 };
      // D1 全变体收集：同一基名下每个运行时材质实例（含 .NNN 变体 / 合批后残留）都记下来
      const byBase = new Map();
      scene.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const arr = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of arr) {
          const base = String(m.name || '').replace(/\.\d{3}$/, '');
          if (!marked.includes(base)) continue;
          if (!byBase.has(base)) byBase.set(base, new Map());
          const bucket = byBase.get(base);
          const key = m.name || '(unnamed)';
          if (!bucket.has(key)) bucket.set(key, { name: key, n: 0, side: m.side === THREE.DoubleSide ? 'DoubleSide' : m.side === THREE.FrontSide ? 'FrontSide' : String(m.side), pb: !!(m.userData && m.userData.pbDoubleSided === true) });
          bucket.get(key).n++;
        }
      });
      for (const b of marked) {
        const bucket = byBase.get(b);
        out.marked[b] = bucket ? { variants: [...bucket.values()] } : null;   // null = 场景里没找到（覆盖缺口）
      }
      const findMat = (base) => {
        let found = null;
        scene.traverse((o) => {
          if (found || !o.isMesh || !o.material) return;
          const arr = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of arr) if (String(m.name || '').replace(/\.\d{3}$/, '') === base) { found = m; break; }
        });
        return found;
      };
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
    }, { marked: markedBases, unmarked: primary.unmarkedMapless[0] });
    const batchTag = qs ? 'batch=0' : '默认合批';
    // D1：覆盖 + 全变体
    for (const b of markedBases) {
      const st = r.marked[b];
      ok(`D1[${tag}|${batchTag}] 白名单 ${b} 在 zone=${g.id} 场景中有材质实例（覆盖）`, !!st && st.variants.length > 0, JSON.stringify(st));
      if (st) for (const v of st.variants) {
        ok(`D1[${tag}|${batchTag}] 标记材质 ${b}（变体 ${v.name} ×${v.n}）= DoubleSide 且带 pbDoubleSided`, v.side === 'DoubleSide' && v.pb, JSON.stringify(v));
      }
    }
    // D2 / D3 / 合批只在主分区查一次；合批生效断言只在默认合批页（batch=0 页合批本来就关）
    if (g === primary) {
      ok(`D2[${tag}|${batchTag}] 未标记无贴图材质 ${primary.unmarkedMapless[0]} = FrontSide 且无标记`, !!r.unmarked && r.unmarked.side === 'FrontSide' && !r.unmarked.pb, JSON.stringify(r.unmarked));
      ok(`D3[${tag}|${batchTag}] 画面非空白（亮度 std ≥ 8）`, r.lumStd >= 8, `lumStd=${r.lumStd.toFixed(1)}`);
      if (!qs) ok(`D4[${tag}|${batchTag}] 合批路径生效（batches > 0）`, r.batched > 0, `batches=${r.batched}`);
    }
    await page.close();
  }
}

if (NEG) {
  // 负例：请求拦截剥掉主分区某分件 cm 里目标材质的 pbDoubleSided → D1 必须红且精确命中 → 撤销注入 → D1 复绿。
  // 不改盘上文件：mutated 只存在于内存 Buffer，page.route 生命周期 = 页面生命周期，无恢复竞态。
  const target = [...primary.marked][0];
  const host = primary.files.find(f => {
    const { json } = jsonOfGlb(f.cmPath);
    return (json.materials || []).some(m => stripDot(m.name) === target && m.extras && m.extras.pbDoubleSided === true);
  });
  if (!host) { console.error('FAIL NEG: cm 件里没找到带标记的', target); process.exit(1); }
  const { json, bytes } = jsonOfGlb(host.cmPath);
  let stripped = 0;
  for (const m of json.materials || []) {
    if (stripDot(m.name) === target && m.extras && m.extras.pbDoubleSided === true) { delete m.extras.pbDoubleSided; stripped++; }
  }
  if (!stripped) { console.error('FAIL NEG: 剥标记失败', target); process.exit(1); }
  const mutated = rewriteJsonChunk(bytes, json);
  console.log(`NEG: 拦截 ${host.relFile} 剥掉 ${stripped} 个 ${target} 材质的 pbDoubleSided（内存副本，不落盘），重载页面（D1 必须红）`);
  const before = failures.length;
  await loadAndCheck('NEG-剥标记', primary, { file: host.relFile, body: mutated });
  const negFails = failures.slice(before);
  const targetFails = negFails.filter(x => x.includes(`标记材质 ${target}（变体`));
  const collateral = negFails.filter(x => !targetFails.includes(x));
  ok('NEG 剥标记后 D1 精确命中目标材质（断言有效）', targetFails.length > 0, targetFails.join(' | ') || '没有任何 D1 目标失败');
  for (const line of targetFails) expectedRed.add(line);   // 逐字豁免：只有目标行的红被豁免，账本不清零
  ok('NEG 无连带失败（其余材质/D2/D3/覆盖不受影响）', collateral.length === 0, collateral.join(' | '));
  await loadAndCheck('NEG-还原后', primary);   // 无注入：D1 应全绿
} else {
  for (const g of cover) await loadAndCheck('正例', g);
}

await browser.close();
const unexpected = failures.filter(x => !expectedRed.has(x));
console.log(`RESULT pass=${pass} fail=${fail} expectedNegRed=${expectedRed.size} unexpectedFail=${unexpected.length}`);
if (unexpected.length > 0) { for (const f of unexpected) console.log('  FAIL:', f); process.exit(1); }
