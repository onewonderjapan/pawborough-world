// 场景物化：layout.json -> 每区 THREE.Group -> procedural GLB（Node 导出）。
// 预览页在浏览器里加载最终 GLB；本模块只在构建期跑。
import fs from 'node:fs';
import {cutPassages} from './passage-clip.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  bbox, polyArea, centroid, offsetPolySafe, dist2d, principalAxis, orientRing,
  shapeMesh, shapeGeo, wallRing, makeRoof, ribbon, corridor, rock, tree,
  dropFloatingSegments, polySymDiffArea,
} from './lib.mjs';

// Node 下 GLTFExporter 需要 FileReader（无贴图也会走到该分支）
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((ab) => {
        this.result = ab;
        this.onloadend && this.onloadend({ target: this });
        this.onload && this.onload({ target: this });
      }, (e) => this.onerror && this.onerror(e));
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((ab) => {
        this.result = 'data:application/octet-stream;base64,' + Buffer.from(ab).toString('base64');
        this.onloadend && this.onloadend({ target: this });
        this.onload && this.onload({ target: this });
      }, (e) => this.onerror && this.onerror(e));
    }
  };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
// SITE_MODULES=1：墙/龙头/月洞门/九曲桥由站点模块 GLB（modules/garden-kit）承担，占位不再程序化生成。
// 默认（未设 flag）行为与基线逐字节一致。
const SITE_MODULES = process.env.SITE_MODULES === '1';
const SITE_MODULE_KINDS = new Set(['wall', 'wallHead', 'moonGateWall', 'zigzagBridge']);
// STALL_KIT=1：摊位/长凳由 modules/bazaar-stalls 实例模块承担（assemble.py 按 records/placements.json 放置），占位不再程序化生成。
const STALL_KIT = process.env.STALL_KIT === '1';
const STALL_KIT_KINDS = new Set(['stall', 'bench']);
// GARDEN_KITS=1：亭 5 座 / 廊 3 条 + 听涛阁水廊 / 全部园树由 modules/{pavilion,corridor,tree}-kit 承担；复廊 bld-428186469 由 modules/double-corridor 承担。
const GARDEN_KITS = process.env.GARDEN_KITS === '1';
const GARDEN_KIT_IDS = new Set(['bld-428179924', 'bld-428186467', 'bld-428196085', 'bld-428196091', 'bld-428196098',
  'bld-553893874', 'bld-428179906', 'bld-428179920', 'bld-428186469']);
// SANSUITANG=1：三穗堂 bld-428179901 由 modules/sansuitang 细化实例模块承担（assemble 按 footprint 形心放置），占位不再程序化生成。
const SANSUITANG = process.env.SANSUITANG === '1';
const SANSUITANG_IDS = new Set(['bld-428179901']);
// HALL_KIT=1（默认关）：园区厅堂由 modules/hall-kit 统一生成器承担（WP8 样板：仰山堂），assemble 按 footprint 面积形心放置。
const HALL_KIT = process.env.HALL_KIT === '1';
const HALL_KIT_IDS = new Set(['bld-428179902']);
// 假山站点模块默认开启（2026-09-23 机主定）：大假山 / 玉玲珑由 out-garden-kits 站点模块承担（assemble 导入 SITE-garden），
// 占位不再程序化生成。ROCKERY_KIT=0 退回程序化占位。
const ROCKERY_KIT = process.env.ROCKERY_KIT !== '0';
const ROCKERY_IDS = new Set(['rockery-dajiashan', 'rockery-yulinglong']);
// HUXINTING=1：湖心亭由 modules/huxinting 站点模块 GLB 承担（assemble 导入 SITE-pond），占位不再程序化生成。默认关。
const HUXINTING = process.env.HUXINTING === '1';
const HUXINTING_IDS = new Set(['huxin-ting']);
// BAZAAR_TOWERS=1：华宝楼 bld-428202599 由 modules/bazaar-tower-kit 世界坐标 GLB 承担
// （assemble.py 导入 SITE-bazaar，分区归 zone-bazaar-2）。默认关：未采用前保持程序化 bazaarBlock。
const BAZAAR_TOWERS = process.env.BAZAAR_TOWERS === '1';
const BAZAAR_TOWER_IDS = new Set(['bld-428202599']);
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));

// ---------- FANGBANG=1：方浜中路沿线路面片让位（V1-REDEFINITION：连接段 x -96.8..54、街段 54..138 精修归 fangbang） ----------
// 外围 L0 方浜中路路面片（y=0.02）会盖住 fangbang 沥青（y≈0）：466 裁到 v7 西端铺装西缘（v7 x=-150.3 →
// 地图 -96.8）以西，与 westext-surface 平接——裁到 -114 会在路的自身西端(-114.5)与 -96.8 间留 17.7m 裸地；
// 464 裁到街段以东（x>=138）；横穿的支路路面片保留（路口衔接，含安仁街）。默认关（无 FANGBANG 时管线不变）。
const FANGBANG_ROAD_CLIP = process.env.FANGBANG !== '0' ? {   // 默认开启（2026-09-24），FANGBANG=0 关闭
  'road-238219466': [-Infinity, -96.8],
  'road-238219464': [138, Infinity],
  'road-33683439': [138, Infinity],
} : null;
function clipPolyX(pts, xmin, xmax) {
  const side = (poly, keep, x) => {   // keep='min' 保留 x>=x，'max' 保留 x<=x
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ain = keep === 'min' ? a[0] >= x : a[0] <= x;
      const bin = keep === 'min' ? b[0] >= x : b[0] <= x;
      if (ain) out.push(a);
      if (ain !== bin) out.push([x, a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]))]);
    }
    return out;
  };
  let p = pts;
  if (Number.isFinite(xmin)) p = side(p, 'min', xmin);
  if (Number.isFinite(xmax)) p = side(p, 'max', xmax);
  return p;
}
function clipPolylineX(pts, xmin, xmax) {   // 开放折线：越界点剔除，边界处插值补点（ribbon 用）
  const out = [];
  const push = (q) => { const l = out[out.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); };
  const inside = (q) => (!Number.isFinite(xmin) || q[0] >= xmin) && (!Number.isFinite(xmax) || q[0] <= xmax);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (inside(p)) { push(p); continue; }
    for (const q of [pts[i - 1], pts[i + 1]]) {
      if (!q || !inside(q)) continue;
      const x = (!Number.isFinite(xmin) || p[0] < xmin) ? xmin : xmax;   // p 违反哪条边界就夹到哪条
      push([x, q[1] + (p[1] - q[1]) * ((x - q[0]) / (p[0] - q[0]))]);
    }
  }
  return out;
}

// ---------- 统一材质：合并几何 + 顶点色 ----------
// 单面材质：法线/绕序已按面向修正（tests/geo-tests.mjs 把关），不再 DoubleSide 兜底
const MAT_VERTEX = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, flatShading: true, side: THREE.FrontSide });

// ---------- P2 地面铺装（wave1-paving）：分区 × 类型 → 材质槽 ----------
// 槽名只在这里声明；贴图绑定在 scripts/export-zones.py（贴图由 scripts/bake-paving-textures.py
// 程序化生成，1024² JPEG，resources/textures/paving/）。庙前青石板：庙区无程序化地面
// （temple 内铺装在 temple-v3 模块 GLB 内，本次不动模块件），青石板槽落在台阶与池畔石面。
const PAVING_SLOTS = {
  'bazaar|paving': 'paving-fine-cobble',   // 商城街面：弹格路小方石
  'bazaar|plaza':  'paving-fine-cobble',   // 广场：同街面
  'garden|path':   'paving-grey-brick',    // 园路主径：青砖
  'pond|road':     'paving-fine-cobble',   // 园内街巷（池带小路-62072384，宽 3.5m）：同街面小方石
  'pond|path':     'paving-pebble',        // 池畔径：卵石
  'pond|steps':    'paving-blue-stone',    // 台阶（九曲桥两端）：青石板，几何不动
  'outer|road':    'paving-asphalt',       // 外围道路：沥青灰
};
// 园路支径走卵石（卵石镶边语言的支路），其余 garden path（门楼—三穗堂主径与东区主园路）走青砖
const PEBBLE_PATH_IDS = new Set(['gpath-4', 'gpath-5', 'gpath-6', 'gpath-7']);
function pavingSlot(o) {
  const s = PAVING_SLOTS[`${o.zone}|${o.kind}`];
  if (!s) return null;
  return (o.kind === 'path' && PEBBLE_PATH_IDS.has(o.id)) ? 'paving-pebble' : s;
}
// 世界坐标盒式投影 UV，1 单位 = 1 m（贴图平铺周期 1 m）：水平面投 (x,z)，
// 竖直面按主导法线轴投 (z,y) 或 (x,y)。只写 uv 属性，不新增三角面。
function worldUV(geo) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    if (ny >= nx && ny >= nz) { uv[2 * i] = x; uv[2 * i + 1] = z; }
    else if (nx >= nz)        { uv[2 * i] = z; uv[2 * i + 1] = y; }
    else                      { uv[2 * i] = x; uv[2 * i + 1] = y; }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function colorize(geoIn, hex) {
  // 统一非索引：硬边法线生效 + mergeGeometries 属性一致性（索引/非索引不能混并）
  const geo = geoIn.index ? geoIn.toNonIndexed() : geoIn;
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  // 保留 normal（有则留），无则给朝上法线；其余属性删除，保证 mergeGeometries 属性一致
  if (!geo.attributes.normal) {
    const nn = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) nn[i * 3 + 1] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  }
  for (const name of Object.keys(geo.attributes)) {
    if (name !== 'position' && name !== 'color' && name !== 'normal') geo.deleteAttribute(name);
  }
  return geo;
}

