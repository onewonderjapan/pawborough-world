// 三穗堂实例模块测试（T2, SANSUITANG=1）。位置/朝向只认 baseline/layout.json 重算值，与总装产物实测对比；
// 不读模块自报 placements（模块也没有 placements——放置公式只有 layout 一份来源）。
// 用法：OUT_DIR=out-zone node tests/sansuitang-test.mjs（无产物时跳过）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBytes } from 'gltf-validator';
import { minAreaRect, anchorBehindSharedEdge, rearWallFace } from '../src/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out-zone');
const LAYOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'layout.json'), 'utf8'));
const SST_ID = 'bld-428179901';
// SANSUITANG_GLB：只换被测模块 GLB（在旧产物上先跑出失败用）
const SST_GLB = process.env.SANSUITANG_GLB ? path.resolve(process.env.SANSUITANG_GLB) : path.join(ROOT, 'out-garden-kits', 'sansuitang-bld-428179901', 'model.glb');

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
}
function skip(name, why) { skipped++; console.log('SKIP', name, '-', why); }

// ---------- 0) layout 朝向（wave2-sansuitang S1；只读 baseline/layout.json，不需要产物） ----------
// 三穗堂坐北朝南（主控 2026-09-25 覆盖；常识判断，未核实）：facade.dir 应为「南侧长边」外法线。
// 南侧长边的识别不复用 layout.mjs 覆盖表：footprint 相邻边按方向（≤12°）合并成直边链，
// 最长的两条链为两条长边，其中外法线 z 分量较大者（地图 Z 向南）为南侧长边；外法线 = 链弦外法线。
{
  const sObj = LAYOUT.objects.find((o) => o.id === SST_ID);
  const ySObj = LAYOUT.objects.find((o) => o.id === 'bld-428179902'); // 仰山堂（北侧共边）
  const ring = (f) => (f[0][0] === f[f.length - 1][0] && f[0][1] === f[f.length - 1][1] ? f.slice(0, -1) : f);
  const p = ring(sObj.geometry.footprint);
  const n = p.length;
  const mx = p.reduce((s, q) => s + q[0], 0) / n, mz = p.reduce((s, q) => s + q[1], 0) / n;
  const edgeDir = (i) => { const a = p[i % n], b = p[(i + 1) % n]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const angDeg = (u, v) => Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))))) * 180 / Math.PI;
  let start = 0; // 从一个转角顶点起合并，链不跨起点
  for (let i = 0; i < n; i++) if (angDeg(edgeDir(i + n - 1), edgeDir(i)) > 12) { start = i; break; }
  const chains = [];
  for (let k = 0; k < n; k++) {
    const i = start + k;
    const last = chains[chains.length - 1];
    if (last && angDeg(edgeDir(i - 1), edgeDir(i)) <= 12) last.end = (i + 1) % n;
    else chains.push({ begin: i % n, end: (i + 1) % n });
  }
  for (const c of chains) {
    const a = p[c.begin], b = p[c.end];
    c.len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let nn = [-(b[1] - a[1]) / c.len, (b[0] - a[0]) / c.len];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (nn[0] * (mx - m[0]) + nn[1] * (mz - m[1]) > 0) nn = [-nn[0], -nn[1]];
    c.normal = nn;
  }
  const longSides = [...chains].sort((a, b) => b.len - a.len).slice(0, 2);
  const south = longSides.sort((a, b) => b.normal[1] - a.normal[1])[0];
  const fd = sObj.facade.dir;
  const aS = angDeg(fd, south.normal);
  console.log(`layout 直边链 ${chains.length} 条；南侧长边 (${p[south.begin]}) → (${p[south.end]})，${south.len.toFixed(2)} m，外法线 (${south.normal.map(x => x.toFixed(4))})`);
  ok(`三穗堂 facade.dir 与南侧长边外法线夹角 ${aS.toFixed(2)}° ≤ 5（坐北朝南，常识未核实）`, aS <= 5, `facade.dir=(${fd.map(x => x.toFixed(4))})`);
  const aY = angDeg(fd, ySObj.facade.dir);
  ok(`三穗堂 facade.dir 与仰山堂 facade.dir 夹角 ${aY.toFixed(1)}° ≥ 150`, aY >= 150, `仰山堂=(${ySObj.facade.dir.map(x => x.toFixed(4))})`);
}

