// M02 存档迁移与安全持久化（snack-atlas 规格 §7/§8）。纯 JS ES module：
// 不 import DOM / Three / state.js（避免循环依赖；根常量仍是 v1，由调用方接线）。
//
//   - 版本解码与归一化只有这里一份：decodePlaySave 按 schemaVersion 分派
//     v1→migrateV1ToV2、v2→规范化，调用方不得重复迁移。
//   - 迁移原则：收藏永不丢（未知/停用收藏进 orphanedProgress，食品回归自动
//     重新归类）；位姿/车辆不安全只回安全出生点；手持未知物安全清空并提示。
//   - 持久化只写 v2，先写后读回确认，配额/不可用/读回不一致都不算保存成功，
//     绝不删除或覆盖 v1（v1 是迁移来源，长期保留）。
//   - 读取顺序：合法 v2 → 合法 v1 → null（由调用方选择安全新档）；读取本身
//     不写、不删任何 key。
export const LEGACY_STORAGE_KEY = 'pawborough.play.walk.v1';
export const STORAGE_KEY_V2 = 'pawborough.play.walk.v2';
export const SAVE_SCHEMA_VERSION = 2;

// 旧三味的原始目标顺序（state.js FOODS 的历史顺序），goalIndex 按 此映射成 ID
const LEGACY_GOAL_ORDER = ['xiaolongbao', 'congyoubing', 'youdunzi'];
const LEGACY_THREE_TASTES_MILESTONE = 'legacy-three-tastes';

const SAFE_VEHICLE = Object.freeze({ placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false });

const finite = (v) => Number.isFinite(v);
const round3 = (v) => Math.round(v * 1000) / 1000;
const round4 = (v) => Math.round(v * 10000) / 10000;

function normalizeOptions(options = {}) {
  const registry = options.registry ?? null;
  const okRegistry = !!registry
    && registry.foodsById instanceof Map
    && registry.vendorsById instanceof Map;
  const eatSeconds = finite(options.eatSeconds) && options.eatSeconds > 0 ? options.eatSeconds : 3.2;
  const editionId = options.editionId ?? registry?.editionId;
  return {
    registry,
    okRegistry,
    sceneVersion: options.sceneVersion ?? null,
    editionId: typeof editionId === 'string' && editionId ? editionId : null,
    eatSeconds,
  };
}

// 注册表语义与 catalog.js 一致：enabled !== false 视为当前可用
function isKnownFood(registry, id) {
  const food = registry.foodsById.get(id);
  return !!food && food.enabled !== false;
}

// 输入是 foodsById/vendorsById Map（不是 vendorsFor 函数），按插入序找该味首个 vendor
function firstVendorForFood(registry, foodId) {
  for (const [id, vendor] of registry.vendorsById) {
    if (vendor && vendor.foodId === foodId && vendor.enabled !== false) return vendor.vendorId ?? vendor.id ?? id;
  }
  return null;
}

// 有序去重，只保留字符串 ID；出现重复/坏条目时记 warning
function normalizeIdList(raw, warnings) {
  const out = [];
  const seen = new Set();
  let hadDup = false;
  let hadBad = false;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'string' || !entry) { hadBad = true; continue; }
      if (seen.has(entry)) { hadDup = true; continue; }
      seen.add(entry);
      out.push(entry);
    }
  }
  if (hadDup) warnings.push('duplicate-ids');
  if (hadBad) warnings.push('dropped-non-string-ids');
  return out;
}

// 把 ID 列表按当前注册表分成「当前进度」和「孤儿进度」两个桶
function splitKnownOrphan(ids, registry) {
  const known = [];
  const orphaned = [];
  for (const id of ids) (isKnownFood(registry, id) ? known : orphaned).push(id);
  return { known, orphaned };
}