// 收集 object3D 下所有 mesh 的几何（应用世界矩阵）+ 材质色
function flattenParts(root) {
  const parts = [];
  root.updateMatrixWorld(true);
  root.traverse(node => {
    if (node.isMesh) {
      const g = node.geometry.clone().applyMatrix4(node.matrixWorld);
      const hex = node.material.vertexColors ? 0xffffff : (node.material.color ? node.material.color.getHex() : 0x888888);
      parts.push(colorize(g, hex));
    }
  });
  return parts;
}

function mergedMesh(parts, name, userData) {
  if (!parts || !parts.length) return null;
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (!merged) return null;
  const m = new THREE.Mesh(merged, MAT_VERTEX);
  m.name = name;
  if (userData) m.userData = userData;
  return m;
}

// ---------- kind 构建器（返回 merged mesh 或 group） ----------
function buildOuterBuilding(o) {
  const fp = o.geometry.footprint;
  const h = o.height || 6;
  const base = 0xb4a890 + ((hashStr(o.id) % 5) * 0x040302); // id 是字符串：Math.abs() 会得 NaN→纯黑墙（G3 修复）
  const floor = shapeGeo(fp, 0);
  const top = shapeGeo(fp, h);
  const walls = wallRing(fp, 0, h, base, 'w');
  const parts = [colorize(floor, 0x9a8f7c), colorize(top, 0x87806f), ...flattenParts(walls)];
  return mergedMesh(parts, o.key, o.ud);
}

// 商城大楼壳 L1：黄墙 + 楼层线脚 + 临街分间窗组 + 转角壁柱 + 檐下托檐带 + 檐口。
// G3：窗组按开间分段（打破整条通带/大空白墙），转角壁柱打破体块转角，檐下托檐只在临街边（控三角预算）。
// mansard 仅在 OSM 有标签时使用。
function buildBazaarBlock(o) {
  const fp = o.geometry.footprint;
  const h = o.height || 12;
  const levels = o.levels || Math.max(1, Math.round(h / 3.4));
  const parts = [];
  parts.push(colorize(shapeGeo(fp, 0), 0x9a8f7c));
  parts.push(...flattenParts(wallRing(fp, 0, h * 0.8, 0xcac2b0, 'w')));
  const floorH = (h * 0.8) / levels;
  // 楼层线脚：每层一道窄出檐环（水平层次）
  const bandRing = offsetPolySafe(fp, 0.06);
  for (let f = 1; f < levels; f++) {
    const y = f * floorH;
    if (y > h * 0.8 - 0.5) break;
    if (bandRing.method !== 'original') {
      parts.push(...flattenParts(wallRing(bandRing.pts, y - 0.05, y + 0.07, 0xb8b0a0, 'c')));
    }
  }
  // 转角壁柱：每个轮廓顶点一根半嵌壁柱（破除体块转角的单调）
  const pierH = h * 0.8 + 0.15;
  for (const [px, pz] of fp) {
    const pier = new THREE.BoxGeometry(0.45, pierH, 0.45);
    pier.translate(px, pierH / 2, pz);
    parts.push(colorize(pier, 0xb9af9c));
  }
  // 顶部主檐口 + 檐下暗带（檐下阴影线，非同一裙顶）
  parts.push(...flattenParts(wallRing(offsetPolySafe(fp, 0.1).pts, h * 0.8 - 0.55, h * 0.8 - 0.32, 0x8a7a62, 'sv')));
  parts.push(...flattenParts(wallRing(offsetPolySafe(fp, 0.2).pts, h * 0.8 - 0.3, h * 0.8 + 0.15, 0x6b4a33, 'b')));
  if (o.name) parts.push(...flattenParts(wallRing(offsetPolySafe(fp, 0.26).pts, h * 0.8 + 0.15, h * 0.8 + 0.3, 0x7c5a3e, 'b2')));
  // 临街边：上部每层分间窗组（窗+窗台，开间节奏）+ 檐下托檐块 + 店铺层窗楣通带
  const frontEdges = o.frontEdges || [];
  for (const fe of frontEdges) {
    const [a, b] = fe.edge;
    const len = dist2d(a, b);
    if (len < 5) continue;
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const nBay = Math.max(1, Math.round(len / 5));
    const bayW = len / nBay;
    // 边切向（rotateY(ang) 后盒体局部 +Z 对齐边方向）
    const ux = Math.sin(ang), uz = Math.cos(ang);
    const put = (w, bh, depth, y, lx, hex) => {
      const g = new THREE.BoxGeometry(depth, bh, w);
      g.rotateY(ang);
      g.translate(cx + fe.dir[0] * (0.04 + depth / 2) + ux * lx, y, cz + fe.dir[1] * (0.04 + depth / 2) + uz * lx);
      parts.push(colorize(g, hex));
    };
    for (let i = 0; i < nBay; i++) {
      const lx = (i + 0.5) * bayW - len / 2;
      for (let f = 1; f < levels; f++) {
        const y = f * floorH;
        if (y > h * 0.8 - 0.7) break;
        put(bayW * 0.42, floorH * 0.42, 0.07, y + floorH * 0.28, lx, 0x4a5560);            // 窗
        put(bayW * 0.5, 0.09, 0.12, y + floorH * 0.26 - floorH * 0.21, lx, 0xa89f8d);      // 窗台
      }
    }
    // 檐下托檐块：沿临街边每 ~2.2m 一小块
    const nBracket = Math.max(2, Math.round(len / 2.2));
    for (let i = 0; i < nBracket; i++) {
      const lx = (i + 0.5) * (len / nBracket) - len / 2;
      put(0.3, 0.16, 0.34, h * 0.8 - 0.42, lx, 0x6b4a33);
    }
    put(len * 0.97, 0.45, 0.07, 4.5, 0, 0x6b4a33); // 店铺层窗楣通带
  }
  // 屋面：mansard 仅 OSM 标签支持；否则类别默认 hip
  const upper = offsetPolySafe(fp, -Math.max(1.2, bbox(fp).w * 0.06));
  if (o.roofMode === 'mansard' && upper.method === 'offset') {
    parts.push(...flattenParts(wallRing(upper.pts, h * 0.8, h * 0.97, 0x565052, 'mw')));
    parts.push(colorize(shapeGeo(upper.pts, h * 0.97), 0x4c484d));
    const cap = makeRoof(upper.pts, { eave: h * 0.97, rise: 1.1, mode: 'hip', name: 'r' });
    parts.push(...flattenParts(cap));
  } else {
    const cap = makeRoof(fp, { eave: h * 0.8, rise: 2.2, mode: 'hip', name: 'r' });
    parts.push(...flattenParts(cap));
  }
  return mergedMesh(parts, o.key, o.ud);
}

// ---------- G2 园建类别模板共用件 ----------
// 边框：绕序规范化后的每条边 + 外向法线 + 沿边旋转角（+Z 映射到边方向）
function edgeFrames(fp) {
  const pts = orientRing(fp);
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    out.push({ a, b, len, ux: dx / len, uz: dz / len, nx: dz / len, nz: -dx / len, ang: Math.atan2(dx / len, dz / len) });
  }
  return out;
}

