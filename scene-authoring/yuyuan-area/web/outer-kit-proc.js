// wave7-outerkit 方案 C（OUTER_KIT_MODE=proc，只供方案对比测量）：外围套件网格不带贴图，UV 编码「类别 + 参数」，
// 由这里的 shader 在运行时画窗 / 店面 / 瓦垄。编码见 src/outer-kit.mjs（uv.x = 沿墙米数或沿脊米数；uv.y = 类别 × 32 + e，
// 墙 e = 檐口高，瓦面 e = 到屋脊斜距）。只认 glTF extras outerKit === 'proc' 的网格；没有这类网格时本模块什么也不做。
import * as THREE from 'three';

const VERT_DECL = `
varying vec2 vKit;
varying vec3 vKitW;
`;
const VERT_BODY = `
{
  vec4 kitW = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  kitW = batchingMatrix * kitW;
#endif
  kitW = modelMatrix * kitW;
  vKitW = kitW.xyz;
#ifdef USE_MAP
  vKit = vMapUv;   // gltfpack 量化 UV 的反量化在 map 的 texture transform 里
#else
  vKit = uv;
#endif
}
`;
const FRAG_DECL = `
varying vec2 vKit;
varying vec3 vKitW;
float kitBox(vec2 p, vec2 lo, vec2 hi) { return step(lo.x, p.x) * step(p.x, hi.x) * step(lo.y, p.y) * step(p.y, hi.y); }
vec3 kitWindow(vec3 wall, vec2 f, vec2 c, vec2 hs) {
  float outer = kitBox(f, c - hs, c + hs);
  float inner = kitBox(f, c - hs + vec2(0.035, 0.05), c + hs - vec2(0.035, 0.05));
  float mull = step(abs(fract((f.x - c.x + hs.x) / (hs.x * 2.0 / 3.0)) - 0.0), 0.06);
  vec3 wood = vec3(0.36, 0.23, 0.15), glass = vec3(0.17, 0.155, 0.14);
  vec3 col = mix(wall, wood, outer);
  col = mix(col, mix(glass, wood, mull), inner);
  return col;
}
vec3 kitAlbedo(vec2 k, vec3 w) {
  float code = floor(k.y / 32.0 + 0.001);
  float e = k.y - code * 32.0;
  float along = k.x;
  vec3 plaster = vec3(0.87, 0.85, 0.80) * (0.95 + 0.05 * sin(along * 1.7 + w.y * 0.9));
  if (code < 0.5) {                                   // 瓦面
    float ch = fract(along / 0.2);
    float co = fract(e / 0.25);
    float sh = 1.0 + 0.16 * (1.0 - smoothstep(0.0, 0.18, abs(ch - 0.25))) - 0.22 * (1.0 - smoothstep(0.0, 0.2, abs(ch - 0.75)));
    sh *= co > 0.8 ? 0.8 : 1.0;
    return vec3(0.33, 0.34, 0.36) * sh;
  }
  if (code > 5.5 && code < 6.5) return vec3(0.23, 0.17, 0.12);   // 封檐 / 檐底 / 屋脊
  if (code > 6.5 && code < 7.5) return vec3(0.61, 0.59, 0.55);   // 晒台板
  if (code > 7.5) {                                   // 老虎窗正面：沿宽 0..1.8 m，高 0..e
    vec2 f = vec2(along / 1.8, 0.5);
    return kitBox(f, vec2(0.2, 0.0), vec2(0.8, 1.0)) > 0.5 ? vec3(0.17, 0.155, 0.14) : vec3(0.36, 0.23, 0.15);
  }
  float y = w.y;
  if (code > 4.5 || e < 0.5 || y > e) return plaster;              // 共墙 / 山尖 / 女儿墙
  float lv = max(1.0, floor(e / 2.6 + 0.2));
  float fh = e / lv;
  float st = floor(y / fh);
  vec2 f = vec2(fract(along / 3.6), fract(y / fh));
  vec3 col = plaster;
  if (y < 0.6 && code < 3.5) return vec3(0.46, 0.45, 0.42);         // 青砖勒脚
  if (code > 0.5 && code < 1.5 && st < 0.5) {                       // 店面底层
    if (f.y > 0.84) return vec3(0.23, 0.17, 0.12);
    float board = step(0.83, fract(along / 0.145));
    return mix(vec3(0.43, 0.29, 0.19), vec3(0.25, 0.17, 0.11), board);
  }
  if (code > 2.5 && code < 3.5) {                                   // 山墙侧：楼上每 6.4 m 一扇小窗
    if (st < 0.5) return plaster;
    vec2 g = vec2(fract(along / 6.4), f.y);
    return kitWindow(plaster, g, vec2(0.5, 0.58), vec2(0.055, 0.16));
  }
  if (code > 1.5 && code < 2.5 && st < 0.5) {                       // 民居底层：偶数开间门、奇数开间窗
    if (mod(floor(along / 3.6), 2.0) < 0.5) return kitBox(f, vec2(0.3, 0.0), vec2(0.7, 0.82)) > 0.5 ? vec3(0.12, 0.11, 0.105) : plaster;
    return kitWindow(plaster, f, vec2(0.5, 0.55), vec2(0.17, 0.2));
  }
  vec3 wall = code > 3.5 ? vec3(0.80, 0.78, 0.74) : plaster;       // 公房灰白墙
  return kitWindow(wall, f, vec2(0.5, 0.56), vec2(0.21, 0.26));
}
`;

let shared = null;
function makeMaterial(src) {
  // 保留原材质的白图（带 KHR_texture_transform 反量化），shader 从 vMapUv 取编码
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, map: src && src.map ? src.map : null });
  m.name = 'outerkit-proc-runtime';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = kitAlbedo(vKit, vKitW);');
  };
  m.customProgramCacheKey = () => 'outerkit-proc-v1';
  return m;
}
// 分区件加载后、合批前调用（同一材质对象 → 合批仍按材质成组）
export function patchOuterKitProc(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    let ud = o.userData;
    if (!(ud && ud.outerKit === 'proc') && o.parent && o.parent.userData && o.parent.userData.outerKit === 'proc') ud = o.parent.userData;
    if (!(ud && ud.outerKit === 'proc')) return;
    if (!shared) shared = makeMaterial(o.material);
    o.material = shared;
    n++;
  });
  return n;
}