function normalizeVehicle(raw, warnings) {
  const claimed = raw && typeof raw === 'object' ? raw : null;
  if (!claimed) {
    warnings.push('vehicle-reset');
    return { ...SAFE_VEHICLE };
  }
  const posValid = Array.isArray(claimed.pos) && claimed.pos.length === 3 && claimed.pos.every(finite);
  // 已放置的完整合法车辆原样保留（含骑行态）；放置/骑行/坐标任一不自洽整体回退未放置
  if (claimed.placed === true && posValid && finite(claimed.yaw)) {
    return {
      placed: true,
      pos: claimed.pos.map(round3),
      yaw: round4(claimed.yaw),
      viewYaw: finite(claimed.viewYaw) ? round4(claimed.viewYaw) : round4(claimed.yaw),
      riding: claimed.riding === true,
    };
  }
  if (claimed.placed !== true && claimed.riding === true) {
    warnings.push('vehicle-reset');
    return { ...SAFE_VEHICLE };
  }
  if (claimed.placed !== true) {
    // 未放置车辆：丢弃杂散坐标，朝向缺省为 0，不算不安全
    return { ...SAFE_VEHICLE, yaw: finite(claimed.yaw) ? round4(claimed.yaw) : 0 };
  }
  warnings.push('vehicle-reset');
  return { ...SAFE_VEHICLE };
}

// 场景不匹配 / 位姿非法：只重置位姿与车辆安全落点，收藏保留。
// 有限位姿本身合法，几何校验（墙内等）由调用方后续做。
function normalizePose(save, raw, sceneMismatch, warnings) {
  const feetOk = raw.feet === null
    || (Array.isArray(raw.feet) && raw.feet.length === 3 && raw.feet.every(finite));
  const poseBad = !feetOk;
  if (sceneMismatch) warnings.push('scene-mismatch');
  if (poseBad) warnings.push('pose-reset');
  if (sceneMismatch || poseBad) {
    save.feet = null;
    save.vehicle = { ...SAFE_VEHICLE };
    warnings.push('vehicle-reset');
  }
  save.yaw = finite(raw.yaw) ? round4(raw.yaw) : 0;
  save.pitch = finite(raw.pitch) ? round4(raw.pitch) : 0;
}

// 手持/车篮归一化：未知清空、同物只留手中一份；合法手持/车篮视为已发现
function normalizeCarry(raw, registry, warnings) {
  const pick = (value, warnCode) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') { warnings.push(warnCode); return null; }
    if (!isKnownFood(registry, value)) { warnings.push(warnCode); return null; }
    return value;
  };
  let held = pick(raw.heldItem, 'cleared-unknown-held');
  let basket = pick(raw.basketItem, 'cleared-unknown-basket');
  if (held && held === basket) {
    basket = null;
    warnings.push('cleared-duplicate-basket');
  }
  return { held, basket };
}

// 进食必须：与手持一致、elapsed 有限且 0<=elapsed<eatSeconds、不在骑行。
// 非法进食直接取消，绝不顺带发味觉。elapsed 先取整再校验，保证写读回幂等。
function normalizeEating(rawEating, held, riding, eatSeconds, warnings) {
  if (!rawEating) return null;
  if (!riding && held && rawEating && typeof rawEating === 'object'
    && rawEating.foodId === held && finite(rawEating.elapsed)) {
    const elapsed = round3(rawEating.elapsed);
    if (elapsed >= 0 && elapsed < eatSeconds) return { foodId: held, elapsed };
  }
  warnings.push('eating-cancelled');
  return null;
}

function trackedPairForFood(registry, foodId) {
  if (!foodId || !isKnownFood(registry, foodId)) return { foodId: null, vendorId: null };
  const vendorId = firstVendorForFood(registry, foodId);
  if (!vendorId) return { foodId: null, vendorId: null };
  return { foodId, vendorId };
}

// v2 已保存的追踪对整体校验：味与摊必须配对合法，否则一并清空
function normalizeTrackedV2(raw, registry, warnings) {
  if (!raw.trackedFoodId && !raw.trackedVendorId) return { foodId: null, vendorId: null };
  const vendor = registry.vendorsById.get(raw.trackedVendorId);
  if (isKnownFood(registry, raw.trackedFoodId) && vendor?.foodId === raw.trackedFoodId && vendor.enabled !== false) {
    return { foodId: raw.trackedFoodId, vendorId: raw.trackedVendorId };
  }
  warnings.push('cleared-invalid-tracking');
  return { foodId: null, vendorId: null };
}