// minAreaRect 与 hall-kit 生成器同法：对仰山堂 footprint 重算，应复现 build_hall.py 写出的矩形边长（±0.01 m）
{
  const hm = path.join(ROOT, 'out-garden-kits', 'hallkit-bld-428179902', 'measurements.json');
  if (fs.existsSync(hm)) {
    const m = JSON.parse(fs.readFileSync(hm, 'utf8')).rect;
    const r = minAreaRect(LAYOUT.objects.find((o) => o.id === 'bld-428179902').geometry.footprint);
    const [a, b] = [Math.max(r.lenU, r.lenV), Math.min(r.lenU, r.lenV)];
    ok(`minAreaRect 复现 hall-kit 矩形（${a.toFixed(3)}×${b.toFixed(3)} vs ${m.u}×${m.v}）`, Math.abs(a - m.u) <= 0.01 && Math.abs(b - m.v) <= 0.01);
  } else skip('minAreaRect vs hall-kit 矩形', '无 hallkit measurements.json');
}

if (process.env.SANSUITANG !== '1' || !fs.existsSync(path.join(OUT, 'garden.glb')) || !fs.existsSync(SST_GLB)) {
  console.log(`sansuitang artefacts not found or SANSUITANG!=1 (OUT_DIR=${OUT}) — skipping artefact checks (layout checks: ${pass} pass, ${fail} fail)`);
  if (fail > 0) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
  process.exit(0);
}

// ---------- GLB 解析（节点世界矩阵 + 子树顶点收集） ----------
function parseGlb(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen));
  let bin = null;
  if (28 + jsonLen < buf.length) {
    const binLen = buf.readUInt32LE(20 + jsonLen);
    bin = buf.subarray(28 + jsonLen, 28 + jsonLen + binLen);
  }
  const comp = { 5120: [1, Int8Array], 5121: [1, Uint8Array], 5122: [2, Int16Array], 5123: [2, Uint16Array], 5125: [4, Uint32Array], 5126: [4, Float32Array] };
  const ncomp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  function accessor(ai) {
    const a = json.accessors[ai];
    const bv = json.bufferViews[a.bufferView];
    const [bsize, Arr] = comp[a.componentType];
    const nc = ncomp[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || bsize * nc;
    const out = [];
    for (let i = 0; i < a.count; i++) {
      const o = off + i * stride;
      out.push(Array.from(new Arr(bin.buffer, bin.byteOffset + o, nc)));
    }
    return out;
  }
  function nodeMatrix(n) {
    if (n.matrix) return n.matrix;
    const t = n.translation || [0, 0, 0];
    const q = n.rotation || [0, 0, 0, 1];
    const s = n.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    // 标准 glTF 列向量旋转矩阵（m02=2(xz+yw)，勿转置——转置会把纯 Y 旋转变成反向）
    const rot = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
    return [rot[0] * s[0], rot[3] * s[0], rot[6] * s[0], 0,
            rot[1] * s[1], rot[4] * s[1], rot[7] * s[1], 0,
            rot[2] * s[2], rot[5] * s[2], rot[8] * s[2], 0,
            t[0], t[1], t[2], 1];
  }
  function mul4(a, b) {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  }
  function mulVec(m, v) {
    return [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  }
  const nodesByName = new Map((json.nodes || []).map((n, i) => [n.name || `node${i}`, { n, i }]));
  const parentOf = new Map();
  for (const [i, n] of (json.nodes || []).entries()) for (const c of n.children || []) parentOf.set(c, i);
  const triTotal = (json.meshes || []).reduce((s, m) => s + m.primitives.reduce((t, p) => t + Math.floor(json.accessors[p.indices].count / 3), 0), 0);
  function worldMatrixOf(ni) {
    let m = null, cur = ni;
    while (cur !== undefined) { m = m ? mul4(nodeMatrix(json.nodes[cur]), m) : nodeMatrix(json.nodes[cur]); cur = parentOf.get(cur); }
    return m || nodeMatrix(json.nodes[ni]);
  }
  function subtreeVerts(rootName, maxY = 1e9) {
    const entry = nodesByName.get(rootName);
    if (!entry) return null;
    const verts = [];
    const w = (ni, pm) => {
      const n = json.nodes[ni];
      // 根节点取完整世界矩阵（含祖先链），子节点本地合成，不重复乘根矩阵
      const m = pm ? mul4(pm, nodeMatrix(n)) : worldMatrixOf(ni);
      if (n.mesh !== undefined) {
        for (const p of json.meshes[n.mesh].primitives) {
          for (const v of accessor(p.attributes.POSITION)) {
            const wv = mulVec(m, v);
            if (wv[1] <= maxY) verts.push(wv);
          }
        }
      }
      for (const c of n.children || []) w(c, m);
    };
    w(entry.i, null);
    return verts;
  }
  return { json, nodesByName, subtreeVerts, triTotal, materials: json.materials || [] };
}

// ---------- layout 重算（唯一权威来源） ----------
const obj = LAYOUT.objects.find((o) => o.id === SST_ID);
if (!obj) { console.log('FAIL layout has no', SST_ID); process.exit(1); }
const fpRaw = obj.geometry.footprint;
const fp = fpRaw[0][0] === fpRaw[fpRaw.length - 1][0] && fpRaw[0][1] === fpRaw[fpRaw.length - 1][1] ? fpRaw.slice(0, -1) : fpRaw;
// 锚点（wave2-sansuitang 主控 2026-09-25；此前为顶点均值形心）= footprint 最小面积外接矩形中心
// + 沿 facade.dir 使模块后墙外皮不越过与仰山堂共用边线的最小平移（后墙外皮取自 modules/sansuitang/collision.json rear-wall）
const SST_COLL = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'sansuitang', 'collision.json'), 'utf8'));
const { backZ, backHalfX } = rearWallFace(SST_COLL);
const anc = anchorBehindSharedEdge(fp, LAYOUT.objects.find((o) => o.id === 'bld-428179902').geometry.footprint, obj.facade.dir, backZ, backHalfX);
const [cx, cz] = anc.anchor;
const [dx, dz] = obj.facade.dir;
const wantRotY = Math.atan2(dx, dz);
console.log(`layout 重算：矩形中心 (${anc.rectCentre.map((t) => t.toFixed(3))}) + ${anc.shift.toFixed(3)} m → 锚点 (${cx.toFixed(3)}, ${cz.toFixed(3)})  rotY=${wantRotY.toFixed(4)}  facade.dir=(${dx.toFixed(4)},${dz.toFixed(4)})`);

