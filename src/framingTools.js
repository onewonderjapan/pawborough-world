// Player framing tool core (world-ten-hour 20260921, PLAN task C) — the
// DOM-free logic behind the 取景工具 panel: save / restore / import / export
// of player camera poses. Node tests drive this module directly; the page
// (src/fangbangMain.js) wires it to the real camera/controls/storage.
//
// Rules from the plan:
//   - a saved view carries ONLY schema version / dataset / position / target /
//     fov / display config — no user secrets, no identifiers
//   - validation is strict: unknown dataset, non-finite numbers, out-of-range
//     fov and malformed entries FAIL LOUD and never reach the camera/physics
//   - stores are additive: importing never overwrites existing saves (name
//     collisions get a （2） suffix); deleting requires an explicit confirmed
//     click — the tool never removes user views on its own
export const STORE_KEY = 'pawborough.fangbang.framing.v1';
export const SCHEMA_VERSION = 1;
export const FOV_MIN = 20;
export const FOV_MAX = 120;
export const NAME_MAX = 40;

export class FramingError extends Error {}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);

export function isValidViewId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

// Validate one raw view object against the CURRENT dataset. Throws
// FramingError with a player-readable reason; returns a normalized copy.
export function validateView(raw, dataset) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new FramingError('机位数据不是对象');
  if (raw.schemaVersion !== SCHEMA_VERSION)
    throw new FramingError(`schemaVersion ${JSON.stringify(raw.schemaVersion)} 不受支持（需要 ${SCHEMA_VERSION}）`);
  if (raw.dataset !== dataset)
    throw new FramingError(`机位属于其它数据集「${String(raw.dataset)}」，当前为「${dataset}」`);
  if (!isVec3(raw.position)) throw new FramingError('position 不是三个有限数值');
  if (!isVec3(raw.target)) throw new FramingError('target 不是三个有限数值');
  if (!isFiniteNumber(raw.fovDeg) || raw.fovDeg < FOV_MIN || raw.fovDeg > FOV_MAX)
    throw new FramingError(`fovDeg ${JSON.stringify(raw.fovDeg)} 超出 ${FOV_MIN}–${FOV_MAX}`);
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > NAME_MAX)
    throw new FramingError(`机位名需为 1–${NAME_MAX} 字`);
  if (raw.display != null && typeof raw.display !== 'object')
    throw new FramingError('display 配置不合法');
  if (raw.display?.clay != null && typeof raw.display.clay !== 'boolean')
    throw new FramingError('display.clay 需为布尔值');
  return {
    id: isValidViewId(raw.id) ? raw.id : null,
    name,
    dataset,
    schemaVersion: SCHEMA_VERSION,
    position: [...raw.position],
    target: [...raw.target],
    fovDeg: raw.fovDeg,
    display: { clay: raw.display?.clay === true },
    createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : null,
  };
}

// Decode a store/import payload: an envelope {views:[…]} or a bare view that
// at least LOOKS like one (schemaVersion or position present). Syntax and
// envelope problems reject the WHOLE payload (error, no partial state);
// per-entry problems are skipped and reported (good entries survive).
export function decodeStore(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new FramingError(`JSON 解析失败：${String(e.message).slice(0, 80)}`); }
  if (Array.isArray(data?.views)) return data.views;
  if (data && typeof data === 'object' && !Array.isArray(data)
    && (data.schemaVersion !== undefined || data.position !== undefined)) return [data];
  throw new FramingError('载荷需为 {views:[…]} 或单个机位对象');
}

// Validate decoded entries against the current dataset: {views, errors:[{name?, error}]}
export function loadViews(rawViews, dataset) {
  const views = []; const errors = [];
  for (const [i, raw] of rawViews.entries()) {
    try { views.push(validateView(raw, dataset)); }
    catch (e) { errors.push({ index: i, name: raw?.name ?? null, error: e.message }); }
  }
  return { views, errors };
}

export function makeViewId(now = Date.now()) {
  return `ft-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Additive add: a name collision gets a （2）/（3）… suffix, never an overwrite.
export function addView(views, view) {
  const taken = new Set(views.map((v) => v.name));
  let name = view.name; let n = 2;
  while (taken.has(name)) name = `${view.name}（${n++}）`;
  const stored = { ...view, id: view.id ?? makeViewId(), name };
  return { views: [...views, stored], view: stored };
}

// Merge an import additively; original array untouched. Returns the new list,
// what was added, and every skipped entry with its reason.
export function mergeViews(existing, rawViews, dataset) {
  let views = [...existing]; const added = []; const errors = [];
  for (const [i, raw] of rawViews.entries()) {
    try {
      const v = validateView(raw, dataset);
      const { views: next, view: stored } = addView(views, { ...v, id: null });   // fresh id, no clobber
      views = next; added.push(stored);
    } catch (e) { errors.push({ index: i, name: raw?.name ?? null, error: e.message }); }
  }
  return { views, added, errors };
}

export function removeView(views, id) {
  const next = views.filter((v) => v.id !== id);
  if (next.length === views.length) throw new FramingError(`未找到机位 ${id}`);
  return next;
}

export function findView(views, id) {
  const v = views.find((x) => x.id === id);
  if (!v) throw new FramingError('机位不存在（可能已被删除或来自其它浏览器）');
  return v;
}