function assembleSave({ sceneVersion, editionId, actorId, feet, yaw, pitch, held, basket, eating,
  discovered, tasted, milestones, tracked, orphaned, vehicle }) {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    sceneVersion,
    catalogEdition: editionId,
    actorId,
    feet,
    yaw,
    pitch,
    heldItem: held,
    basketItem: basket,
    eating,
    discovered,
    tasted,
    milestones,
    trackedFoodId: tracked.foodId,
    trackedVendorId: tracked.vendorId,
    orphanedProgress: { discovered: orphaned.discovered, tasted: orphaned.tasted },
    vehicle,
  };
}

// v1 → v2 迁移。结构上无法恢复（非对象 / schemaVersion≠1 / actorId 非法 /
// editionId 缺失 / 注册表不可用）返回 null；其余一律归一化出 {save, warnings}。
export function migrateV1ToV2(v1, options = {}) {
  const opts = normalizeOptions(options);
  if (!v1 || typeof v1 !== 'object' || Array.isArray(v1)) return null;
  if (v1.schemaVersion !== 1) return null;
  if (typeof v1.actorId !== 'string' || !v1.actorId) return null;
  if (!Array.isArray(v1.tasted)) return null;
  if (!opts.okRegistry || !opts.editionId) return null;

  const warnings = [];
  const registry = opts.registry;

  const tastedRaw = normalizeIdList(v1.tasted, warnings);
  const tastedSplit = splitKnownOrphan(tastedRaw, registry);

  const { held, basket } = normalizeCarry(v1, registry, warnings);

  const vehicle = normalizeVehicle(v1.vehicle, warnings);

  // 孤儿收藏桶：v1 没有 discovered 字段，孤儿 discovered 只可能为空
  const orphaned = { discovered: [], tasted: tastedSplit.orphaned };
  if (orphaned.tasted.length) warnings.push('orphaned-foods');

  const save = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    sceneVersion: opts.sceneVersion,
    catalogEdition: opts.editionId,
    actorId: v1.actorId,
    feet: Array.isArray(v1.feet) && v1.feet.length === 3 && v1.feet.every(finite)
      ? v1.feet.map(round3) : null,
    yaw: finite(v1.yaw) ? round4(v1.yaw) : 0,
    pitch: finite(v1.pitch) ? round4(v1.pitch) : 0,
    heldItem: held,
    basketItem: basket,
    eating: null,
    discovered: null,
    tasted: tastedSplit.known,
    milestones: [],
    trackedFoodId: null,
    trackedVendorId: null,
    orphanedProgress: orphaned,
    vehicle,
  };

  // 收藏：tasted ⊆ discovered；合法手持/车篮也算已发现
  const discovered = new Set(save.tasted);
  if (held) discovered.add(held);
  if (basket) discovered.add(basket);
  save.discovered = [...discovered];

  // 位姿：场景不匹配或非法位姿只重置位姿与车辆
  const sceneMismatch = v1.sceneVersion !== opts.sceneVersion;
  normalizePose(save, v1, sceneMismatch, warnings);

  // 进食：以归一化后的手持/骑行状态为准（场景重置后已下车，合法进食可恢复）
  save.eating = normalizeEating(v1.eating, save.heldItem, save.vehicle.riding, opts.eatSeconds, warnings);

  // 旧 goalIndex 按原三味顺序映射追踪；旧三味全齐盖 legacy 里程碑，不算新版完成
  const index = v1.goalIndex;
  if (Number.isInteger(index) && index >= 0 && index < LEGACY_GOAL_ORDER.length) {
    const pair = trackedPairForFood(registry, LEGACY_GOAL_ORDER[index]);
    if (pair.foodId) {
      save.trackedFoodId = pair.foodId;
      save.trackedVendorId = pair.vendorId;
    } else {
      warnings.push('goal-unmapped');
    }
  } else {
    warnings.push('goal-unmapped');
  }
  if (LEGACY_GOAL_ORDER.every((id) => tastedRaw.includes(id))) {
    save.milestones.push(LEGACY_THREE_TASTES_MILESTONE);
    warnings.push(LEGACY_THREE_TASTES_MILESTONE);
  }

  return { save, warnings: [...new Set(warnings)] };
}