// 主朝向边：外向法线与 facade dir 点积最大（短边罚分）
function pickEdge(fp, dir) {
  let best = null, bd = -Infinity;
  for (const e of edgeFrames(fp)) {
    const d = e.nx * dir[0] + e.nz * dir[1] - (e.len < 3.2 ? 0.6 : 0);
    if (d > bd) { bd = d; best = e; }
  }
  return best;
}

// 柱廊：沿边等距圆柱（柱面外移 0.16m 贴墙平面），bayCount 可指定（三穗堂五开间）
function colonnadeParts(edge, y0, y1, opts = {}) {
  const { n = Math.max(2, Math.round(edge.len / 2.8)), hex = 0x8a4a3a } = opts;
  if (edge.len < 5.5 || y1 - y0 < 1.2) return [];
  const parts = [];
  for (let k = 0; k <= n; k++) {
    const t = ((k + 0.5) * edge.len) / (n + 1);
    const c = new THREE.CylinderGeometry(0.12, 0.135, y1 - y0, 6);
    c.translate(edge.a[0] + edge.ux * t + edge.nx * 0.16, (y0 + y1) / 2, edge.a[1] + edge.uz * t + edge.nz * 0.16);
    parts.push(colorize(c, hex));
  }
  return parts;
}

// 窗带/格扇带：贴墙深色薄带（外凸 0.05 避免同面 z-fight）
function bandParts(edge, y, h, opts = {}) {
  const { hex = 0x4a3a30, margin = 0.55, out = 0.05 } = opts;
  const L = edge.len - margin * 2;
  if (L < 0.6) return [];
  const g = new THREE.BoxGeometry(0.06, h, L);
  g.rotateY(edge.ang);
  g.translate((edge.a[0] + edge.b[0]) / 2 + edge.nx * out, y + h / 2, (edge.a[1] + edge.b[1]) / 2 + edge.nz * out);
  return [colorize(g, hex)];
}

// 门洞：主朝向边中点的深色内缩板（低模读作入口）
function doorPart(edge, y0, opts = {}) {
  const { w = Math.min(1.8, edge.len * 0.3), h = 2.5, hex = 0x352c26 } = opts;
  if (edge.len < 4) return [];
  const g = new THREE.BoxGeometry(0.09, h, w);
  g.rotateY(edge.ang);
  g.translate((edge.a[0] + edge.b[0]) / 2 + edge.nx * 0.05, y0 + h / 2, (edge.a[1] + edge.b[1]) / 2 + edge.nz * 0.05);
  return [colorize(g, hex)];
}

// 坐凳栏：檐下矮栏带
function railParts(edge, y, opts = {}) {
  const { hex = 0x7a5a44, h = 0.45 } = opts;
  const L = edge.len - 0.7;
  if (L < 0.8) return [];
  const g = new THREE.BoxGeometry(0.1, h, L);
  g.rotateY(edge.ang);
  g.translate((edge.a[0] + edge.b[0]) / 2 + edge.nx * 0.14, y + h / 2, (edge.a[1] + edge.b[1]) / 2 + edge.nz * 0.14);
  return [colorize(g, hex)];
}

// 檐角起翘暗示：四坡檐口四角的小斜块（克制，不逐角雕琢）
function cornerFlips(fp, eaveY, hex = 0x5b4232) {
  const parts = [];
  for (const e of edgeFrames(fp)) {
    for (const end of ['a', 'b']) {
      const p = e[end];
      const back = end === 'a' ? [e.ux, e.uz] : [-e.ux, -e.uz];
      const g = new THREE.BoxGeometry(0.34, 0.16, 0.5);
      g.rotateY(e.ang);
      g.translate(p[0] + back[0] * 0.1, eaveY + 0.12, p[1] + back[1] * 0.1);
      parts.push(colorize(g, hex));
    }
  }
  return parts;
}

// 厅/楼/亭/轩/榭/戏台：类别模板（复用件，不逐栋微雕）。
// 形制证据：三穗堂 G21（重檐+五开间柱廊）、点春堂 G18（围廊类两层）、打唱台 G20（敞亭）、
// 得月楼 G14（围平座）、玉华堂 G16（格扇+月洞）、水廊 G19；会景楼覆盖不足只做类别样板。
function buildGardenBuilding(o) {
  const fp = o.geometry.footprint;
  const focus = o.nodeFocus || {};
  const facade = o.facade || { dir: [0, 1] };
  const parts = [];
  const roofParts = [];
  const isStage = o.kind === 'stage';
  const platH = focus.plinth ?? (isStage ? 0.9 : 0.32);
  const plat = offsetPolySafe(fp, 0.45).pts;
  parts.push(colorize(shapeGeo(plat, platH * 0.55), 0x9b917f));
  parts.push(...flattenParts(wallRing(plat, 0, platH * 0.55, 0x8a8172, 'p')));
  const edges = edgeFrames(fp);
  const fEdge = pickEdge(fp, facade.dir);
  // 台阶移到主朝向边（原 ±X 固定侧改为朝向园路/水面一侧）
  {
    const stepW = Math.min(2.4, fEdge.len * 0.5), stepD = 1.1;
    const st = new THREE.BoxGeometry(stepW, platH * 0.55, stepD);
    st.rotateY(fEdge.ang);
    st.translate((fEdge.a[0] + fEdge.b[0]) / 2 + fEdge.nx * (0.2 + stepD / 2), platH * 0.27, (fEdge.a[1] + fEdge.b[1]) / 2 + fEdge.nz * (0.2 + stepD / 2));
    parts.push(colorize(st, 0x9b917f));
  }
  const eave = o.eave ?? 4.0;
  const rise = o.rise ?? 1.9;
  const yW = platH * 0.55;
  const roofMode = o.roofMode === 'gabled' ? 'gabled' : 'hip';

  if (isStage || focus.openStage) {
    // 戏台：高台基 + 四角柱 + 敞演面 + 背墙 + 全周边坐凳栏 + 陡四坡顶
    const cornerCols = [];
    for (const e of edges) {
      cornerCols.push([e.a[0] + e.nx * -0.3, e.a[1] + e.nz * -0.3]);
    }
    for (const [cx, cz] of cornerCols.slice(0, Math.max(4, edges.length))) {
      const c = new THREE.CylinderGeometry(0.14, 0.16, eave, 6);
      c.translate(cx, yW + eave / 2, cz);
      parts.push(colorize(c, 0x8a4a3a));
    }
    // 背墙（朝向最背离 facade 的边）
    let backE = edges[0], bd = Infinity;
    for (const e of edges) {
      const d = e.nx * facade.dir[0] + e.nz * facade.dir[1];
      if (d < bd) { bd = d; backE = e; }
    }
    const bw = new THREE.BoxGeometry(0.14, eave - 0.4, backE.len - 0.7);
    bw.rotateY(backE.ang);
    bw.translate((backE.a[0] + backE.b[0]) / 2 - backE.nx * 0.25, yW + (eave - 0.4) / 2, (backE.a[1] + backE.b[1]) / 2 - backE.nz * 0.25);
    parts.push(colorize(bw, 0xd8d2c4));
    for (const e of edges) {
      if (e === backE) continue;
      parts.push(...railParts(e, yW, { hex: 0x8a4a3a, h: 0.5 }));
      if (e === fEdge) parts.push(...bandParts(e, yW + eave * 0.55, 0.5, { hex: 0x4a3a30, margin: 0.9 }));
    }
    roofParts.push(...flattenParts(makeRoof(fp, { eave: yW + eave, rise: Math.max(rise, 2.2), mode: 'hip', name: 'r' })));
    roofParts.push(...cornerFlips(fp, yW + eave));
  } else if (focus.doubleEave) {
    // 三穗堂（G21）：重檐——下半柱廊 + 腰檐环（带洞四坡）+ 上段墙 + 主顶
    const midY = yW + eave * 0.55;
    parts.push(...flattenParts(wallRing(fp, yW, midY, 0xd8d2c4, 'w')));
    parts.push(...colonnadeParts(fEdge, yW, midY - 0.1, { n: focus.bayCount || undefined }));
    parts.push(...doorPart(fEdge, yW));
    if (focus.frontRail) parts.push(...railParts(fEdge, yW));
    parts.push(...bandParts(fEdge, midY - 1.15, 0.85, { hex: 0x4a3a30 }));
    const hole = offsetPolySafe(fp, -0.55);
    if (hole.method !== 'original') {
      roofParts.push(...flattenParts(makeRoof(fp, { eave: midY, rise: 0.8, mode: 'hip', overhang: 0.2, holes: [hole.pts], name: 'skirt' })));
    }
    parts.push(...flattenParts(wallRing(fp, midY, yW + eave, 0xcfc8ba, 'u')));
    roofParts.push(...flattenParts(makeRoof(fp, { eave: yW + eave, rise, mode: roofMode, name: 'r' })));
  } else if (o.kind === 'tower' || o.storeys === 2) {
    // 楼：底层实墙 + 底层柱廊/门 + 收分上层 + 上层环窗带 + 平座栏（得月楼全周边）
    parts.push(...flattenParts(wallRing(fp, yW, yW + eave, 0xd8d2c4, 'w')));
    parts.push(...colonnadeParts(fEdge, yW, yW + Math.min(eave * 0.75, 3.4)));
    parts.push(...doorPart(fEdge, yW));
    parts.push(...bandParts(fEdge, yW + eave * 0.42, Math.min(1.1, eave * 0.28), { hex: 0x4a3a30 }));
    const upper = offsetPolySafe(fp, -0.9).pts;
    parts.push(...flattenParts(wallRing(upper, yW + eave, yW + eave + 2.6, 0xcfc8ba, 'u')));
    const band = wallRing(offsetPolySafe(fp, 0.15).pts, yW + eave - 0.25, yW + eave + 0.1, 0x6b4a33, 'b');
    parts.push(...flattenParts(band));
    for (const e of edgeFrames(upper)) parts.push(...bandParts(e, yW + eave + 0.7, 1.15, { hex: 0x4a3a30, margin: 0.4 }));
    for (const e of edges) {
      if (focus.wrapBalcony || e === fEdge) {
        parts.push(...railParts(e, yW + eave + 0.12, { hex: 0x6b4a33, h: 0.4 }));
      }
    }
    roofParts.push(...flattenParts(makeRoof(upper, { eave: yW + eave + 2.6, rise, mode: roofMode, name: 'r' })));
  } else if (o.kind === 'pavilion') {
    // 亭：角柱 + 半墙坐凳（开敞） + 攒顶
    const sillH = 0.6;
    parts.push(...flattenParts(wallRing(fp, yW, yW + sillH, 0xd8d2c4, 's')));
    for (const e of edges) {
      for (const p of [e.a, e.b]) {
        const c = new THREE.CylinderGeometry(0.11, 0.13, eave - sillH, 6);
        c.translate(p[0] - e.nx * 0.18, yW + sillH + (eave - sillH) / 2, p[1] - e.nz * 0.18);
        parts.push(colorize(c, 0x8a4a3a));
      }
    }
    roofParts.push(...flattenParts(makeRoof(fp, { eave: yW + eave, rise: Math.max(rise, 2.1), mode: 'hip', name: 'r' })));
    roofParts.push(...cornerFlips(fp, yW + eave));
  } else if (o.kind === 'waterside') {
    // 榭/舫：临水面全开柱廊 + 坐凳栏 + 格扇带，背实墙
    parts.push(...flattenParts(wallRing(fp, yW, yW + eave, 0xd8d2c4, 'w')));
    parts.push(...colonnadeParts(fEdge, yW, yW + eave - 0.6));
    parts.push(...railParts(fEdge, yW));
    parts.push(...bandParts(fEdge, yW + eave * 0.45, eave * 0.3, { hex: 0x4a3a30 }));
    roofParts.push(...flattenParts(makeRoof(fp, { eave: yW + eave, rise, mode: roofMode, name: 'r' })));
  } else {
    // 厅/轩：实墙 + 主朝向柱廊 + 门 + 格扇带（轩用四坡，厅双坡）
    parts.push(...flattenParts(wallRing(fp, yW, yW + eave, 0xd8d2c4, 'w')));
    parts.push(...colonnadeParts(fEdge, yW, yW + Math.min(eave * 0.75, 3.2)));
    parts.push(...doorPart(fEdge, yW));
    parts.push(...bandParts(fEdge, yW + eave * 0.42, Math.min(1.05, eave * 0.26), { hex: 0x4a3a30 }));
    if (focus.latticeFacade) for (const e of edges) {
      if (e !== fEdge) parts.push(...bandParts(e, yW + eave * 0.42, Math.min(1.05, eave * 0.26), { hex: 0x4a3a30, margin: 0.7 }));
    }
    roofParts.push(...flattenParts(makeRoof(fp, { eave: yW + eave, rise, mode: roofMode, name: 'r' })));
  }
  const body = mergedMesh(parts, o.key, o.ud);
  const udR = { ...o.ud, roof: true };
  const roofMesh = mergedMesh(roofParts, o.key + '|roofpart', udR);
  return [body, roofMesh];
}

