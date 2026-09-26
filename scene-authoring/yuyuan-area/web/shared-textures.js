// wave9-sharedtex：分区件之间共用贴图 —— 同一内容的贴图整个会话只下载 / 解码一次。
//
// 产物侧（scripts/share-textures.mjs）：各 zone-*.cm.glb 内嵌的贴图抽成按内容命名的外置文件 out/tex/<sha256 前 16 位>.<ext>，
// GLB 里 images[i] 改成 { uri: 'tex/<hash>.<ext>', mimeType, name }（name 保留，three 的 texture.name 不变）。
// 查看器侧（本文件）：GLTFLoader 每个 GLB 各有一个 parser，parser 的 sourceCache 只在单个 GLB 内去重；
// 这里在 LoadingManager 上注册 tex/ 路径的处理器，按 URL 共用一次 fetch + createImageBitmap：
//   - PNG / JPEG：处理器是一个「ImageBitmapLoader 形状」的对象（isImageBitmapLoader=true），GLTFLoader 照常为每个 GLB
//     new Texture(imageBitmap)，采样器 / flipY / colorSpace 仍由各 GLB 自己设，与内嵌时同一条路径 —— 只是位图共用；
//     createImageBitmap 参数与 GLTFLoader 自带的 ImageBitmapLoader 一致（premultiplyAlpha none、colorSpaceConversion none）。
//   - KTX2（方浜 -tc 件）：KHR_texture_basisu 走 parser.options.ktx2Loader，不经 manager 处理器；这里给 KTX2Loader.load
//     包一层按 URL 缓存的 Promise<CompressedTexture>，第二个及以后的 GLB 拿 clone()（共用 mipmaps 数据，参数各自设）。
//   - 浏览器没有 createImageBitmap 时（旧 Safari / Firefox，GLTFLoader 自己退回 TextureLoader）不注册处理器：
//     仍能加载，只是不在加载器层去重（靠 HTTP 缓存，服务端对 /out/tex/ 发 immutable 缓存头）。
// window.__sharedTex() 报告：{ requested: URL→次数, fetched: URL→次数, bytes: URL→字节 }（测试读它，「同 URL 只下载一次」）。
import * as THREE from 'three';

export const SHARED_TEX_RE = /(^|\/)tex\/[0-9a-f]{16}\.(png|jpe?g|webp|ktx2)$/i;

export function installSharedTextures({ manager = THREE.DefaultLoadingManager, ktx2Loader = null } = {}) {
  const stats = { requested: {}, fetched: {}, bytes: {} };
  const bump = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
  const bitmaps = new Map();   // url -> Promise<ImageBitmap>
  const opts = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  const canBitmap = typeof createImageBitmap !== 'undefined';

  const imageHandler = {
    isImageBitmapLoader: true,   // GLTFLoader.loadImageSource：对 ImageBitmapLoader 形状的加载器把结果包成 new Texture(bitmap)
    load(url, onLoad, onProgress, onError) {
      bump(stats.requested, url);
      let p = bitmaps.get(url);
      if (!p) {
        manager.itemStart(url);
        p = fetch(url, { credentials: 'same-origin' })
          .then(r => { if (!r.ok) throw new Error(url + ': HTTP ' + r.status); bump(stats.fetched, url); return r.blob(); })
          .then(b => { stats.bytes[url] = b.size; return createImageBitmap(b, opts); })
          .finally(() => manager.itemEnd(url));
        p.catch(() => { bitmaps.delete(url); manager.itemError(url); });
        bitmaps.set(url, p);
      }
      p.then(bm => onLoad && onLoad(bm), e => onError && onError(e));
    },
    setCrossOrigin() { return this; }, setRequestHeader() { return this; }, setPath() { return this; },
  };
  if (canBitmap) manager.addHandler(/(^|\/)tex\/[0-9a-f]{16}\.(png|jpe?g|webp)$/i, imageHandler);

  if (ktx2Loader) {
    const textures = new Map();   // url -> Promise<CompressedTexture>
    const rawLoad = ktx2Loader.load.bind(ktx2Loader);
    ktx2Loader.load = function (url, onLoad, onProgress, onError) {
      if (!SHARED_TEX_RE.test(url)) return rawLoad(url, onLoad, onProgress, onError);
      bump(stats.requested, url);
      let p = textures.get(url), first = false;
      if (!p) {
        first = true;
        p = new Promise((res, rej) => rawLoad(url, res, onProgress, rej));
        p.then(() => bump(stats.fetched, url), () => textures.delete(url));
        textures.set(url, p);
      }
      p.then(t => onLoad && onLoad(first ? t : t.clone()), e => onError && onError(e));
    };
  }
  window.__sharedTex = () => JSON.parse(JSON.stringify(stats));
  return stats;
}