// v2 规范化：与迁移同一套收藏/位姿/车辆规则；孤儿桶里的 ID 按当前注册表
// 重新归类（食品恢复启用即回到当前进度）。对规范档是幂等不动点。
function normalizeV2Save(data, opts) {
  if (typeof data.actorId !== 'string' || !data.actorId) return null;
  if (typeof data.catalogEdition !== 'string' || !data.catalogEdition) return null;
  const collections = [data.tasted, data.discovered, data.milestones, data.orphanedProgress?.tasted, data.orphanedProgress?.discovered];
  if (collections.some(list => !Array.isArray(list) || list.some(id => typeof id !== 'string' || !id))) return null;

  const warnings = [];
  const registry = opts.registry;
  if (data.catalogEdition !== opts.editionId) warnings.push('edition-changed');

  const tastedRaw = normalizeIdList(data.tasted, warnings);
  const discoveredRaw = normalizeIdList(data.discovered, warnings);
  const orphanTastedRaw = normalizeIdList(data.orphanedProgress?.tasted, warnings);
  const orphanDiscoveredRaw = normalizeIdList(data.orphanedProgress?.discovered, warnings);

  // 当前桶 + 孤儿桶合并后统一按当前注册表归类：未知收藏保留在孤儿桶
  const tastedSplit = splitKnownOrphan(normalizeIdList([...tastedRaw, ...orphanTastedRaw], warnings), registry);
  const discoveredSplit = splitKnownOrphan(normalizeIdList([...discoveredRaw, ...orphanDiscoveredRaw], warnings), registry);

  const { held, basket } = normalizeCarry(data, registry, warnings);
  const vehicle = normalizeVehicle(data.vehicle, warnings);

  const tasted = tastedSplit.known;
  const discovered = new Set([...discoveredSplit.known, ...tasted]);
  if (held) discovered.add(held);
  if (basket) discovered.add(basket);

  const orphaned = {
    discovered: discoveredSplit.orphaned,
    tasted: tastedSplit.orphaned,
  };
  if (orphaned.discovered.length || orphaned.tasted.length) warnings.push('orphaned-foods');

  const save = assembleSave({
    sceneVersion: opts.sceneVersion,
    editionId: opts.editionId,
    actorId: data.actorId,
    feet: Array.isArray(data.feet) && data.feet.length === 3 && data.feet.every(finite)
      ? data.feet.map(round3) : null,
    yaw: finite(data.yaw) ? round4(data.yaw) : 0,
    pitch: finite(data.pitch) ? round4(data.pitch) : 0,
    held,
    basket,
    eating: null,
    discovered: [...discovered],
    tasted,
    milestones: normalizeIdList(data.milestones, warnings),
    tracked: normalizeTrackedV2(data, registry, warnings),
    orphaned,
    vehicle,
  });

  const sceneMismatch = data.sceneVersion !== opts.sceneVersion;
  normalizePose(save, data, sceneMismatch, warnings);
  save.eating = normalizeEating(data.eating, save.heldItem, save.vehicle.riding, opts.eatSeconds, warnings);

  return { save, warnings: [...new Set(warnings)] };
}

// 版本解码唯一入口：接受 JSON 字符串或对象。结构/模式非法返回 null，绝不抛。
export function decodePlaySave(raw, options = {}) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const opts = normalizeOptions(options);
  if (data.schemaVersion === SAVE_SCHEMA_VERSION) {
    if (!opts.okRegistry || !opts.editionId) return null;
    return normalizeV2Save(data, opts);
  }
  if (data.schemaVersion === 1) return migrateV1ToV2(data, options);
  return null;
}