// 听涛阁（显式重归类）：积玉水廊有顶游廊 + 端头两层阁楼（G19）
function buildWatersideGallery(o) {
  const pts = o.geometry.polyline;
  const parts = [];
  parts.push(...flattenParts(corridor(pts, o.width || 2.6, o.key)));
  if (o.endPavilion) {
    const ep = o.endPavilion;
    const endPt = ep.end === 1 ? pts[pts.length - 1] : pts[0];
    const nb = ep.end === 1 ? pts[pts.length - 2] : pts[1];
    let ux = endPt[0] - nb[0], uz = endPt[1] - nb[1];
    const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const nx = -uz, nz = ux;
    const ex = endPt[0] + ux * 1.2, ez = endPt[1] + uz * 1.2;
    const bw = Math.min(7.5, Math.max(4.5, ep.widthM * 0.72)), bd = 4.8;
    const rect = (hw, hd) => [
      [ex - nx * hw - ux * hd, ez - nz * hw - uz * hd],
      [ex + nx * hw - ux * hd, ez + nz * hw - uz * hd],
      [ex + nx * hw + ux * hd, ez + nz * hw + uz * hd],
      [ex - nx * hw + ux * hd, ez - nz * hw + uz * hd],
    ];
    parts.push(colorize(shapeGeo(rect(bw / 2 + 0.3, bd / 2 + 0.3), 0.32), 0x9b917f));
    parts.push(...flattenParts(wallRing(rect(bw / 2, bd / 2), 0.32, 3.2, 0xd8d2c4, 'g')));
    for (const e of edgeFrames(rect(bw / 2, bd / 2))) parts.push(...bandParts(e, 1.3, 1.2, { hex: 0x4a3a30, margin: 0.4 }));
    parts.push(...flattenParts(wallRing(rect(bw / 2 + 0.1, bd / 2 + 0.05), 3.2, 3.62, 0x6b4a33, 'b')));
    const up = rect(bw / 2 - 0.7, bd / 2 - 0.6);
    parts.push(...flattenParts(wallRing(up, 3.62, 5.7, 0xcfc8ba, 'u')));
    for (const e of edgeFrames(up)) parts.push(...bandParts(e, 4.25, 1.05, { hex: 0x4a3a30, margin: 0.35 }));
    parts.push(...flattenParts(wallRing(rect(bw / 2 + 0.25, bd / 2 + 0.2), 3.62, 4.02, 0x7a5a44, 'r')));
    parts.push(...flattenParts(makeRoof(up, { eave: 5.7, rise: 1.7, mode: 'hip', name: 'r' })));
    parts.push(...cornerFlips(up, 5.7));
  }
  return mergedMesh(parts, o.key, o.ud);
}

function buildBridge(o) {
  const pts = o.geometry.polyline;
  const parts = [];
  const w = o.width || 2.6;
  // 拱面：沿折线采样抬升
  const L = pts.reduce((s, p, i) => (i ? s + dist2d(pts[i - 1], p) : 0), 0);
  const deck = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) acc += dist2d(pts[i - 1], pts[i]);
    const t = acc / (L || 1);
    const arch = Math.sin(t * Math.PI) * 0.55;
    deck.push([pts[i][0], (o.deckY || 0.5) + arch, pts[i][1]]);
  }
  const deckGeo = ribbon(deck.map(p => [p[0], p[2]]), w, 0, 0xffffff, 'd').geometry;
  deckGeo.translate(0, 0, 0);
  // 手动把高度写回
  {
    const pos = deckGeo.attributes.position;
    const n = pos.count;
    for (let i = 0; i < n; i++) {
      // ribbon 顶点成对出现，配对采样点
      const idx = Math.floor(i / 2);
      pos.setY(i, deck[Math.min(idx, deck.length - 1)][1]);
    }
  }
  parts.push(colorize(deckGeo, 0xa39a88));
  // 栏板
  for (const s of [-1, 1]) {
    const rail = deck.map(p => {
      const i = deck.indexOf(p);
      const a = deck[Math.max(0, i - 1)], b = deck[Math.min(deck.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[2] - a[2];
      const l = Math.hypot(dx, dz) || 1;
      return [p[0] + (-dz / l) * s * (w / 2 - 0.08), p[2] + (dx / l) * s * (w / 2 - 0.08)];
    });
    const railGeo = ribbon(rail, 0.16, 0, 0xffffff, 'r').geometry;
    const pos = railGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const idx = Math.floor(i / 2);
      pos.setY(i, deck[Math.min(idx, deck.length - 1)][1] + 0.5);
    }
    parts.push(colorize(railGeo, 0x8d8578));
  }
  // 桥墩
  for (let i = 1; i < deck.length - 1; i += 4) {
    const pier = new THREE.BoxGeometry(0.8, (o.deckY || 0.5) + 0.6, 0.8);
    pier.translate(deck[i][0], ((o.deckY || 0.5) + 0.6) / 2 - 0.5, deck[i][2]);
    parts.push(colorize(pier, 0x87806f));
  }
  return mergedMesh(parts, o.key, o.ud);
}

