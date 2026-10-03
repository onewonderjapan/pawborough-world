// wave11-lighting：查看器灯光预设（?light=day|dusk|night，默认 day）+ 太阳阴影（?shadow=0 关）+ 渐变天空 + 夜间自发光 / 点光池。
// 共享预设来源 lighting/presets.json（scripts/render-control-passes.py --beauty cycles|eevee 读同一份；两端共享 / 单端字段见 docs/CONTROL-PASSES.md wave11 段），本文件只写「怎么用」：
//   - 太阳：DirectionalLight，方向 = presets 方位角 / 高度角（地图系 +x 东、-z 北）；阴影贴图跟随视点：
//     正交阴影相机以取景焦点为中心、半宽 = clamp(相机到注视点距离 × extentPerDistance, extentMinM, extentMaxM)（步行：中心 = 视点沿水平视线前方 0.6 × walkExtentM ≈ 27 m，半宽 = walkExtentM = 45 m），
//     焦点按阴影贴图纹素对齐（避免移动时阴影边缘闪烁）。
//     与 web/batching.js 兼容：合批 BatchedMesh 本身开 castShadow / receiveShadow（three 的 BatchedMesh.onBeforeShadow 走同一个
//     合并区间的 onBeforeRender，按阴影相机逐成员剔除）；原网格在 ORIGINAL_LAYER，主相机层不含它，阴影通道同样跳过（不会画两遍）。
//     透明且有贴图的材质（镂空挂落 / 复廊花窗）用 alphaTest 0.5 的自定义深度材质投影；透明无贴图（玻璃 / 汤水）不投影。
//   - 环境光：HemisphereLight(ambient.sky, ambient.ground, ambient.intensity)。
//   - 天空：运行时生成 256×128 等距柱状 DataTexture 作 scene.background（不下载任何贴图），公式见 presets.json conventions.sky；
//     target-mask.js 掩膜渲染时照旧把 background 换成黑色，天空不会被算成几何。
//   - 色调映射：Khronos PBR Neutral（three NeutralToneMapping，Blender 同名视图变换），曝光 = preset.exposure。
//   - 自发光：按材质名（去 .NNN 后缀）匹配 emissiveGroups，emissive / emissiveIntensity（× preset.emissiveScale）；
//     共用材质对象，合批网格同步生效，不增加绘制调用；切回白天恢复原值。
//   - 点光池：preset.pointLights 盏（≤ pointLights.max），每 reassignFrames 帧分给离焦点最近的候选位置
//     （灯笼材质顶点按 clusterM 聚类的中心、摊位锚点上方 offsetY），焦点跳变（切导览机位）超过点光半径一半时当帧重分；点光不投影。灯数只在切换预设时变（三次着色器重编译）。
// 测量参数：?glow=0 夜间关自发光、?plights=N 覆盖点光池灯数（只对有点光的预设生效，0–32），均只用于对照测量。
// 读取失败（404 / 网络 / JSON 解析 / 结构校验不过 / 初始化抛错）或超过 PRESETS_TIMEOUT_MS=3 s 未到：统一回退旧灯光（Hemisphere + Directional、
// ACES 1.05、纯色背景），不开阴影、不建点光、不改材质，P / cur 清空，state().error 记原因；ready 永不 reject，场景照常加载。
// 超时不取消请求：迟到的应答若合法，再切到预设（state().lateApplied）；挂起则一直停在旧灯光（tests/lighting-fallback-check.mjs）。
// 预设选择（R2）：set() 在预设未就绪时只记下请求，就绪（含迟到升级）后按最近一次请求初始化；每次成功应用 / 回退都经 onChange 推给界面、并同步地址栏 ?light=。
// 测试钩子：window.__lighting.state()（当前预设 / 阴影 / 灯数 / 匹配到的材质数等）、window.__lighting.set(name)。
import * as THREE from 'three';
import { createSubjectLight } from './play/subject-light.js';