// ---------- 1) 总装 garden.glb 锚点实测 ----------
const garden = parseGlb(path.join(OUT, 'garden.glb'));
const anchorEntry = garden.nodesByName.get(SST_ID);
ok('garden.glb 有 bld-428179901 锚节点', !!anchorEntry);
let testOk = !!anchorEntry;
if (testOk) {
  const n = anchorEntry.n;
  const t = n.translation || [0, 0, 0];
  const q = n.rotation || [0, 0, 0, 1];
  const dist = Math.hypot(t[0] - cx, t[2] - cz);
  ok(`锚点位置 = 矩形中心+共用边平移（偏差 ${dist.toFixed(3)} m ≤ 0.5）`, dist <= 0.5, `got (${t[0].toFixed(2)}, ${t[2].toFixed(2)})`);
  // glTF 四元数绕 +Y：θ = 2*atan2(qy, qw)；R(θ)·(0,0,1) = (sinθ, 0, cosθ)
  const yaw = 2 * Math.atan2(q[1], q[3]);
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const ang = Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / Math.hypot(dx, dz)))) * 180 / Math.PI;
  ok(`锚点朝向 vs facade.dir（夹角 ${ang.toFixed(2)}° ≤ 5）`, ang <= 5, `yaw=${yaw.toFixed(4)}`);

  // 2) 子树几何实测：逆旋转回模块本地系（相对 layout 重算锚点）量范围 —— 横向居中、后缘 = 后墙外皮、尺寸量级
  //    （wave2 背面收齐后模块前后不对称：前缘到踏步 ~+8.93，后缘 = 后墙外皮 rear-wall 盒 z 最小面 ~−7.23）
  const verts = garden.subtreeVerts(SST_ID);
  ok('bld-428179901 子树有几何', !!verts && verts.length > 1000, `verts=${verts ? verts.length : 0}`);
  if (verts && verts.length) {
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    const ct = Math.cos(-wantRotY), st = Math.sin(-wantRotY);
    for (const v of verts) {
      const rx = v[0] - cx, rz = v[2] - cz;
      const ux = rx * ct + rz * st, vz = -rx * st + rz * ct;
      u0 = Math.min(u0, ux); u1 = Math.max(u1, ux); v0 = Math.min(v0, vz); v1 = Math.max(v1, vz);
    }
    if (process.env.SST_DEBUG) console.log('DEBUG local u', u0.toFixed(3), u1.toFixed(3), 'v', v0.toFixed(3), v1.toFixed(3));
    ok(`实际几何横向居中于锚点（偏差 ${((u0 + u1) / 2).toFixed(3)} m ≤ 0.1）`, Math.abs((u0 + u1) / 2) <= 0.1);
    ok(`实际几何后缘 = 后墙外皮（${v0.toFixed(3)} vs ${backZ.toFixed(3)}，≤ 0.05）`, Math.abs(v0 - backZ) <= 0.05);
    const w = u1 - u0, dep = v1 - v0;
    ok(`实际几何本地系尺寸（${w.toFixed(1)} × ${dep.toFixed(1)} m，预期 ~19.7 ±1.2 × ~16.2 ±0.6）`, w > 18.5 && w < 20.9 && dep > 15.6 && dep < 16.8);
  }
}