// 持久化只写 v2：先做不依赖注册表的最小规范校验（防 NaN 落盘），写后读回
// 逐字节确认。配额满 / 存储不可用 / 读回不一致都不算保存成功，不碰 v1。
export function persistPlaySave(storage, save) {
  if (!storage || typeof storage.setItem !== 'function' || typeof storage.getItem !== 'function') {
    return { ok: false, error: 'storage-unavailable' };
  }
  if (!isShallowValidV2(save)) return { ok: false, error: 'invalid-save' };
  let text;
  try {
    text = JSON.stringify(save);
    storage.setItem(STORAGE_KEY_V2, text);
    const readback = storage.getItem(STORAGE_KEY_V2);
    if (readback !== text) return { ok: false, error: 'readback-mismatch' };
    return { ok: true, error: null };
  } catch (err) {
    const name = err && err.name ? String(err.name) : '';
    const code = err && err.code;
    const quota = name.includes('Quota') || code === 22 || code === 1014;
    return { ok: false, error: quota ? 'quota-exceeded' : 'storage-unavailable' };
  }
}

// 不依赖注册表的规范 v2 最小形状校验；数值路径全部过 finite，杜绝 NaN 落盘
function isShallowValidV2(save) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) return false;
  if (save.schemaVersion !== SAVE_SCHEMA_VERSION) return false;
  if (typeof save.actorId !== 'string' || !save.actorId) return false;
  if (typeof save.catalogEdition !== 'string' || !save.catalogEdition) return false;
  if (save.feet !== null && (!Array.isArray(save.feet) || save.feet.length !== 3 || !save.feet.every(finite))) return false;
  if (!finite(save.yaw) || !finite(save.pitch)) return false;
  const foodOrNull = (v) => v === null || typeof v === 'string';
  if (!foodOrNull(save.heldItem) || !foodOrNull(save.basketItem)) return false;
  if (save.eating !== null) {
    const e = save.eating;
    if (!e || typeof e !== 'object' || !foodOrNull(e.foodId) || e.foodId === null || !finite(e.elapsed) || e.elapsed < 0) return false;
  }
  const trackOrNull = (v) => v === null || typeof v === 'string';
  if (!trackOrNull(save.trackedFoodId) || !trackOrNull(save.trackedVendorId)) return false;
  if (!Array.isArray(save.discovered) || !save.discovered.every((v) => typeof v === 'string')) return false;
  if (!Array.isArray(save.tasted) || !save.tasted.every((v) => typeof v === 'string')) return false;
  if (!Array.isArray(save.milestones) || !save.milestones.every((v) => typeof v === 'string')) return false;
  const orphaned = save.orphanedProgress;
  if (!orphaned || typeof orphaned !== 'object') return false;
  if (!Array.isArray(orphaned.discovered) || !orphaned.discovered.every((v) => typeof v === 'string')) return false;
  if (!Array.isArray(orphaned.tasted) || !orphaned.tasted.every((v) => typeof v === 'string')) return false;
  const veh = save.vehicle;
  if (!veh || typeof veh !== 'object') return false;
  if (typeof veh.placed !== 'boolean' || typeof veh.riding !== 'boolean') return false;
  if (veh.riding && !veh.placed) return false;
  if (veh.placed && (!Array.isArray(veh.pos) || veh.pos.length !== 3 || !veh.pos.every(finite))) return false;
  if (!finite(veh.yaw) || !finite(veh.viewYaw)) return false;
  if (veh.pos !== null && (!Array.isArray(veh.pos) || veh.pos.length !== 3 || !veh.pos.every(finite))) return false;
  return true;
}

// 读取顺序：合法 v2 → 合法 v1 → null。迁移标记随 v1 来源返回；读取本身
// 不写、不删任何 key，v2 损坏时 v1 仍是完整回退来源。存储故障不抛。
export function loadPlaySave(storage, options = {}) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  const attempts = [
    { key: STORAGE_KEY_V2, migrated: false },
    { key: LEGACY_STORAGE_KEY, migrated: true },
  ];
  for (const attempt of attempts) {
    let raw = null;
    try {
      raw = storage.getItem(attempt.key);
    } catch {
      raw = null;
    }
    if (raw === null || raw === undefined) continue;
    const decoded = decodePlaySave(raw, options);
    if (decoded) return { ...decoded, sourceKey: attempt.key, migrated: attempt.migrated };
  }
  return null;
}