const LEGACY = { hemi: [0xffffff, 0x9a927e, 1.35], sun: [0xfff4e0, 1.6, [-260, 420, -180]], bg: 0xdfe8ec, exposure: 1.05 };

export const PRESETS_TIMEOUT_MS = 3000;   // presets.json 读取上限；超时即回退旧灯光，场景照常加载

// presets.json 结构校验（查看器实际用到的字段；缺任何一个都整体回退，不做半初始化）。返回问题列表，空 = 合法
export function validatePresets(j) {
  const bad = [];
  const num = (v, k) => { if (typeof v !== 'number' || !Number.isFinite(v)) bad.push(k + ' not a number'); };
  const str = (v, k) => { if (typeof v !== 'string' || !v) bad.push(k + ' not a string'); };
  const obj = (v, k) => { if (!v || typeof v !== 'object' || Array.isArray(v)) { bad.push(k + ' missing'); return false; } return true; };
  if (!obj(j, 'root')) return bad;
  if (!obj(j.presets, 'presets')) return bad;
  str(j.default, 'default');
  if (typeof j.default === 'string' && !j.presets[j.default]) bad.push('default preset missing');
  for (const [n, p] of Object.entries(j.presets)) {
    if (!obj(p, `presets.${n}`)) continue;
    if (obj(p.sun, `${n}.sun`)) { num(p.sun.azimuthDeg, `${n}.sun.azimuthDeg`); num(p.sun.elevationDeg, `${n}.sun.elevationDeg`); str(p.sun.color, `${n}.sun.color`); num(p.sun.intensity, `${n}.sun.intensity`); }
    if (obj(p.ambient, `${n}.ambient`)) { str(p.ambient.sky, `${n}.ambient.sky`); str(p.ambient.ground, `${n}.ambient.ground`); num(p.ambient.intensity, `${n}.ambient.intensity`); }
    if (obj(p.sky, `${n}.sky`)) { for (const k of ['zenith', 'horizon', 'ground', 'sunGlowColor']) str(p.sky[k], `${n}.sky.${k}`); for (const k of ['exponent', 'sunGlow', 'sunGlowPower']) num(p.sky[k], `${n}.sky.${k}`); }
    num(p.exposure, `${n}.exposure`); num(p.emissiveScale, `${n}.emissiveScale`); num(p.pointLights, `${n}.pointLights`);
  }
  if (!Array.isArray(j.emissiveGroups)) bad.push('emissiveGroups not an array');
  else j.emissiveGroups.forEach((g, i) => { if (!g || !Array.isArray(g.materials)) bad.push(`emissiveGroups[${i}].materials`); else { str(g.color, `emissiveGroups[${i}].color`); num(g.intensity, `emissiveGroups[${i}].intensity`); } });
  if (obj(j.pointLights, 'pointLights')) {
    for (const k of ['max', 'intensity', 'distance', 'decay', 'reassignFrames']) num(j.pointLights[k], 'pointLights.' + k);
    str(j.pointLights.color, 'pointLights.color');
    if (!Array.isArray(j.pointLights.sources)) bad.push('pointLights.sources not an array');
    else j.pointLights.sources.forEach((s, i) => {
      if (!s || !['node-anchor', 'material-clusters'].includes(s.kind)) bad.push(`pointLights.sources[${i}].kind`);
      else { num(s.offsetY, `pointLights.sources[${i}].offsetY`); if (s.kind === 'node-anchor') str(s.pattern, `pointLights.sources[${i}].pattern`); else { num(s.clusterM, `pointLights.sources[${i}].clusterM`); if (!Array.isArray(s.materials)) bad.push(`pointLights.sources[${i}].materials`); } }
    });
  }
  if (obj(j.viewer, 'viewer')) {
    str(j.viewer.toneMapping, 'viewer.toneMapping');
    if (obj(j.viewer.shadow, 'viewer.shadow')) for (const k of ['mapSize', 'bias', 'normalBias', 'extentMinM', 'extentMaxM', 'extentPerDistance', 'walkExtentM']) num(j.viewer.shadow[k], 'viewer.shadow.' + k);
    if (obj(j.viewer.skyTexture, 'viewer.skyTexture')) { num(j.viewer.skyTexture.width, 'viewer.skyTexture.width'); num(j.viewer.skyTexture.height, 'viewer.skyTexture.height'); }
  }
  return bad;
}