// ---------- 3) 模块 GLB：validator 0 错 + 预算 + staging sha ----------
{
  const res = await validateBytes(new Uint8Array(fs.readFileSync(SST_GLB)));
  ok('模块 GLB validator 0 错误', res.issues.numErrors === 0, JSON.stringify(res.issues.messages?.filter(m => m.severity === 0).slice(0, 3) || []));
  const tris = res.info?.totalTriangleCount ?? 0;
  ok(`模块三角 ${tris} ≤ 32000`, tris > 0 && tris <= 32000);
  const bytes = fs.statSync(SST_GLB).size;
  ok(`模块字节 ${bytes} ≤ 3000000`, bytes <= 3000000);
  const crypto = await import('node:crypto');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(SST_GLB)).digest('hex');
  const staging = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'garden-kits-staging.json'), 'utf8'));
  ok('staging sha 与 out-garden-kits 文件一致', staging.files['sansuitang-bld-428179901/model.glb'] === sha);
  const latticeMat = (res.info?.materialsInfo && Object.values(res.info.materialsInfo).find(() => false)) || null;
  const g = parseGlb(SST_GLB);
  const lat = g.materials.find((m) => /lattice/.test(m.name));
  ok('格心材质 alphaMode=MASK', !!lat && lat.alphaMode === 'MASK', lat && lat.alphaMode);
  const alphaImg = (g.json.images || []).some((i) => /lattice/.test(i.name || ''));
  ok('解析 alpha 贴图已内嵌', alphaImg);
}