function buildZigzagBridge(o) {
  const pts = o.geometry.polyline;
  const parts = [];
  const deckGeo = ribbon(pts, o.width || 2.4, o.deckY || 0.55, 0xffffff, 'd').geometry;
  parts.push(colorize(deckGeo, 0xa39a88));
  for (const s of [-1, 1]) {
    const rail = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      return [p[0] + (-dz / l) * s * ((o.width || 2.4) / 2 - 0.08), p[1] + (dx / l) * s * ((o.width || 2.4) / 2 - 0.08)];
    });
    const railTop = ribbon(rail, 0.14, (o.deckY || 0.55) + 0.5, 0xffffff, 'r').geometry;
    parts.push(colorize(railTop, 0x6b4a33));
    const railBot = ribbon(rail, 0.1, (o.deckY || 0.55) + 0.18, 0xffffff, 'r2').geometry;
    parts.push(colorize(railBot, 0x6b4a33));
  }
  // 水中桩
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist2d(pts[i - 1], pts[i]);
  acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += dist2d(pts[i - 1], pts[i]);
    if (Math.round(acc / 3) !== Math.round((acc - dist2d(pts[i - 1], pts[i])) / 3)) {
      const post = new THREE.CylinderGeometry(0.14, 0.14, 1.4, 5);
      post.translate(pts[i][0], (o.deckY || 0.55) - 0.7, pts[i][1]);
      parts.push(colorize(post, 0x5d4630));
    }
  }
  return mergedMesh(parts, o.key, o.ud);
}
let acc = 0;

function buildRockery(o) {
  const parts = [];
  for (const r of o.geometry.rocks) {
    parts.push(...flattenParts(rock(r.x, r.z, r.size, r.h, 'rk', r.seed)));
  }
  return mergedMesh(parts, o.key, o.ud);
}

function buildTree(o) {
  return tree(o.geometry.position[0], o.geometry.position[1], o.height, o.key);
}

function buildWall(o) {
  const parts = [];
  // M3：temple-wall 两端悬空的孤立段（第 19 段空地薄板）不生成占位几何（与站点模块重建一致）
  const segs = o.id === 'temple-wall' ? dropFloatingSegments(o.geometry.segments) : o.geometry.segments;
  for (const [a, b] of segs) {
    const len = dist2d(a, b);
    if (len < 0.5) continue;
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const body = new THREE.BoxGeometry(o.thickness || 0.45, o.height, len);
    body.translate(0, o.height / 2, 0);
    const m = new THREE.Matrix4().makeRotationY(ang).setPosition(cx, 0, cz);
    body.applyMatrix4(m);
    parts.push(colorize(body, o.id === 'garden-wall' ? 0xd9d3c5 : 0xa39a88));
    const cap = new THREE.BoxGeometry((o.thickness || 0.45) + 0.18, 0.16, len);
    cap.translate(0, o.height + 0.08, 0);
    cap.applyMatrix4(m);
    parts.push(colorize(cap, 0x5f6b70));
  }
  // G2 漏窗：暗底板 + 两道浅色横条（简化格纹，非雕花复刻）
  for (const lw of o.geometry.lattice || []) {
    const mk = (w2, h2, d2, y, hex) => {
      const g = new THREE.BoxGeometry(d2, h2, w2);
      g.rotateY(lw.rotY);
      g.translate(lw.x, y, lw.z);
      parts.push(colorize(g, hex));
    };
    mk(1.3, 1.1, 0.52, 1.55, 0x3f4a50);
    mk(1.22, 0.1, 0.54, 1.35, 0xcfc6b4);
    mk(1.22, 0.1, 0.54, 1.75, 0xcfc6b4);
  }
  // G2 门洞框：缺口两侧柱 + 顶楣
  for (const df of o.geometry.doorFrames || []) {
    const dx = Math.sin(df.rotY), dz = Math.cos(df.rotY);
    for (const s of [-1, 1]) {
      const post = new THREE.BoxGeometry(0.28, o.height + 0.3, 0.34);
      post.rotateY(df.rotY);
      post.translate(df.x + dx * (df.widthM / 2) * s, (o.height + 0.3) / 2, df.z + dz * (df.widthM / 2) * s);
      parts.push(colorize(post, 0x8a8172));
    }
    const lintel = new THREE.BoxGeometry(0.36, 0.24, df.widthM + 0.6);
    lintel.rotateY(df.rotY);
    lintel.translate(df.x, o.height + 0.42, df.z);
    parts.push(colorize(lintel, 0x5f6b70));
  }
  return mergedMesh(parts, o.key, o.ud);
}

// G2 龙头：可辨认低模盒组（吻/颚/角/眼），放在墙段端头，不逐笔雕饰
function buildWallHead(o) {
  const { x, z, rotY } = o.geometry;
  const parts = [];
  const put = (lx, ly, lz, w2, h2, d2, hex, tiltX = 0) => {
    const g = new THREE.BoxGeometry(w2, h2, d2);
    if (tiltX) g.rotateX(tiltX);
    g.rotateY(rotY);
    g.translate(x + Math.sin(rotY) * lz - Math.cos(rotY) * lx, ly, z + Math.cos(rotY) * lz + Math.sin(rotY) * lx);
    parts.push(colorize(g, hex));
  };
  put(0, 3.35, 0.55, 0.95, 0.85, 1.15, 0x9a958a);          // 头体
  put(0, 3.25, 1.35, 0.55, 0.42, 0.7, 0x8f8a80);           // 上吻
  put(0, 2.95, 1.3, 0.5, 0.18, 0.62, 0x6f6a60);            // 下颚
  put(-0.3, 3.9, 0.3, 0.12, 0.75, 0.14, 0x5f6b70, -0.6);   // 左角
  put(0.3, 3.9, 0.3, 0.12, 0.75, 0.14, 0x5f6b70, -0.6);    // 右角
  put(-0.26, 3.6, 1.0, 0.16, 0.16, 0.1, 0x3a3a40);         // 左眼
  put(0.26, 3.6, 1.0, 0.16, 0.16, 0.1, 0x3a3a40);          // 右眼
  put(0, 3.62, -0.15, 0.7, 0.5, 0.5, 0x8f8a80);            // 颈基
  return mergedMesh(parts, o.key, o.ud);
}

// G2 玉华堂月洞门墙：白墙开圆洞（Shape+hole 挤出）+ 瓦帽
function buildMoonGate(o) {
  const [x, z] = o.geometry.position;
  const rotY = o.geometry.rotY;
  const { width: w, height: h, thickness: th, openingR: r } = o;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, h);
  shape.lineTo(-w / 2, h);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, r + 0.55, r, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, -th / 2);
  g.rotateY(rotY - Math.PI / 2);
  g.translate(x, 0, z);
  const parts = [colorize(g, 0xe4e0d6)];
  const cap = new THREE.BoxGeometry(w + 0.24, 0.14, th + 0.14);
  cap.rotateY(rotY - Math.PI / 2);
  cap.translate(x, h + 0.07, z);
  parts.push(colorize(cap, 0x5f6b70));
  return mergedMesh(parts, o.key, o.ud);
}

function buildPath(o) {
  const g = ribbon(o.geometry.polyline, o.width || 2.0, o.height || 0.05, 0xbfae8e, o.key).geometry;
  return mergedMesh([colorize(g, 0xbfae8e)], o.key, o.ud);
}

