// 纯逻辑食品注册表与目录校验 (M01: Pure food registry)
// 无 DOM / Three / Rapier 依赖

export class CatalogError extends Error {
  constructor(fieldPath, message) {
    const desc = message ? `[${fieldPath}] ${message}` : String(fieldPath);
    super(desc);
    this.name = 'CatalogError';
    this.fieldPath = fieldPath || '';
  }
}

const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

function validateId(id, fieldPath) {
  if (typeof id !== 'string' || !id || !SAFE_ID_RE.test(id)) {
    throw new CatalogError(fieldPath, `malformed or unsafe ID: ${JSON.stringify(id)}`);
  }
}

function validatePath(p, fieldPath) {
  if (typeof p !== 'string' || !p) {
    throw new CatalogError(fieldPath, 'path must be a non-empty string');
  }
  if (p.includes('\\')) {
    throw new CatalogError(fieldPath, `path must not contain backslashes: ${p}`);
  }
  if (p.includes('..')) {
    throw new CatalogError(fieldPath, `path must not contain directory traversal '..': ${p}`);
  }
  if (p.startsWith('/') || p.startsWith('\\')) {
    throw new CatalogError(fieldPath, `path must not be an absolute path: ${p}`);
  }
  if (/^[a-zA-Z]+:/.test(p)) {
    throw new CatalogError(fieldPath, `path must not contain protocol schemes: ${p}`);
  }
}

function validateFiniteNumbers(val, fieldPath) {
  if (val === null || val === undefined) return;
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      throw new CatalogError(fieldPath, `nonfinite numeric value encountered: ${val}`);
    }
  } else if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      validateFiniteNumbers(val[i], `${fieldPath}[${i}]`);
    }
  } else if (typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      validateFiniteNumbers(v, `${fieldPath}.${k}`);
    }
  }
}

// 2D 摄影图鉴试点 (F02)：独立照片索引，仅在 manifest 显式 enabled=true 时生效。
// 照片路径必须留在私有 resources/atlas/ 下；未启用或缺失照片时完全回落到 3D asset.thumbnail。
const PHOTO_STYLE_ID = 'pawborough-food-photo-v1';
const PHOTO_SOURCE_KIND = 'generated-photographic';
const PHOTO_DIR_RE = /^(?:versions\/[a-zA-Z0-9_-]+\/)?resources\/atlas\//;
const SHA256_RE = /^[0-9a-f]{64}$/;

