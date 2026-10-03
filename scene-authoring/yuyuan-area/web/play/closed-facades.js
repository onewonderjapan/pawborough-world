// 闭门叠加层（工单 C 20261001「明显关门」）——play-only 懒加载 owner。
// 职责（唯一）：加载 resources/play-facades/play-closed-facades.glb（SHA256 校验，
// inputs/play-closed-facades.json 为准），scene.add 后即静态陈设；失败不假报
// ready、不碰物理/步行，只给一句玩家看得懂的提示（不露 SHA/GLB 等技术字段）。
// 页面卸载/显式 dispose 时移除 root 并只释放本 GLB 带进来的
// geometry/material/texture（共享资源一律不误 dispose——本叠加层不复用任何
// 世界/角色/小吃材质，loader 为本模块私有实例）。
//
// 纯决策可注入（node 测试不进浏览器）：fetchJson/fetchBuffer/parseGlb/digest。

import { applyWorldArtStyle } from '../material-style.js';

const MANIFEST_URL = '/inputs/play-closed-facades.json';

async function defaultFetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function defaultFetchBuffer(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

async function defaultDigest(buf) {
  if (!crypto?.subtle) return null;   // 无 subtle 环境（同 install.js 口径）：跳过校验
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function defaultParseGlb(buf) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new Promise((yes, no) => new GLTFLoader().parse(buf, '', yes, no));
  return gltf.scene;
}

// 玩家措辞（不露技术字段）；detail 只进 console。
export function closedFacadeHint(detail) {
  return '部分沿街铺面正在休整，这扇门面暂时没有展示出来，逛街不受影响。';
}

function releaseAsset(asset) {
  const geometry = new Set(), materials = new Set(), textures = new Set();
  asset?.traverse(o => {
    if (o.geometry) geometry.add(o.geometry);
    for (const m of (Array.isArray(o.material) ? o.material : o.material ? [o.material] : [])) {
      materials.add(m);
      for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const t of textures) t.dispose?.();
  for (const m of materials) m.dispose?.();
  for (const g of geometry) g.dispose?.();
}

export function createClosedFacades(deps = {}) {
  const {
    scene,
    manifestUrl = MANIFEST_URL,
    styleUrl = '/inputs/world-art-style.json',
    style = null,
    sharedMaterials = null,
    fetchJson = defaultFetchJson,
    fetchBuffer = defaultFetchBuffer,
    parseGlb = defaultParseGlb,
    digest = defaultDigest,
    onHint = null,
  } = deps;

  const state = {
    ready: false,
    count: 0,
    error: null,
    disposed: false,
  };
  let root = null;
  let abort = null;
  let onUnload = null;
  let pending = null;
  let artStyleOwner = null;
  let facadesSharedMaterials = null;

  const owner = {
    state,
    status() {
      // 只读快照（install.js status() 汇入 __play.status）
      return {
        closedFacadesReady: state.ready,
        closedFacadeCount: state.count,
        closedFacadesError: state.error,
        closedFacadesArtStyleMatched: artStyleOwner?.stats?.matchedMeshes ?? 0,
        closedFacadesArtStyleFamilies: artStyleOwner?.stats?.appliedFamilies ?? [],
      };
    },
    install() {
      if (pending) return pending;
      pending = (async () => {
        if (state.disposed || root || state.error) return state;
        abort = new AbortController();
        let loaded = null;
        try {
          const manifest = await fetchJson(manifestUrl);
          const m = manifest?.facades;
          if (!m?.path) throw new Error('manifest missing facades.path');
          const buf = await fetchBuffer('/' + m.path.replace(/^\//, ''), abort.signal);
          if (abort.signal.aborted) return state;
          if (m.sha256) {
            const sha = await digest(buf);
            if (sha && sha !== m.sha256) {
              throw new Error(`sha mismatch ${sha.slice(0, 12)}… != ${m.sha256.slice(0, 12)}…`);
            }
          }
          if (abort.signal.aborted) return state;
          loaded = await parseGlb(buf);
          if (abort.signal.aborted) { releaseAsset(loaded); return state; }
          // 计数口径：manifest 为准；GLB root extras 有 closedCount 且不符时按异常处理
          const glbRoot = loaded.getObjectByName?.(m.root ?? 'play-closed-facades') ?? loaded;
          const glbCount = glbRoot?.userData?.closedCount;
          if (Number.isFinite(glbCount) && m.closedCount && glbCount !== m.closedCount) {
            throw new Error(`closedCount mismatch ${glbCount} != ${m.closedCount}`);
          }
          root = loaded;
          scene.add(root);

          // Apply approved pilot / world art style if style is available or fetchable
          let activeStyle = style;
          if (!activeStyle && typeof fetchJson === 'function') {
            try {
              activeStyle = await fetchJson(styleUrl);
            } catch {
              activeStyle = null;
            }
          }
          if (activeStyle && Array.isArray(activeStyle.families) && root) {
            try {
              facadesSharedMaterials = sharedMaterials || new Map();
              artStyleOwner = applyWorldArtStyle(root, {
                style: activeStyle,
                sharedMaterials: facadesSharedMaterials
              });
            } catch (err) {
              console.warn('closed facades art style application skipped:', err);
            }
          }

          state.count = m.closedCount ?? glbCount ?? 0;
          state.ready = true;
          if (!onUnload && typeof window !== 'undefined' && window.addEventListener) {
            onUnload = () => owner.dispose();
            window.addEventListener('pagehide', onUnload, { once: true });
          }
        } catch (e) {
          if (loaded && loaded !== root) releaseAsset(loaded);
          if (state.disposed || abort?.signal.aborted) return state;
          state.error = e?.message || String(e);
          console.error('closed facades failed', e);
          onHint?.(closedFacadeHint(state.error));
        }
        return state;
      })();
      return pending;
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      abort?.abort();
      if (onUnload && typeof window !== 'undefined') window.removeEventListener('pagehide', onUnload);
      if (artStyleOwner) {
        artStyleOwner.dispose();
        artStyleOwner = null;
      }
      if (root) {
        scene.remove(root);
        // 只释放本 GLB 自带的资源：traverse 整棵 overlay 子树，材质/贴图都是
        // 本模块私有 loader 生成的实例，不与世界/角色共享
        releaseAsset(root);
        root = null;
      }
      state.ready = false;
    },
  };
  if (typeof window !== 'undefined' && window.addEventListener) {
    onUnload = () => owner.dispose();
    window.addEventListener('pagehide', onUnload, { once: true });
  }
  return owner;
}