function buildGatePad(o) {
  const [x, z] = o.geometry.position;
  const parts = [];
  const pad = new THREE.BoxGeometry(12.2, 0.12, 7.2);
  pad.translate(x, 0.06, z);
  parts.push(colorize(pad, 0x9b917f));
  return mergedMesh(parts, o.key, o.ud);
}

// v2：店屋锚点不再渲染逐店垫座（旧 10.8×7.6 同高托盘相邻叠置造成 Z-fighting）。
// 店面基面由连续 paving 带（buildPaving）+ 店屋模型自身底面承担；
// footprint 拟合单元保留按父轮廓的实体台基（0→0.08，非叠放平面）。
function buildShopPlinth(o) {
  if (!o.parentFootprint) return null;
  const bb = bbox(o.parentFootprint);
  const plinth = new THREE.BoxGeometry(bb.w + 0.3, 0.08, bb.d + 0.3);
  plinth.translate(bb.cx, 0.04, bb.cz);
  return mergedMesh([colorize(plinth, 0xa39a88)], o.key, o.ud);
}

function buildPaving(o) {
  const g = ribbon(o.geometry.polyline, o.width || 2.4, o.height || 0.085, 0xa39a88, o.key).geometry;
  return mergedMesh([colorize(g, 0xa39a88)], o.key, o.ud);
}

// v3/G1：桥端/高差处的可见台阶（bottomY -> topY，沿局部 -Z 下行；rotY 使 +Z 指向桥身）
function buildSteps(o) {
  const [x, z] = o.geometry.position;
  const w = o.geometry.width || 2.2;
  const topY = o.geometry.topY ?? 0.5, botY = o.geometry.bottomY ?? 0.05;
  const n = Math.max(2, o.geometry.stepCount || 4);
  const rise = (topY - botY) / n, tread = 0.32;
  const ang = o.geometry.rotY || 0;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const st = new THREE.BoxGeometry(w, rise, tread);
    const lz = -(0.18 + i * tread);
    const wx = x + lz * Math.sin(ang);
    const wz = z + lz * Math.cos(ang);
    st.translate(wx, topY - rise * (i + 0.5), wz);
    parts.push(colorize(st, 0x9b917f));
  }
  return mergedMesh(parts, o.key, o.ud);
}

const hashStr = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const TRADE_COLORS = { '银楼': 0xb08d3e, '酒楼': 0x9c5a3c, '饭馆': 0xa85f3f, '棉花': 0xc9c2b4, '绸缎': 0xa86b7e, '绣品': 0xb07a8a, '皮货': 0x8a6a50, '参茸': 0x7c6a8a, '药材': 0x688069, '木器': 0x8f7248, '洋货': 0x70809a, '海味': 0x6f8a96, '腌腊': 0x96604a, '南北杂货': 0x8a8560, '照相店': 0x6a6a72, '字画店': 0x77705c, '寿衣店': 0x6f6a66, '烟纸店': 0x7a7568 };

function buildFacadeBay(o) {
  const [x, z] = o.geometry.position;
  const dir = o.geometry.dir;
  const w = o.geometry.width || 4.6;
  const h = o.height || 4.0;
  const cHex = TRADE_COLORS[o.trade] || 0x8d8478;
  const rotY = o.geometry.rotY;
  const g = new THREE.Group();
  g.position.set(x + dir[0] * 0.16, 0, z + dir[1] * 0.16);
  g.rotation.y = rotY;
  const parts = [];
  const panel = new THREE.BoxGeometry(w, h, 0.16);
  panel.translate(0, h / 2, 0);
  parts.push([panel, 0xcac2b0]);
  // 两缘壁柱（共享尺寸，开间边界可读）
  const pilW = 0.16;
  for (const sx of [-1, 1]) {
    const pil = new THREE.BoxGeometry(pilW, h, 0.1);
    pil.translate(sx * (w / 2 - pilW / 2), h / 2, 0.1);
    parts.push([pil, 0xb5ab97]);
  }
  // 门洞：偶数开间居中，奇数开间偏左（节奏变体）；深色内缩
  const doorW = Math.min(1.9, w * 0.4);
  const doorX = hashStr(o.id) % 2 === 0 ? 0 : -w * 0.22;
  const door = new THREE.BoxGeometry(doorW, 2.5, 0.1);
  door.translate(doorX, 1.25, 0.1);
  parts.push([door, 0x3f3a34]);
  // 橱窗（门另一侧，通长至壁柱）+ 楣窗
  const shopW = w - doorW - 0.5;
  if (shopW > 0.6) {
    const winX = doorX + Math.sign(-doorX || 1) * (doorW / 2 + shopW / 2 + 0.1);
    const win = new THREE.BoxGeometry(shopW, 1.35, 0.08);
    win.translate(winX, 1.05, 0.12);
    parts.push([win, 0x4a5560]);
    const frame = new THREE.BoxGeometry(shopW + 0.1, 0.09, 0.12);
    frame.translate(winX, 1.78, 0.12);
    parts.push([frame, 0x8a7a62]);
  }
  // 格栅腰线（楣窗带）：全开间通长 + 三根竖格栅条
  const grille = new THREE.BoxGeometry(w * 0.94, 0.42, 0.07);
  grille.translate(0, 2.62, 0.1);
  parts.push([grille, 0x6b4a33]);
  for (const sx of [-0.3, 0, 0.3]) {
    const slat = new THREE.BoxGeometry(0.05, 0.4, 0.1);
    slat.translate(sx * w * 0.4, 2.62, 0.12);
    parts.push([slat, 0x5a3d28]);
  }
  // 招牌 + 雨棚（招牌随行种配色，无文字）
  const sign = new THREE.BoxGeometry(w * 0.86, 0.5, 0.07);
  sign.translate(0, 3.35, 0.2);
  parts.push([sign, cHex]);
  const awn = new THREE.BoxGeometry(w * 0.9, 0.07, 0.75);
  awn.translate(0, 2.95, 0.42);
  parts.push([awn, 0x6b4a33]);
  const geos = parts.map(([geo, hex]) => colorize(geo, hex));
  const mesh = mergedMesh(geos, o.key, o.ud);
  mesh.position.copy(g.position);
  mesh.rotation.copy(g.rotation);
  return mesh;
}

