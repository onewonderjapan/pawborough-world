// tools/portable/closure.mjs — 从 OUT_DIR 的 zones-manifest.json + area web 源码
// 推导查看器实际读取的运行时闭包（fail-closed：缺件即报告，不猜测补齐）。
//
// 推导规则（每条都有源码依据，见 scene-authoring/yuyuan-area/web/*.js、scripts/server.mjs）：
//   R1 zones-manifest          /out/zones-manifest.json（main.js:265、walk.js:107）
//   R2 zone-raw                每个 zones[].file —— walk.js:108-113 拉原始分件取地面三角形
//   R3 zone-cm                 每个 zones[].cm.file —— main.js:194 默认加载压缩件
//   R4 zone-tex / texture-meta cm.textures[] 与顶层 textures{} 键 —— wave9-sharedtex 外置贴图
//   R5 web-literal             web/*.js 中字面量 '/out/<name>' 引用（layout/tour/commercial-route/
//                              connectivity/commerce-audit/nav-gap/fangbang-supersede/
//                              assemble-stats/scene-areas.glb 等）
//   R6 collision-zone          collision-<id>.json，id = manifest 分区 id 全集 ∪ {fangbang}
//                              （main.js collisionZones()：ZONES.all + fangbangReady）
// 附属推导（随代码包走，不属于 OUT_DIR 闭包，但恢复探针要用）：
//   vendor-src                 web/*.js 中 /vendor-src/<path> 导入（仓库根 src/）
//   moduleMap                  web/index.html importmap 的 three / rapier 路径
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJson, sha256File } from './lib.mjs';

const JS_REF = /['"`]\/out\/([A-Za-z0-9][A-Za-z0-9._-]*)['"`]/g;
const VENDOR_SRC_REF = /\/vendor-src\/([A-Za-z0-9][A-Za-z0-9._/-]*)/g;
// web 内的相对模块引用（如 walk.js 的 '../src/walkGround.js'）——server 以 area 根
// 提供这些路径（/src/...），属于恢复包代码白名单必须覆盖的“代码引用闭包”。
const AREA_REL_REF = /['"](\.\.?\/[A-Za-z0-9._/-]+)['"]/g;

export async function deriveRuntimeClosure({ outDir, zonesManifestPath, webDir }) {
  const files = new Map(); // rel -> { bytes, sha256, rules: [] }
  const notes = [];
  const add = (rel, rule) => {
    if (!files.has(rel)) files.set(rel, { rules: [] });
    const e = files.get(rel);
    if (!e.rules.includes(rule)) e.rules.push(rule);
  };

  const manifest = await readJson(zonesManifestPath);
  if (!manifest || !Array.isArray(manifest.zones)) {
    throw new Error(`BAD_ZONES_MANIFEST: ${zonesManifestPath} has no zones[]`);
  }
  const relManifest = path.basename(zonesManifestPath);
  add(relManifest, 'R1:zones-manifest');

  const zoneIds = new Set();
  for (const z of manifest.zones) {
    zoneIds.add(z.id);
    if (z.file) add(z.file, `R2:zone-raw:${z.id}`);
    if (z.cm && z.cm.file) {
      add(z.cm.file, `R3:zone-cm:${z.id}#${z.part ?? ''}`);
      for (const t of z.cm.textures || []) add(t, `R4:zone-tex:${z.id}#${z.part ?? ''}`);
    }
  }
  for (const t of Object.keys(manifest.textures || {})) add(t, 'R4:texture-meta');
  // collision 集合 = manifest 内出现过的分区 id 全集 + fangbang（fangbangReady 后并入）
  for (const id of [...zoneIds, 'fangbang']) add(`collision-${id}.json`, `R6:collision-zone:${id}`);

  // R5 + vendor-src + moduleMap：扫描 web 源码
  let webFiles = [];
  try { webFiles = (await fsp.readdir(webDir)).filter((f) => f.endsWith('.js')); }
  catch (e) { throw new Error(`BAD_WEB_DIR: ${webDir} (${e.message})`); }
  const vendorSrc = new Set();
  const areaRelative = new Set();
  for (const f of webFiles) {
    const src = await fsp.readFile(path.join(webDir, f), 'utf8');
    for (const m of src.matchAll(JS_REF)) {
      // 只收带扩展名的字面量；模板串前缀（如 '/out/collision-'）由 R2/R6 规则覆盖
      if (/\.[A-Za-z0-9]+$/.test(m[1])) add(m[1], `R5:web-literal:${f}`);
    }
    for (const m of src.matchAll(VENDOR_SRC_REF)) vendorSrc.add(m[1].replace(/['")].*$/, ''));
    for (const m of src.matchAll(AREA_REL_REF)) {
      // 以 /web/ 为基解析相对引用（URL 语义）：'../src/x.js' → '/src/x.js'，
      // 即 server 以 area 根提供的代码文件；仍在 web/ 内的引用随 web/ 整体打包
      const resolved = path.posix.normalize(path.posix.join('/web/', m[1]));
      if (!resolved.startsWith('/') || resolved.split('/').includes('..')) continue; // 解析后越出 area 根：非本仓代码
      const rel = resolved.replace(/^\//, '');
      if (rel === '' || rel.startsWith('web/')) continue;
      areaRelative.add(rel);
    }
  }
  let moduleMap = null;
  try {
    const html = await fsp.readFile(path.join(webDir, 'index.html'), 'utf8');
    const m = html.match(/<script type="importmap">(\{.*?\})<\/script>/s);
    if (m) moduleMap = JSON.parse(m[1]).imports || {};
  } catch { notes.push(`WARN: importmap parse failed in ${webDir}/index.html`); }

  // 对每个闭包文件取真实字节大小与 sha256；缺失即列入 missing（fail-closed，不补齐）。
  const missing = [];
  const resolved = [];
  for (const [rel, e] of files) {
    const abs = path.resolve(outDir, rel);
    if (path.resolve(outDir) !== abs && !abs.startsWith(path.resolve(outDir) + path.sep)) {
      throw new Error(`CLOSURE_PATH_ESCAPE: ${rel}`);
    }
    try {
      const st = await fsp.stat(abs);
      if (!st.isFile()) throw new Error('not a regular file');
      e.bytes = st.size;
      e.sha256 = await sha256File(abs);
      resolved.push({ path: rel, bytes: st.size, sha256: e.sha256, rules: e.rules });
    } catch {
      missing.push({ path: rel, rules: e.rules });
    }
  }
  resolved.sort((a, b) => a.path.localeCompare(b.path));
  missing.sort((a, b) => a.path.localeCompare(b.path));

  return {
    outDir: path.resolve(outDir),
    zonesManifestPath: path.resolve(zonesManifestPath),
    zonesManifest: {
      schema: manifest.schema ?? null,
      order: manifest.order ?? null,
      zoneEntryCount: manifest.zones.length,
      capPerZoneBytes: manifest.capPerZoneBytes ?? null,
    },
    files: resolved,
    missing,
    vendorSrc: [...vendorSrc].sort(),
    areaRelative: [...areaRelative].sort(),
    moduleMap,
    notes,
    totals: {
      files: resolved.length,
      bytes: resolved.reduce((s, f) => s + f.bytes, 0),
      glb: resolved.filter((f) => f.path.endsWith('.glb')).length,
      json: resolved.filter((f) => f.path.endsWith('.json')).length,
      tex: resolved.filter((f) => f.path.startsWith('tex/')).length,
    },
  };
}