function buildPhotoIndex(foodsById, manifest) {
  const photosByFoodId = new Map();
  if (manifest == null) return photosByFoodId;
  if (typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new CatalogError('photoManifest', 'photo manifest must be an object');
  }
  if (manifest.enabled !== true) return photosByFoodId;
  if (manifest.styleId !== PHOTO_STYLE_ID) {
    throw new CatalogError('photoManifest.styleId', `photo styleId must be '${PHOTO_STYLE_ID}': ${JSON.stringify(manifest.styleId)}`);
  }
  const list = manifest.photos ?? [];
  if (!Array.isArray(list)) {
    throw new CatalogError('photoManifest.photos', 'photos must be an array');
  }
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const fieldPath = `photoManifest.photos[${i}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      throw new CatalogError(fieldPath, 'photo entry must be an object');
    }
    validateId(p.foodId, `${fieldPath}.foodId`);
    if (!foodsById.has(p.foodId)) {
      throw new CatalogError(`${fieldPath}.foodId`, `photo references unknown food: '${p.foodId}'`);
    }
    if (photosByFoodId.has(p.foodId)) {
      throw new CatalogError(`${fieldPath}.foodId`, `duplicate photo for food: '${p.foodId}'`);
    }
    validatePath(p.path, `${fieldPath}.path`);
    if (!PHOTO_DIR_RE.test(p.path)) {
      throw new CatalogError(`${fieldPath}.path`, `photo path must stay inside private resources/atlas/: ${p.path}`);
    }
    if (!/\.(?:png|webp)$/.test(p.path)) {
      throw new CatalogError(`${fieldPath}.path`, `photo path must reference a PNG or WebP file: ${p.path}`);
    }
    if (typeof p.sha256 !== 'string' || !SHA256_RE.test(p.sha256)) {
      throw new CatalogError(`${fieldPath}.sha256`, 'photo sha256 must be a 64-char lowercase hex string');
    }
    for (const k of ['bytes', 'width', 'height']) {
      const n = p[k];
      if (!Number.isInteger(n) || n <= 0) {
        throw new CatalogError(`${fieldPath}.${k}`, `photo ${k} must be a positive integer: ${JSON.stringify(n)}`);
      }
    }
    if (p.sourceKind !== PHOTO_SOURCE_KIND) {
      throw new CatalogError(`${fieldPath}.sourceKind`, `photo sourceKind must be '${PHOTO_SOURCE_KIND}': ${JSON.stringify(p.sourceKind)}`);
    }
    validateId(p.variant, `${fieldPath}.variant`);
    if (p.card != null) {
      validatePath(p.card.path, `${fieldPath}.card.path`);
      if (!PHOTO_DIR_RE.test(p.card.path) || !/\.(?:png|webp)$/.test(p.card.path) || !SHA256_RE.test(p.card.sha256 ?? '')) {
        throw new CatalogError(`${fieldPath}.card`, 'invalid card image path or checksum');
      }
      for (const k of ['bytes','width','height']) if (!Number.isInteger(p.card[k]) || p.card[k] <= 0) {
        throw new CatalogError(`${fieldPath}.card.${k}`, 'card dimensions and bytes must be positive integers');
      }
    }
    photosByFoodId.set(p.foodId, Object.freeze({
      foodId: p.foodId,
      path: p.path,
      sha256: p.sha256,
      bytes: p.bytes,
      width: p.width,
      height: p.height,
      sourceKind: p.sourceKind,
      styleId: manifest.styleId,
      variant: p.variant,
      card: p.card ? Object.freeze({...p.card}) : null,
    }));
  }
  return photosByFoodId;
}

function thumbnailWithPhotos(photosByFoodId, fallbackFn, foodId) {
  const photo = photosByFoodId.get(foodId);
  if (photo) return { ...photo, path: '/' + photo.path, cardPath: photo.card ? '/' + photo.card.path : null, kind: 'photo' };
  return fallbackFn(foodId);
}

/**
 * 根接线代理：在既有 registry 之上叠加独立照片索引，不改写原 registry。
 * 照片优先；3D 重建/asset.thumbnail 更新不会覆盖已启用的照片。
 */
export function attachFoodPhotographs(registry, manifest) {
  if (!registry || typeof registry !== 'object' || !(registry.foodsById instanceof Map)) {
    throw new CatalogError('registry', 'attachFoodPhotographs requires a createFoodRegistry result');
  }
  const photosByFoodId = buildPhotoIndex(registry.foodsById, manifest);
  return Object.freeze({
    ...registry,
    photosByFoodId,
    thumbnailFor: foodId => thumbnailWithPhotos(photosByFoodId, registry.thumbnailFor, foodId),
  });
}

export function createFoodRegistry({ catalog, assets = {}, vendors = {}, profiles = {}, photoManifest = null } = {}) {
  if (!catalog || typeof catalog !== 'object') {
    throw new CatalogError('catalog', 'catalog must be a valid object');
  }

  // 1. 校验与索引 Chapters
  const chaptersById = new Map();
  const chapterList = catalog.chapters ?? [];
  for (let i = 0; i < chapterList.length; i++) {
    const ch = chapterList[i];
    const fieldPath = `catalog.chapters[${i}]`;
    if (!ch || typeof ch !== 'object') {
      throw new CatalogError(fieldPath, 'chapter must be an object');
    }
    validateId(ch.id, `${fieldPath}.id`);
    if (chaptersById.has(ch.id)) {
      throw new CatalogError(`${fieldPath}.id`, `duplicate chapter ID: ${ch.id}`);
    }
    validateFiniteNumbers(ch, fieldPath);
    chaptersById.set(ch.id, Object.freeze({ ...ch }));
  }

  // 1.5 校验与索引 Regions (可选元数据)
  const regionsById = new Map();
  const regionList = catalog.regions ?? [];
  for (let i = 0; i < regionList.length; i++) {
    const r = regionList[i];
    const fieldPath = `catalog.regions[${i}]`;
    if (!r || typeof r !== 'object') {
      throw new CatalogError(fieldPath, 'region must be an object');
    }
    validateId(r.id, `${fieldPath}.id`);
    if (regionsById.has(r.id)) {
      throw new CatalogError(`${fieldPath}.id`, `duplicate region ID: ${r.id}`);
    }
    validateFiniteNumbers(r, fieldPath);
    regionsById.set(r.id, Object.freeze({ ...r }));
  }

  // 2. 校验与索引 Assets
  const assetList = Array.isArray(assets)
    ? assets
    : (assets?.foods ?? assets?.assets ?? []);
  const assetsById = new Map();
  for (let i = 0; i < assetList.length; i++) {
    const a = assetList[i];
    const fieldPath = `assets.foods[${i}]`;
    if (!a || typeof a !== 'object') {
      throw new CatalogError(fieldPath, 'asset must be an object');
    }
    validateId(a.id, `${fieldPath}.id`);
    if (assetsById.has(a.id)) {
      throw new CatalogError(`${fieldPath}.id`, `duplicate asset ID: ${a.id}`);
    }
    validatePath(a.path, `${fieldPath}.path`);
    if (a.thumbnail) validatePath(a.thumbnail.path,`${fieldPath}.thumbnail.path`);
    validateFiniteNumbers(a, fieldPath);
    assetsById.set(a.id, Object.freeze({ ...a }));
  }

  // 3. 校验与索引 Profiles
  const profileList = Array.isArray(profiles)
    ? profiles
    : (profiles?.profiles ?? []);
  const profilesById = new Map();
  for (let i = 0; i < profileList.length; i++) {
    const prof = profileList[i];
    const fieldPath = `profiles[${i}]`;
    if (!prof || typeof prof !== 'object') {
      throw new CatalogError(fieldPath, 'profile must be an object');
    }
    validateId(prof.id, `${fieldPath}.id`);
    if (profilesById.has(prof.id)) {
      throw new CatalogError(`${fieldPath}.id`, `duplicate profile ID: ${prof.id}`);
    }
    validateFiniteNumbers(prof, fieldPath);
    profilesById.set(prof.id, Object.freeze({ ...prof }));
  }

  // 4. 校验与索引 Vendors
  const vendorList = Array.isArray(vendors)
    ? vendors
    : (vendors?.vendors ?? []);
  const vendorsById = new Map();
  const vendorsByFoodId = new Map();

  for (let i = 0; i < vendorList.length; i++) {
    const v = vendorList[i];
    const fieldPath = `vendors[${i}]`;
    if (!v || typeof v !== 'object') {
      throw new CatalogError(fieldPath, 'vendor must be an object');
    }
    const vendorId = v.vendorId ?? v.id;
    validateId(vendorId, `${fieldPath}.vendorId`);
    if (vendorsById.has(vendorId)) {
      throw new CatalogError(`${fieldPath}.vendorId`, `duplicate vendor ID: ${vendorId}`);
    }
    validateId(v.foodId, `${fieldPath}.foodId`);
    validateFiniteNumbers(v, fieldPath);

    const frozenVendor = Object.freeze({ ...v, vendorId });
    vendorsById.set(vendorId, frozenVendor);

    if (!vendorsByFoodId.has(v.foodId)) {
      vendorsByFoodId.set(v.foodId, []);
    }
    vendorsByFoodId.get(v.foodId).push(frozenVendor);
  }

  // 5. 校验与索引 Foods
  const foodsList = catalog.foods ?? [];
  const foodsById = new Map();

  for (let i = 0; i < foodsList.length; i++) {
    const food = foodsList[i];
    const fieldPath = `catalog.foods[${i}]`;
    if (!food || typeof food !== 'object') {
      throw new CatalogError(fieldPath, 'food must be an object');
    }
    validateId(food.id, `${fieldPath}.id`);
    if (foodsById.has(food.id)) {
      throw new CatalogError(`${fieldPath}.id`, `duplicate food ID: ${food.id}`);
    }

    if (!chaptersById.has(food.chapterId)) {
      throw new CatalogError(`${fieldPath}.chapterId`, `missing chapter reference: '${food.chapterId}'`);
    }

    if (!assetsById.has(food.assetId)) {
      throw new CatalogError(`${fieldPath}.assetId`, `missing asset reference: '${food.assetId}'`);
    }

    if (!profilesById.has(food.poseProfile)) {
      throw new CatalogError(`${fieldPath}.poseProfile`, `missing poseProfile reference: '${food.poseProfile}'`);
    }

    if (food.thumbId != null) {
      if (typeof food.thumbId === 'string' && food.thumbId.includes('/')) {
        validatePath(food.thumbId, `${fieldPath}.thumbId`);
      } else {
        validateId(food.thumbId, `${fieldPath}.thumbId`);
      }
    }

    if (food.regionId != null) {
      validateId(food.regionId, `${fieldPath}.regionId`);
      if (catalog.regions != null && !regionsById.has(food.regionId)) {
        throw new CatalogError(`${fieldPath}.regionId`, `unknown region reference: '${food.regionId}'`);
      }
    }

    validateFiniteNumbers(food, fieldPath);

    foodsById.set(food.id, Object.freeze({
      ...food,
      labelZh: food.labelZh ?? food.name,
      regionId: food.regionId ?? null,
      enabled: food.enabled !== false,
    }));
  }

  // 6. 校验 Vendor 关联的 food 必须在已定义的 foods 中存在 (若 foods 不为空)
  for (let i = 0; i < vendorList.length; i++) {
    const v = vendorList[i];
    const fieldPath = `vendors[${i}].foodId`;
    if (!foodsById.has(v.foodId)) {
      throw new CatalogError(fieldPath, `vendor references unknown food: '${v.foodId}'`);
    }
  }

  // 7. 校验 requiredFoodIds
  const requiredList = catalog.requiredFoodIds ?? [];
  const requiredFoodIds = new Set();

  for (let i = 0; i < requiredList.length; i++) {
    const reqId = requiredList[i];
    const fieldPath = `catalog.requiredFoodIds[${i}]`;
    validateId(reqId, fieldPath);
    if (requiredFoodIds.has(reqId)) {
      throw new CatalogError(fieldPath, `duplicate required food ID: '${reqId}'`);
    }
    if (!foodsById.has(reqId)) {
      throw new CatalogError(fieldPath, `required food '${reqId}' not in catalog.foods`);
    }
    const food = foodsById.get(reqId);
    if (food.enabled === false) {
      throw new CatalogError(fieldPath, `required food '${reqId}' is disabled`);
    }
    const assignedVendors = vendorsByFoodId.get(reqId) ?? [];
    if (assignedVendors.length === 0) {
      throw new CatalogError(fieldPath, `required food '${reqId}' has no vendor`);
    }
    requiredFoodIds.add(reqId);
  }

  function vendorsFor(foodId) {
    const list = vendorsByFoodId.get(foodId);
    return list ? [...list] : [];
  }

  const photosByFoodId = buildPhotoIndex(foodsById, photoManifest);

  return Object.freeze({
    editionId: catalog.editionId,
    foodsById,
    vendorsById,
    profilesById,
    chaptersById,
    regionsById,
    requiredFoodIds,
    photosByFoodId,
    vendorsFor,
    thumbnailFor: foodId => thumbnailWithPhotos(photosByFoodId, id => {
      const food=foodsById.get(id),thumb=assetsById.get(food?.assetId)?.thumbnail;
      return thumb ? {...thumb,path:'/'+thumb.path} : null;
    }, foodId),
  });
}