// G3 摊位：四类设计用途（蒸煮/烤制/饮品/点心）共用柜台/立柱/托盘模块，
// 按用途区分柜台上的制作/展示结构与遮棚式样；food_socket 插槽(layout geometry.slots)与摆件同源。
function buildStall(o) {
  const [x, z] = o.geometry.position;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = o.geometry.rotY || 0;
  const parts = [];
  // 共享柜台模块（全部摊位同尺寸）
  const counter = new THREE.BoxGeometry(2.0, 0.9, 0.95);
  counter.translate(0, 0.45, 0);
  parts.push([counter, 0x8f7248]);
  const top = new THREE.BoxGeometry(2.2, 0.07, 1.1);
  top.translate(0, 0.94, 0);
  parts.push([top, 0x9c8055]);
  // 共享后立柱 ×2 + 遮棚（式样/颜色按用途）
  for (const sx of [-0.85, 0.85]) {
    const pole = new THREE.CylinderGeometry(0.045, 0.045, 2.35, 5);
    pole.translate(sx, 1.18, -0.42);
    parts.push([pole, 0x5d4630]);
  }
  const use = o.foodUse || '蒸煮';
  const awnY = 2.4;
  if (use === '烤制') {
    const awn = new THREE.BoxGeometry(2.3, 0.06, 1.5);
    awn.rotateX(0.16);
    awn.translate(0, awnY, 0.05);
    parts.push([awn, 0x8a4a34]);
  } else if (use === '饮品') {
    const awn = new THREE.BoxGeometry(2.3, 0.05, 1.35);
    awn.translate(0, awnY + 0.05, -0.02);
    parts.push([awn, 0x4f7a78]);
    const stripe = new THREE.BoxGeometry(2.3, 0.05, 0.3);
    stripe.translate(0, awnY + 0.06, 0.45);
    parts.push([stripe, 0xd8d4c8]);
  } else if (use === '点心') {
    const um = new THREE.ConeGeometry(1.45, 0.55, 7);
    um.translate(0, awnY + 0.2, -0.15);
    parts.push([um, 0xc2953c]);
  } else { // 蒸煮：白布平棚
    const awn = new THREE.BoxGeometry(2.35, 0.06, 1.4);
    awn.translate(0, awnY, -0.02);
    parts.push([awn, 0xd8d4c8]);
  }
  // 插槽摆件：与 layout slots 同一本地坐标（+Z 朝人流）
  const slots = (o.geometry && o.geometry.slots) || [];
  for (const s of slots) {
    if (s.slot === 'tray') {
      const tray = new THREE.BoxGeometry(0.5, 0.06, 0.38);
      tray.translate(s.lx, s.ly - 0.03, s.lz);
      parts.push([tray, 0xd0c8b6]);
    } else if (s.slot === 'steamer') {
      for (let k = 0; k < 3; k++) { // 开口蒸笼叠：顶层敞口即 food_socket 面(1.305)
        const b = new THREE.CylinderGeometry(0.21, 0.21, 0.11, 8);
        b.translate(s.lx, 0.975 + 0.055 + k * 0.11, s.lz);
        parts.push([b, 0xc9b896]);
      }
    } else if (s.slot === 'grill') {
      const box = new THREE.BoxGeometry(0.5, 0.15, 0.36);
      box.translate(s.lx, 1.05, s.lz);
      parts.push([box, 0x3a3632]);
      const hood = new THREE.BoxGeometry(0.54, 0.04, 0.4);
      hood.translate(s.lx, 1.21, s.lz);
      parts.push([hood, 0x54504c]);
      const chim = new THREE.BoxGeometry(0.09, 0.5, 0.09);
      chim.translate(s.lx, 1.48, s.lz - 0.1);
      parts.push([chim, 0x54504c]);
    } else if (s.slot === 'cup') {
      const back = new THREE.BoxGeometry(1.1, 0.55, 0.04);
      back.translate(s.lx, 1.28, s.lz - 0.13);
      parts.push([back, 0x6b5a44]);
      const shelf = new THREE.BoxGeometry(1.1, 0.05, 0.28);
      shelf.translate(s.lx, 1.28, s.lz);
      parts.push([shelf, 0x7c6a52]);
      for (let k = 0; k < 3; k++) { // 杯列靠左半，插槽面留在右端(lx=-0.1)
        const cup = new THREE.CylinderGeometry(0.045, 0.038, 0.1, 6);
        cup.translate(s.lx - 0.62 + k * 0.22, 1.36, s.lz + 0.02);
        parts.push([cup, 0xe2ddd0]);
      }
    } else if (s.slot === 'case') { // 开放正面展示柜：底板/背板/侧板/顶板/搁板，食物在搁板(1.16)上可见
      const base = new THREE.BoxGeometry(0.92, 0.06, 0.6);
      base.translate(s.lx, 1.0, s.lz);
      parts.push([base, 0x9c8055]);
      const back = new THREE.BoxGeometry(0.92, 0.44, 0.05);
      back.translate(s.lx, 1.22, s.lz - 0.275);
      parts.push([back, 0xbfc8c4]);
      for (const sx of [-0.435, 0.435]) {
        const side = new THREE.BoxGeometry(0.05, 0.44, 0.6);
        side.translate(s.lx + sx, 1.22, s.lz);
        parts.push([side, 0xbfc8c4]);
      }
      const cap = new THREE.BoxGeometry(0.96, 0.04, 0.64);
      cap.translate(s.lx, 1.45, s.lz);
      parts.push([cap, 0xe2ddd0]);
      const shelf = new THREE.BoxGeometry(0.88, 0.03, 0.56);
      shelf.translate(s.lx, 1.145, s.lz);
      parts.push([shelf, 0xe2ddd0]);
    }
  }
  const mesh = mergedMesh(parts.map(([geo, hex]) => colorize(geo, hex)), o.key, o.ud);
  mesh.position.copy(g.position);
  mesh.rotation.copy(g.rotation);
  return mesh;
}

function buildBench(o) {
  const [x, z] = o.geometry.position;
  const b = new THREE.BoxGeometry(1.8, 0.45, 0.45);
  b.translate(x, 0.225, z);
  return mergedMesh([colorize(b, 0x8f7248)], o.key, o.ud);
}

// ---------- 主流程 ----------
const zoneGroups = { garden: new THREE.Group(), temple: new THREE.Group(), bazaar: new THREE.Group(), pond: new THREE.Group(), outer: new THREE.Group() };
for (const [z, g] of Object.entries(zoneGroups)) { g.name = 'ZN-' + z; }

const stats = { meshes: 0, byZone: {}, byKind: {} };
const deferred = [];

// HUXINTING：与湖心亭 footprint 重合的其他已渲染对象（对称差面积 ≤ 5% 湖心亭面积）一并让位。
// 例：bld-228035340（outerBuilding）与 huxin-ting 同为 OSM way 228035340，照常渲染会把湖心亭一层包成 5 m 米色体块。
// 规则从 layout 几何算，不写死 id；reconcile 对这些 id 期望「缺席」并检查确实缺席。
const HUXINTING_DUP = new Map();
if (HUXINTING) {
  const ht = layout.objects.find(o => o.id === 'huxin-ting');
  const H = ht && ht.geometry && ht.geometry.footprint;
  if (H && H.length >= 3) {
    const hArea = Math.abs(polyArea(orientRing(H)));
    const hb = bbox(H);
    for (const o of layout.objects) {
      const fp = o.geometry && o.geometry.footprint;
      if (o.id === 'huxin-ting' || o.skipRender || !fp || fp.length < 3) continue;
      const b = bbox(fp);
      if (b.x1 < hb.x0 || b.x0 > hb.x1 || b.z1 < hb.z0 || b.z0 > hb.z1) continue;
      const ratio = polySymDiffArea(H, fp) / hArea;
      if (ratio <= 0.05) HUXINTING_DUP.set(o.id, ratio);
    }
  }
  console.log('HUXINTING duplicate footprints of huxin-ting:', JSON.stringify([...HUXINTING_DUP].map(([id, r]) => [id, +r.toFixed(4)])));
}