// ---------- 3b) wave4-huxinting2 格扇配色（主控：格扇偏暗，与厅堂套件统一配色，框料 #6a2e22；三穗堂几何不变，只改材质） ----------
// 模块 GLB 实测：
//   框料材质 sst-timber-darkred 底色 = sRGB #6a2e22、不再乘 wood-stain 贴图（hall-kit hk-timber-darkred 同做法；
//   旧版贴图 × 色 = 有效底色约 sRGB(26,5,3)，格扇整面读成黑）；
//   格心贴图 lattice-core-alpha 字节 = modules/hall-kit/textures/lattice-core-alpha.png（总装按「名 + 尺寸」去重，
//   不同字节的同名图会互相覆盖——旧版三穗堂 #241d18 图先导入，运行时把全部厅堂和湖心亭的格心压成 #241d18）。
// 总装产物实测：OUT_DIR 里含 lattice-core-alpha 的 GLB（garden / pond / zone-*）该图字节同 hall-kit 源图。
// 立面明度（V ≥ 0.22）是渲染口径，见 modules/sansuitang/render_facade.py（exit 3 = 不合格），不在本测试里渲染。
{
  const imgBytes = (file, re) => {
    const b = fs.readFileSync(file), jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl));
    const bin = b.subarray(28 + jl, 28 + jl + b.readUInt32LE(20 + jl));
    return (j.images || []).filter((im) => re.test(im.name || '')).map((im) => {
      const bv = j.bufferViews[im.bufferView];
      return { name: im.name, bytes: bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength) };
    });
  };
  const crypto = await import('node:crypto');
  const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const HK_LAT = fs.readFileSync(path.join(ROOT, 'modules', 'hall-kit', 'textures', 'lattice-core-alpha.png'));
  const g = parseGlb(SST_GLB);
  const lin = (h) => [0, 2, 4].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const want = lin('6a2e22');
  const tm = g.materials.find((m) => m.name === 'sst-timber-darkred');
  const bc = tm?.pbrMetallicRoughness?.baseColorFactor || [];
  ok(`框料 sst-timber-darkred 底色 = sRGB #6a2e22 且无底色贴图（实测 ${bc.slice(0, 3).map((v) => v.toFixed(3)).join(',')}，贴图 ${tm?.pbrMetallicRoughness?.baseColorTexture ? '有' : '无'}）`,
    !!tm && want.every((v, i) => Math.abs(bc[i] - v) <= 0.002) && !tm.pbrMetallicRoughness.baseColorTexture);
  const lat = imgBytes(SST_GLB, /^lattice-core-alpha/);
  ok(`格心贴图 lattice-core-alpha 字节 = hall-kit 源图（${lat.map((x) => sha(x.bytes).slice(0, 12)).join(',') || '无'} vs ${sha(HK_LAT).slice(0, 12)}）`,
    lat.length === 1 && sha(lat[0].bytes) === sha(HK_LAT));
  const runtime = fs.readdirSync(OUT).filter((f) => /^(garden|pond|zone-[a-z0-9-]+)\.glb$/.test(f));
  const bad = [], seen = [];
  for (const f of runtime) for (const im of imgBytes(path.join(OUT, f), /^lattice-core-alpha/)) { seen.push(f); if (sha(im.bytes) !== sha(HK_LAT)) bad.push(f); }
  if (seen.length) ok(`总装 / 分区 GLB 的 lattice-core-alpha 全部 = hall-kit 源图（含该图 ${seen.length} 个，不符 ${bad.length}：${bad.join(',')}）`, bad.length === 0);
  else skip('总装 lattice-core-alpha', `${OUT} 无含该图的 GLB`);
}

// ---------- 4) 程序化 hall 确实让位 + 碰撞世界记录 ----------
{
  const ps = JSON.parse(fs.readFileSync(path.join(OUT, 'procedural-stats.json'), 'utf8'));
  const def = (ps.deferred || []).find((x) => x.id === SST_ID);
  ok(`程序化 hall 已让位（why=${def ? def.why : '未推迟'}）`, !!def && def.why === 'sansuitang-module');
  const cw = path.join(OUT, 'sansuitang-collision-world.json');
  if (fs.existsSync(cw)) {
    const c = JSON.parse(fs.readFileSync(cw, 'utf8'));
    ok(`碰撞世界记录 ≥ 70 盒（${c.colliders.length}）`, c.colliders.length >= 70);
    const st = c.instance;
    const dist = Math.hypot(st.position[0] - cx, st.position[1] - cz);
    ok(`碰撞实例位姿与 layout 重算一致（偏差 ${dist.toFixed(3)} m）`, dist <= 0.5);
  } else {
    skip('碰撞世界记录', 'OUT_DIR 无 sansuitang-collision-world.json');
  }
}

// ---------- 5) 分区预算：garden zone 原始 GLB ≤ 12 MB ----------
{
  const zg = path.join(OUT, 'zone-garden.glb');
  if (fs.existsSync(zg)) {
    const b = fs.statSync(zg).size;
    ok(`zone-garden.glb ${b} ≤ 12000000`, b <= 12000000);
  } else skip('zone-garden.glb ≤ 12MB', '未导出分区');
}

console.log(`\nsansuitang-test: ${pass} pass, ${fail} fail, ${skipped} skipped`);
if (fail > 0) { for (const f of failures) console.log('  FAIL:', f); process.exit(1); }
