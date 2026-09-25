// wave3-tourfix T2：导览机位渲染后复核用的「目标单独着色」掩膜（playwright 钩子 window.__targetMask，viewer 交互不用）。
// 方法：用当前相机把场景另渲一遍到离屏 render target——目标几何白、其余几何黑（深度照常写，所以遮挡真实）、
// 背景黑、不做色调映射；读回像素，非黑像素占比 = 目标在画面里实际露出的像素占比。
// 目标两种写法：
//   { ids: [...] }：按节点归属 layout id（与 scripts/render-control-passes.py layout_id_of 同规则：
//     管道名 zone|id|kind|lod 第 2 段 → 父链上名字在 idSet 里的锚空节点 → awning-<id>-<k> 檐棚锚）；
//   { obb: {center, half, yaw}, pad }：体积目标（锚点街廊盒，没有对应 layout 对象）——片元世界坐标落在
//     OBB（各半轴 +pad）内即算目标像素，即「走廊里露出来的街面与街边立面」。
// 透明/镂空材质按不透明处理（alphaTest 贴图除外：沿用原贴图与阈值）。
import * as THREE from 'three';

function stripSuffix(name) {
  // Blender 重名后缀 .001 经 GLTFLoader sanitizeNodeName 去掉点号后变 001；只在去掉后命中 idSet 时才采用
  const m = /^(.*?)\.?(\d{3})$/.exec(name);
  return m ? m[1] : name;
}
function awningOwner(name, idSet) {
  if (!name.startsWith('awning-')) return null;
  const rest = name.slice('awning-'.length), k = rest.lastIndexOf('-');
  if (k > 0 && idSet.has(rest.slice(0, k))) return rest.slice(0, k);
  return null;
}
export function layoutIdOf(node, idSet) {
  for (let n = node; n; n = n.parent) {
    const name = String(n.name || '');
    if (name.includes('|')) {
      const parts = name.split('|');
      if (parts.length >= 4 || idSet.has(parts[1])) return parts[1];
    }
    if (n !== node) {
      if (idSet.has(name)) return name;
      const s = stripSuffix(name);
      if (s !== name && idSet.has(s)) return s;
      const aw = awningOwner(name, idSet) || awningOwner(s, idSet);
      if (aw) return aw;
    }
  }
  return null;
}

const VOL_VS = `
varying vec3 vWorld;
void main() {
  vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
  p = instanceMatrix * p;
#endif
  vec4 w = modelMatrix * p;
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const VOL_FS = `
uniform vec3 uCenter; uniform vec3 uHalf; uniform float uYaw;
varying vec3 vWorld;
void main() {
  vec3 d = vWorld - uCenter;
  float c = cos(uYaw), s = sin(uYaw);
  // 世界 → 盒局部（与 scripts/tour-visibility.mjs boxPoints 的 world(lx,ly,lz) 互逆）
  vec3 l = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
  bool inside = all(lessThanEqual(abs(l), uHalf));
  gl_FragColor = inside ? vec4(1.0) : vec4(0.0, 0.0, 0.0, 1.0);
}`;

export function installTargetMask({ renderer, scene, camera }) {
  window.__targetMask = (spec = {}) => {
    const idSet = new Set(spec.idSet || spec.ids || []);
    const want = new Set(spec.ids || []);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false });
    let vol = null;
    if (spec.obb) {
      const pad = spec.pad ?? 0;
      vol = new THREE.ShaderMaterial({
        vertexShader: VOL_VS, fragmentShader: VOL_FS,
        uniforms: {
          uCenter: { value: new THREE.Vector3(...spec.obb.center) },
          uHalf: { value: new THREE.Vector3(spec.obb.half[0] + pad, spec.obb.half[1] + pad, spec.obb.half[2] + pad) },
          uYaw: { value: spec.obb.yaw || 0 },
        },
      });
    }
    const saved = [], hidden = [], matCache = new Map();
    const variant = (base, orig) => { // 面剔除与原材质一致（遮挡才真实）；alphaTest 贴图沿用原贴图与阈值
      const side = orig ? orig.side : THREE.FrontSide;
      const alpha = base !== vol && orig && orig.alphaTest > 0 && orig.map;
      const k = base.uuid + ':' + side + (alpha ? ':' + orig.uuid : '');
      if (!matCache.has(k)) {
        const m = base.clone(); m.side = side;
        if (alpha) { m.map = orig.map; m.alphaTest = orig.alphaTest; }
        matCache.set(k, m);
      }
      return matCache.get(k);
    };
    const idCount = {};
    scene.traverse(o => {
      if (!o.visible) return;
      if (o.isSprite || o.isPoints || o.isLine) { hidden.push(o); return; }
      if (!o.isMesh) return;
      saved.push([o, o.material]);
      if (vol) { o.material = Array.isArray(o.material) ? o.material.map(m => variant(vol, m)) : variant(vol, o.material); return; }
      const id = layoutIdOf(o, idSet);
      const hit = id && want.has(id);
      if (hit) idCount[id] = (idCount[id] || 0) + 1;
      const base = hit ? white : black;
      o.material = Array.isArray(o.material) ? o.material.map(m => variant(base, m)) : variant(base, o.material);
    });
    for (const o of hidden) o.visible = false;
    const bg = scene.background, fog = scene.fog;
    scene.background = new THREE.Color(0, 0, 0); scene.fog = null;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = size.x, h = size.y;
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 0 });
    const prevRt = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    renderer.setRenderTarget(prevRt);
    for (const [o, m] of saved) o.material = m;
    for (const o of hidden) o.visible = true;
    scene.background = bg; scene.fog = fog;
    rt.dispose(); white.dispose(); black.dispose(); vol?.dispose(); for (const m of matCache.values()) m.dispose();
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.max(px[i], px[i + 1], px[i + 2]) > 8) n++;
    const out = { share: n / (w * h), pixels: n, w, h, meshesMatched: idCount };
    if (spec.png) { // 掩膜 PNG（上下翻转回屏幕朝向），供叠加截图
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'), img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * w * 4, dst = y * w * 4;
        for (let x = 0; x < w * 4; x += 4) {
          const on = Math.max(px[src + x], px[src + x + 1], px[src + x + 2]) > 8;
          img.data[dst + x] = on ? 255 : 0; img.data[dst + x + 1] = on ? 255 : 0; img.data[dst + x + 2] = on ? 255 : 0; img.data[dst + x + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      out.png = c.toDataURL('image/png');
    }
    return out;
  };
}