for (const o of layout.objects) {
  if (o.skipRender) { deferred.push({ id: o.id, kind: o.kind, why: o.disposition }); continue; }
  if (SITE_MODULES && SITE_MODULE_KINDS.has(o.kind)) { deferred.push({ id: o.id, kind: o.kind, why: 'site-module' }); continue; }
  if (STALL_KIT && STALL_KIT_KINDS.has(o.kind)) { deferred.push({ id: o.id, kind: o.kind, why: 'stall-kit' }); continue; }
  if (GARDEN_KITS && (GARDEN_KIT_IDS.has(o.id) || (o.kind === 'tree' && o.zone === 'garden'))) { deferred.push({ id: o.id, kind: o.kind, why: 'garden-kit' }); continue; }
  if (SANSUITANG && SANSUITANG_IDS.has(o.id)) { deferred.push({ id: o.id, kind: o.kind, why: 'sansuitang-module' }); continue; }
  if (HALL_KIT && HALL_KIT_IDS.has(o.id)) { deferred.push({ id: o.id, kind: o.kind, why: 'hall-kit' }); continue; }
  if (ROCKERY_KIT && ROCKERY_IDS.has(o.id)) { deferred.push({ id: o.id, kind: o.kind, why: 'rockery-kit' }); continue; }
  if (HUXINTING && HUXINTING_IDS.has(o.id)) { deferred.push({ id: o.id, kind: o.kind, why: 'huxinting-module' }); continue; }
  if (HUXINTING && HUXINTING_DUP.has(o.id)) {
    deferred.push({ id: o.id, kind: o.kind, why: 'duplicate-footprint-of-huxin-ting', duplicateOf: 'huxin-ting', symDiffRatio: +HUXINTING_DUP.get(o.id).toFixed(4) });
    continue;
  }
  if (BAZAAR_TOWERS && BAZAAR_TOWER_IDS.has(o.id)) { deferred.push({ id: o.id, kind: o.kind, why: 'bazaar-tower-module' }); continue; }
  const ud = { id: o.id, zone: o.zone, kind: o.kind, lod: o.lod };
  if (o.name) ud.name = o.name;
  if (o.trade) ud.trade = o.trade;
  if (o.inferences && o.inferences.length) ud.inference = o.inferences.join(' | ');
  if (o.disposition) ud.disposition = o.disposition;
  const key = `${o.zone}|${o.id}|${o.kind}|${o.lod}`;
  const ctx = { key, ud };
  let mesh = null;
  switch (o.kind) {
    case 'ground': {
      const [x0, z0, x1, z1] = o.geometry.bounds;
      const gnd = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 1 }));
      gnd.rotation.x = -Math.PI / 2;
      gnd.position.set((x0 + x1) / 2, -0.4, (z0 + z1) / 2);
      gnd.name = key; gnd.userData = ud;
      zoneGroups.outer.add(gnd);
      stats.meshes++;
      continue;
    }
    case 'road': {
      const cols = { 2: 0x8f8a83, 1: 0x9c968d, 0: 0xb0a99d };
      let fp = o.geometry.surfaceFootprint, poly = o.geometry.polyline;
      if (FANGBANG_ROAD_CLIP && FANGBANG_ROAD_CLIP[o.id]) {
        const [xmin, xmax] = FANGBANG_ROAD_CLIP[o.id];
        if (fp) fp = clipPolyX(fp, xmin, xmax);
        if (poly) poly = clipPolylineX(poly, xmin, xmax);
        if ((!fp || !fp.length) && (!poly || poly.length < 2)) continue;   // 整段让位
      }
      const g = fp ? shapeGeo(fp, o.height)
        : (poly && poly.length > 1 ? ribbon(poly, o.geometry.width, o.height, cols[o.geometry.priority] ?? 0xb0a99d, key).geometry : null);
      if (!g) continue;
      mesh = mergedMesh([colorize(g, cols[o.geometry.priority] ?? 0xb0a99d)], key, ud);
      break;
    }
    case 'plaza': mesh = shapeMesh(o.geometry.footprint, 0.04, 0xb3aa9a, key); mesh.userData = ud; break;
    case 'water': {
      const col = o.zone === 'garden' ? 0x4e7d84 : o.zone === 'pond' ? 0x557f8f : 0x5b7f92;
      mesh = shapeMesh(o.geometry.footprint, o.height, col, key); mesh.userData = ud;
      break;
    }
    case 'outerBuilding': mesh = buildOuterBuilding({ ...o, key, ud }); break;
    case 'bazaarBlock': mesh = buildBazaarBlock({ ...o, key, ud }); break;
    case 'hall': case 'tower': case 'pavilion': case 'xuan': case 'waterside': case 'stage': {
      const [body, roof] = buildGardenBuilding({ ...o, key, ud });
      for (const m of [body, roof]) {
        if (!m) continue;
        zoneGroups[o.zone].add(m);
        stats.meshes++;
      }
      stats.byZone[o.zone] = (stats.byZone[o.zone] || 0) + 1;
      stats.byKind[o.kind] = (stats.byKind[o.kind] || 0) + 1;
      continue;
    }
    case 'corridor': {
      const grp = corridor(o.geometry.polyline, o.geometry.width || 2.2, key);
      mesh = mergedMesh(flattenParts(grp), key, ud);
      break;
    }
    case 'watersideGallery': mesh = buildWatersideGallery({ ...o, key, ud }); break;
    case 'wallHead': mesh = buildWallHead({ ...o, key, ud }); break;
    case 'moonGateWall': mesh = buildMoonGate({ ...o, key, ud }); break;
    case 'bridge': mesh = buildBridge({ ...o, key, ud }); break;
    case 'zigzagBridge': mesh = buildZigzagBridge({ ...o, key, ud }); break;
    case 'rockery': mesh = buildRockery({ ...o, key, ud }); break;
    case 'tree': mesh = buildTree({ ...o, key, ud }); if (mesh) mesh.userData = ud; break;
    case 'wall': mesh = buildWall({ ...o, key, ud }); break;
    case 'path': mesh = buildPath({ ...o, key, ud }); break;
    case 'gateAnchor': mesh = buildGatePad({ ...o, key, ud }); break;
    case 'shopAnchor': {
      const plinth = buildShopPlinth({ ...o, key, ud });
      if (!plinth) {
        deferred.push({ id: o.id, kind: o.kind, why: 'no individual pad by design (v2): base = continuous street paving + shop model' });
        continue;
      }
      mesh = plinth;
      break;
    }
    case 'paving': mesh = buildPaving({ ...o, key, ud }); break;
    case 'steps': mesh = buildSteps({ ...o, key, ud }); break;
    case 'facadeBay': mesh = buildFacadeBay({ ...o, key, ud }); break;
    case 'stall': mesh = buildStall({ ...o, key, ud }); break;
    case 'bench': mesh = buildBench({ ...o, key, ud }); break;
    case 'templeAnchor': case 'osmTempleOutline': continue; // temple 模块由 Blender 嵌入；OSM 轮廓只在 layout 记录
    default: deferred.push({ id: o.id, kind: o.kind }); continue;
  }
  if (!mesh) { deferred.push({ id: o.id, kind: o.kind, why: 'null mesh' }); continue; }
  const slot = pavingSlot(o);
  if (slot) { ud.slot = slot; worldUV(mesh.geometry); }   // mesh.userData 即 ud；贴图由 export-zones.py 按 slot 绑定
  const passages=layout.reviewRepair?.passages||[];
  if(['outerBuilding','bazaarBlock','facadeBay'].includes(o.kind)&&passages.length){
    mesh.updateMatrix();
    mesh.geometry=mesh.geometry.clone().applyMatrix4(mesh.matrix);
    mesh.position.set(0,0,0);mesh.rotation.set(0,0,0);mesh.scale.set(1,1,1);mesh.updateMatrix();
    mesh.geometry=cutPassages(mesh.geometry,passages);
    if(o.geometry.groundFootprints){
      const parts=[mesh.geometry];
      // Existing vertex colours must be preserved on the clipped exterior.
      parts[0]=mesh.geometry;
      for(const fp of o.geometry.groundFootprints){
        parts.push(...flattenParts(wallRing(fp,.06,o.geometry.passageHeight,0xcac2b0,'passage-jamb')));
      }
      const ceiling=shapeGeo(o.geometry.footprint,o.geometry.passageHeight);
      const idx=ceiling.index;
      if(idx){for(let i=0;i<idx.count;i+=3){const b=idx.getX(i+1);idx.setX(i+1,idx.getX(i+2));idx.setX(i+2,b);}}
      else {const a=ceiling.attributes.position;for(let i=0;i<a.count;i+=3){const b=[a.getX(i+1),a.getY(i+1),a.getZ(i+1)];a.setXYZ(i+1,a.getX(i+2),a.getY(i+2),a.getZ(i+2));a.setXYZ(i+2,...b);}}
      ceiling.computeVertexNormals();parts.push(colorize(ceiling,0xb7ab98));
      mesh=mergedMesh(parts,key,ud);
    }
  }
  zoneGroups[o.zone] ? zoneGroups[o.zone].add(mesh) : zoneGroups.outer.add(mesh);
  stats.meshes++;
  stats.byZone[o.zone] = (stats.byZone[o.zone] || 0) + 1;
  stats.byKind[o.kind] = (stats.byKind[o.kind] || 0) + 1;
}

// ---------- 导出 ----------
const exporter = new GLTFExporter();
const procedural = {};
const zoneFiles = { garden: 'procedural-garden.glb', temple: 'procedural-temple.glb', bazaar: 'procedural-bazaar.glb', pond: 'procedural-pond.glb', outer: 'procedural-outer.glb' };
for (const [z, g] of Object.entries(zoneGroups)) {
  if (!g.children.length) {
    // SITE_MODULES=1 时庙墙等占位被站点模块替代，分区可能为空——仍写出空 GLB 供 validate.mjs 清单核对
    if (SITE_MODULES) {
      const bytes = await new Promise((res, rej) => { exporter.parse(g, (ab) => res(Buffer.from(ab)), (e) => rej(e), { binary: true }); });
      const f = path.join(OUT, zoneFiles[z]);
      fs.writeFileSync(f, bytes);
      procedural[z] = { file: 'out/' + zoneFiles[z], bytes: bytes.length, children: 0, empty: true };
      console.log(z, bytes.length, 'bytes, empty (site modules carry this zone)');
    }
    continue;
  }
  const bytes = await new Promise((res, rej) => {
    exporter.parse(g, (ab) => res(Buffer.from(ab)), (e) => rej(e), { binary: true });
  });
  const f = path.join(OUT, zoneFiles[z]);
  fs.writeFileSync(f, bytes);
  procedural[z] = { file: 'out/' + zoneFiles[z], bytes: bytes.length, children: g.children.length };
  console.log(z, bytes.length, 'bytes,', g.children.length, 'meshes');
}
fs.writeFileSync(path.join(OUT, 'procedural-stats.json'), JSON.stringify({
  stats, deferred, procedural,
  sceneRoots: Object.keys(zoneGroups),
}, null, 2));
console.log('total meshes', stats.meshes, 'deferred', deferred.length);
console.log('byKind', JSON.stringify(stats.byKind));