export const baseMaterialName = (n) => String(n || '').replace(/\.\d{3}$/, '');

function dirFrom(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg), el = THREE.MathUtils.degToRad(elevationDeg);
  // 方位角从北（-z）顺时针到东（+x）
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}
const lin = (hex) => new THREE.Color(hex);   // ColorManagement：hex 视为 sRGB，存为线性

// 天空渐变（presets.json conventions.sky 同式）：返回线性 RGB
export function skyColor(sky, sunDir, d, out) {
  const s = d.y;
  const zen = lin(sky.zenith), hor = lin(sky.horizon), gnd = lin(sky.ground);
  if (s >= 0) out.copy(hor).lerp(zen, Math.pow(s, sky.exponent));
  else out.copy(hor).lerp(gnd, Math.min(1, -s * 8));
  const c = Math.max(0, d.dot(sunDir));
  const g = sky.sunGlow * Math.pow(c, sky.sunGlowPower);
  if (g > 0) out.add(lin(sky.sunGlowColor).multiplyScalar(g));
  return out;
}
function skyTexture(sky, sunDir, w, h) {
  const data = new Uint8Array(w * h * 4);
  const d = new THREE.Vector3(), c = new THREE.Color();
  for (let y = 0; y < h; y++) {
    // three 等距柱状：v=1 为天顶（纹理第 0 行在底部 → 行 y 对应 v=(y+0.5)/h）
    const v = (y + 0.5) / h, lat = (v - 0.5) * Math.PI;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w, lon = (u - 0.5) * 2 * Math.PI;
      // three equirectUv：u = atan(dir.z, dir.x)/(2π) + 0.5，v = asin(dir.y)/π + 0.5
      d.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      skyColor(sky, sunDir, d, c);
      c.convertLinearToSRGB();
      const i = (y * w + x) * 4;
      data[i] = Math.round(THREE.MathUtils.clamp(c.r, 0, 1) * 255);
      data[i + 1] = Math.round(THREE.MathUtils.clamp(c.g, 0, 1) * 255);
      data[i + 2] = Math.round(THREE.MathUtils.clamp(c.b, 0, 1) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function installLighting({ renderer, scene, camera, controls, params, getWalkMode = () => 'orbit' }) {
  const want = params.get('light') || null;
  let inFlight = true;   // presets.json 请求尚未有结果（超时回退后仍可能为 true：迟到升级）
  let requested = want;   // 最近一次请求的预设（启动参数或之后 set()，含预设未就绪期间的选择；R2）
  const listeners = new Set();   // onChange 回调：每次预设成功应用 / 回退后同步界面（下拉框）
  const shadowOn = params.get('shadow') !== '0';
  const glowOff = params.get('glow') === '0';   // 调试：夜间关掉自发光（对照测量用）
  const plOverride = params.has('plights') ? Math.max(0, Math.min(32, parseInt(params.get('plights'), 10) || 0)) : null;   // 测量用：覆盖点光池灯数（0–32，不受 max 限制）
  const hemi = new THREE.HemisphereLight(...LEGACY.hemi);
  const sun = new THREE.DirectionalLight(LEGACY.sun[0], LEGACY.sun[1]);
  sun.position.set(...LEGACY.sun[2]);
  scene.add(hemi, sun, sun.target);
  scene.background = new THREE.Color(LEGACY.bg);
  renderer.toneMappingExposure = LEGACY.exposure;
  const subjectLight = createSubjectLight({ scene, isActive: () => getWalkMode() === 'walk' });

  let shadowActive = false;   // 预设成功落地后才 = shadowOn；读不到 / 不合法 / 超时时保持 false（旧灯光无阴影）
  let P = null, cur = null, error = null, sunDir = new THREE.Vector3(...LEGACY.sun[2]).normalize();
  let bgOn = true, skyTex = null;
  const mats = new Map();         // material -> { base, group, orig }
  const shadowMeshes = new Set();
  const candidates = [];          // { pos: Vector3, source }
  const pool = [];
  let frame = 0, extent = 0;
  const focus = new THREE.Vector3();
  const assignedAt = new THREE.Vector3(NaN, NaN, NaN);   // 上次分配点光时的焦点（焦点跳变 → 立即重分，不等 reassignFrames）

  function groupOf(base) {
    if (!P) return null;
    return P.emissiveGroups.find(g => g.materials.includes(base)) || null;
  }
  function registerMaterial(m) {
    if (!m || mats.has(m) || !m.emissive) return;
    const base = baseMaterialName(m.name);
    mats.set(m, { base, orig: { emissive: m.emissive.clone(), intensity: m.emissiveIntensity, map: m.emissiveMap } });
  }
  function applyEmissive() {
    const scale = cur && !glowOff ? (P.presets[cur].emissiveScale || 0) : 0;
    let matched = 0;
    for (const [m, r] of mats) {
      const g = groupOf(r.base);
      const hadMap = !!m.emissiveMap;
      if (g && scale > 0) {
        m.emissive.set(g.color);
        m.emissiveIntensity = g.intensity * scale;
        m.emissiveMap = g.useMap && m.map ? m.map : r.orig.map;
        matched++;
      } else {
        m.emissive.copy(r.orig.emissive); m.emissiveIntensity = r.orig.intensity; m.emissiveMap = r.orig.map;
      }
      if (hadMap !== !!m.emissiveMap) m.needsUpdate = true;
    }
    return matched;
  }
  function setShadowFlags(o) {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const cast = shadowActive && !(m && m.transparent && !m.map);
    o.castShadow = cast; o.receiveShadow = shadowActive;
    if (cast && m && m.transparent && m.map && !o.customDepthMaterial) {
      o.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: 0.5, side: m.side });
    }
    if (cast) shadowMeshes.add(o);
  }
  // 候选点光位置（每个分区件加载后调用）
  function collectCandidates(root) {
    if (!P) return;
    root.updateMatrixWorld(true);
    for (const src of P.pointLights.sources) {
      if (src.kind === 'node-anchor') {
        const re = new RegExp(src.pattern);
        root.traverse(o => { if (re.test(o.name || '')) candidates.push({ pos: o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, src.offsetY, 0)), source: src.id }); });
      } else if (src.kind === 'material-clusters') {
        const cells = new Map(), v = new THREE.Vector3(), c = src.clusterM;
        root.traverse(o => {
          if (!o.isMesh || o.isBatchedMesh || !o.geometry?.attributes?.position) return;
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          if (!m || !src.materials.includes(baseMaterialName(m.name))) return;
          const pa = o.geometry.attributes.position;
          for (let i = 0; i < pa.count; i++) {
            v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld);
            const k = `${Math.floor(v.x / c)},${Math.floor(v.y / c)},${Math.floor(v.z / c)}`;
            const e = cells.get(k) || { s: new THREE.Vector3(), n: 0 };
            e.s.add(v); e.n++; cells.set(k, e);
          }
        });
        for (const e of cells.values()) candidates.push({ pos: e.s.divideScalar(e.n).add(new THREE.Vector3(0, src.offsetY, 0)), source: src.id });
      }
    }
  }
  const roots = [], batchRoots = [];   // 登记过的分区根 / 合批组（预设迟到时补阴影标记与点光候选）
  function registerRoot(root) {
    root.traverse(o => {
      if (!o.isMesh) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(registerMaterial);
      setShadowFlags(o);
    });
    roots.push(root);
    if (P) { collectCandidates(root); if (cur) applyEmissive(); }
  }
  // 合批后调用：新出现的 BatchedMesh 继承阴影开关
  function registerBatches(root) {
    batchRoots.push(root);
    root.traverse(o => { if (o.isBatchedMesh) setShadowFlags(o); });
  }

  function updatePool() {
    const n = !cur ? 0 : plOverride !== null && (P.presets[cur].pointLights || 0) > 0 ? plOverride : Math.min(P.presets[cur].pointLights || 0, P.pointLights.max);
    while (pool.length > n) scene.remove(pool.pop());
    const pl = P.pointLights;
    while (pool.length < n) {
      const l = new THREE.PointLight(pl.color, pl.intensity, pl.distance, pl.decay);
      l.castShadow = false; l.name = 'lighting-pool-' + pool.length;
      scene.add(l); pool.push(l);
    }
  }
  function assignPool() {
    if (!pool.length) return;
    if (!candidates.length) { for (const l of pool) l.visible = false; return; }
    const ranked = candidates.map(c => [c.pos.distanceToSquared(focus), c]).sort((a, b) => a[0] - b[0]);
    pool.forEach((l, i) => { const c = ranked[i]; l.visible = !!c; if (c) l.position.copy(c[1].pos); });
    assignedAt.copy(focus);
  }

  function apply(name) {
    if (!P) return false;
    if (!P.presets[name]) name = P.default;
    cur = name;
    const p = P.presets[name];
    renderer.toneMapping = P.viewer.toneMapping === 'neutral' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = p.exposure;
    sunDir = dirFrom(p.sun.azimuthDeg, p.sun.elevationDeg);
    sun.color.set(p.sun.color); sun.intensity = p.sun.intensity;
    hemi.color.set(p.ambient.sky); hemi.groundColor.set(p.ambient.ground); hemi.intensity = p.ambient.intensity;
    skyTex?.dispose();
    skyTex = skyTexture(p.sky, sunDir, P.viewer.skyTexture.width, P.viewer.skyTexture.height);
    scene.background = bgOn ? skyTex : new THREE.Color(0x101418);
    const matched = applyEmissive();
    updatePool(); frame = 0;
    subjectLight.setPreset(name, p);
    state.matchedMaterials = matched;
    syncSelection();
    return true;
  }
  // R2：预设状态唯一出口——成功应用（首次、迟到升级、用户切换）或回退后，把实际状态推给地址栏与界面。
  // 地址栏：已有 ?light= 或实际预设不是默认档时写 light=实际预设（默认 day 且原本没参数时不添参数）。
  function syncSelection() {
    if (cur) {
      try {
        const u = new URL(location.href);
        if (u.searchParams.has('light') || cur !== P.default) { u.searchParams.set('light', cur); history.replaceState(history.state, '', u); }
      } catch (e) { /* 非浏览器环境 */ }
    }
    const st = { preset: cur, requested, pending: !P && inFlight };
    for (const fn of listeners) { try { fn(st); } catch (e) { console.warn('lighting onChange listener failed', e); } }
  }

  // 阴影相机跟随取景焦点（每帧）
  const _fwd = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
  function fitShadow() {
    const walking = getWalkMode() === 'walk';
    const S = P ? P.viewer.shadow : null;
    if (walking) {
      camera.getWorldDirection(_fwd); _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
      _fwd.normalize();
      extent = S ? S.walkExtentM : 45;
      focus.copy(camera.position).addScaledVector(_fwd, extent * 0.6);
    } else {
      focus.copy(controls.target);
      const d = camera.position.distanceTo(controls.target);
      extent = S ? THREE.MathUtils.clamp(d * S.extentPerDistance, S.extentMinM, S.extentMaxM) : 200;
    }
    if (!shadowActive || !P) { sun.position.copy(focus).addScaledVector(sunDir, 500); sun.target.position.copy(focus); return; }
    // 纹素对齐：焦点在光源平面内的坐标取整到纹素
    const texel = (2 * extent) / S.mapSize;
    _u.set(0, 1, 0); if (Math.abs(sunDir.y) > 0.99) _u.set(0, 0, 1);
    _r.crossVectors(_u, sunDir).normalize(); _u.crossVectors(sunDir, _r).normalize();
    const a = Math.round(focus.dot(_r) / texel) * texel, b = Math.round(focus.dot(_u) / texel) * texel, c = focus.dot(sunDir);
    focus.set(0, 0, 0).addScaledVector(_r, a).addScaledVector(_u, b).addScaledVector(sunDir, c);
    const dist = extent * 2 + 200;
    sun.position.copy(focus).addScaledVector(sunDir, dist);
    sun.target.position.copy(focus);
    const cam = sun.shadow.camera;
    if (cam.right !== extent || cam.far !== dist + extent * 2) {
      cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent;
      cam.near = 1; cam.far = dist + extent * 2;
      cam.updateProjectionMatrix();
    }
  }

  function tick() {
    subjectLight.tick();
    if (!P) return;
    fitShadow();
    // 每 reassignFrames 帧重分一次（新分区加载后的候选、步行缓慢移动）；导览 / 机位切换这类焦点跳变（> 点光半径的一半）当帧就重分，
    // 否则切机位后最多要等 reassignFrames 帧灯才跟过来（swiftshader ~1 fps 下是十几秒的「没开灯」画面）
    const jumped = !(focus.distanceToSquared(assignedAt) <= (P.pointLights.distance * 0.5) ** 2);
    if (pool.length && (frame++ % P.pointLights.reassignFrames === 0 || jumped)) assignPool();
  }

  const state = { preset: null, requested: want, shadow: shadowOn, matchedMaterials: 0, error: null, timedOut: false, lateApplied: false, presetsMs: null };
  // 预设读取：有限超时 + 先校验后发布 + 任何失败统一回退旧灯光（R1，Codex astra 审查 P1）。
  // main.js 的分区加载排在 ready 之后，所以 ready 必须在 PRESETS_TIMEOUT_MS 内结束且永不 reject。
  function fallback(e) {
    error = String(e && e.message || e); state.error = error;
    P = null; cur = null; state.preset = null; state.matchedMaterials = 0;
    shadowActive = false;
    renderer.shadowMap.enabled = false; sun.castShadow = false;
    for (const o of shadowMeshes) { o.castShadow = false; o.receiveShadow = false; }
    shadowMeshes.clear();
    while (pool.length) scene.remove(pool.pop());
    candidates.length = 0;
    subjectLight.setPreset(null);
    applyEmissive();   // cur = null → 全部材质恢复原 emissive
    hemi.color.set(LEGACY.hemi[0]); hemi.groundColor.set(LEGACY.hemi[1]); hemi.intensity = LEGACY.hemi[2];
    sun.color.set(LEGACY.sun[0]); sun.intensity = LEGACY.sun[1]; sun.position.set(...LEGACY.sun[2]); sun.target.position.set(0, 0, 0);
    sunDir.set(...LEGACY.sun[2]).normalize();
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = LEGACY.exposure;
    skyTex?.dispose(); skyTex = null;
    scene.background = new THREE.Color(bgOn ? LEGACY.bg : 0x101418);
    console.warn('lighting presets unavailable, legacy lighting kept:', error);
    syncSelection();
  }
  // 读取：3 s 内没有结果就先回退旧灯光让场景照常加载（ready 结束）；请求不取消——之后若迟到的应答合法，再切到预设
  // （「迟到升级」：swiftshader + 机器负载下主线程被占时，本地 6 KB 文件也可能超过 3 s 才轮到回调）。
  // 404 / 网络错误 / JSON 解析失败 / 校验不过 / 初始化抛错都是最终失败：回退旧灯光并停在那里。
  function init(j) {
    const bad = validatePresets(j);
    if (bad.length) throw new Error('presets.json invalid: ' + bad.slice(0, 6).join('; ') + (bad.length > 6 ? ` (+${bad.length - 6})` : ''));
    P = j;   // 校验通过才发布；下面任何一步抛错都走 fallback 清空
    if (shadowOn) {
      shadowActive = true;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = P.viewer.shadow.type === 'PCFSoft' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
      sun.castShadow = true;
      sun.shadow.mapSize.set(P.viewer.shadow.mapSize, P.viewer.shadow.mapSize);
      sun.shadow.bias = P.viewer.shadow.bias; sun.shadow.normalBias = P.viewer.shadow.normalBias;
    }
    for (const r of [...roots, ...batchRoots]) r.traverse(setShadowFlags);
    for (const r of roots) collectCandidates(r);
    if (P.subjectLight) subjectLight.configure(P.subjectLight);
    apply(requested && P.presets[requested] ? requested : P.default);   // R2：用最近一次请求（等待期间的下拉选择也算），不是启动时的 want
    error = null; state.error = null;
  }
  const t0 = performance.now();
  let settled = false;
  const ready = new Promise((resolve) => {
    const done = () => { if (!settled) { settled = true; resolve(); } };
    const timer = setTimeout(() => {
      if (settled) return;
      state.timedOut = true;
      try { fallback(new Error(`presets.json timeout ${PRESETS_TIMEOUT_MS} ms`)); } catch (e2) { console.warn('lighting fallback failed', e2); }
      done();
    }, PRESETS_TIMEOUT_MS);
    fetch('/lighting/presets.json')
      .then(r => { if (!r.ok) throw new Error('presets.json ' + r.status); return r.json(); })
      .then(j => {
        clearTimeout(timer);
        state.presetsMs = Math.round(performance.now() - t0);
        const late = settled;
        inFlight = false;
        init(j);
        if (late) state.lateApplied = true;   // R2：初始化成功后才记（迟到但非法的应答走 fallback，不留 lateApplied）
      })
      .catch(e => { clearTimeout(timer); inFlight = false; try { fallback(e); } catch (e2) { console.warn('lighting fallback failed', e2); } })
      .finally(() => { inFlight = false; done(); });
  });

  const api = {
    ready, tick, registerRoot, registerBatches,
    // R2：预设未就绪（等待迟到应答 / 已回退）时记下请求，就绪后按它初始化；返回 true = 已应用
    set: (name) => { requested = name; state.requested = name; if (!P) { syncSelection(); return false; } return apply(name); },
    onChange(fn) { listeners.add(fn); fn({ preset: cur, requested, pending: !P && inFlight }); return () => listeners.delete(fn); },
    setBackdrop(on) { bgOn = on; scene.background = on ? (skyTex || new THREE.Color(LEGACY.bg)) : new THREE.Color(0x101418); },
    get presets() { return P; },
    state() {
      return {
        ...state, preset: cur, shadowActive, sunDir: sunDir.toArray().map(v => +v.toFixed(4)),
        sun: { intensity: sun.intensity, color: '#' + sun.color.getHexString(), castShadow: sun.castShadow, mapSize: sun.shadow.mapSize.x, extent: +extent.toFixed(1) },
        hemi: { intensity: hemi.intensity, sky: '#' + hemi.color.getHexString(), ground: '#' + hemi.groundColor.getHexString() },
        exposure: renderer.toneMappingExposure, toneMapping: renderer.toneMapping === THREE.NeutralToneMapping ? 'neutral' : renderer.toneMapping,
        shadowMapEnabled: renderer.shadowMap.enabled, shadowCasters: [...shadowMeshes].filter(o => o.parent).length,
        pointLights: pool.length, pointLightsVisible: pool.filter(l => l.visible).length, candidates: candidates.length,
        candidatesBySource: candidates.reduce((a, c) => ((a[c.source] = (a[c.source] || 0) + 1), a), {}),
        emissiveByGroup: P ? Object.fromEntries(P.emissiveGroups.map(g => [g.id, [...mats].filter(([m, r]) => g.materials.includes(r.base) && m.emissiveIntensity > 0 && cur && P.presets[cur].emissiveScale > 0 && !glowOff).length])) : null,
        background: scene.background && scene.background.isTexture ? 'sky-texture' : 'color',
        subjectLight: subjectLight.state(),
      };
    },
    subjectLight,
  };
  window.__lighting = api;
  return api;
}
