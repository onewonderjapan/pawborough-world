// 玩法状态核心（小吃工单 20261001，GOAL.md「状态与保存」）。DOM-free：
// 唯一拥有 heldItem / eating / tasted / goalIndex / vehicle 状态；HUD 与网格
// 只展示这里的状态，不各自持有。
//
//   - 三味目标「尝遍三味」：goalIndex 指向当前目标味（ tasted 后自动指下一味），
//     每种食物首次真正吃完才盖一枚章；重吃不重复涨进度。
//   - 吃：eatTick(dt) 只在被调用的帧推进（暂停时不调 = 计时冻结），不用墙钟，
//     恢复不会跨暂停跳完。
//   - 手/车篮：手里有食物时不能重复领取；上车持物进车篮，下车回手，不复制。
//   - 保存：版本化专用 key，自动保存在动作完成/暂停时机 + 位置节流由调用方控制；
//     坏档/版本不符返回 {ok:false, reason}，调用方回安全出生点，绝不写 NaN/墙内。
import { SAVE_SCHEMA_VERSION, STORAGE_KEY_V2, LEGACY_STORAGE_KEY, decodePlaySave, persistPlaySave } from './save-migration.js';
import { PLAYER_ROUTES, PLAYER_ROUTES_BY_ID, ROUTE_IDS, getRouteDefinition } from './player-routes.js';
export const STATE_SCHEMA_VERSION = SAVE_SCHEMA_VERSION;
// 专用 key：不碰既有相机/项目 localStorage（fangbangMain 的 STORE_KEY 等）
export const STORAGE_KEY = STORAGE_KEY_V2;
export { LEGACY_STORAGE_KEY, PLAYER_ROUTES, PLAYER_ROUTES_BY_ID, ROUTE_IDS, getRouteDefinition };
// 原始世界坐标/GLB 的位姿版本。目录扩展由 catalogEdition 标记；新增摊车
// 与接缝用实际地面/碰撞校验恢复点，保留仍安全的旧散步与骑乘。
export const SCENE_ASSET_VERSION = 'play-snacks-20261001';

export const EAT_SECONDS = 3.2;
const DEFAULT_EDITION = 'legacy-three-foods';

// 三味与摊位（GOAL.md 建议：stall-5 蒸煮小笼包 / stall-6 烤制葱油饼 / stall-10 点心油墩子）。
// 坐标/朝向不在这里写死——stalls.js 从 out/layout.json + out/food-sockets.json 派生。
export const FOODS = [
  { id: 'xiaolongbao', labelZh: '小笼包', stallId: 'stall-5', stallLabelZh: '蒸煮小摊' },
  { id: 'congyoubing', labelZh: '葱油饼', stallId: 'stall-6', stallLabelZh: '烤饼小摊' },
  { id: 'youdunzi', labelZh: '油墩子', stallId: 'stall-10', stallLabelZh: '点心小摊' },
];

const finite = (v) => Number.isFinite(v);

export class PlayGameState {
  constructor({ foods = FOODS, actorId = 'gray-cat' } = {}) {
    this.foods = foods;
    this.foodIds = new Set(foods.map(f => f.id));
    this.requiredFoodIds = new Set(this.foodIds);
    this.registry = null;
    this.catalogConfigured = false;
    this.catalogEdition = DEFAULT_EDITION;
    this.actorId = actorId;
    this.playing = false;          // 已进入 play（入场/退出由 session 管，这里只镜像）
    this.paused = false;
    this.heldItem = null;          // foodId | null（手中）
    this.basketItem = null;        // foodId | null（车篮）
    this.eating = null;            // { foodId, elapsed } | null
    this.tasted = new Set();       // 已吃完的 foodId
    this.discovered = new Set();
    this.milestones = new Set();
    this.orphanedProgress = { discovered: new Set(), tasted: new Set() };
    this.goalIndex = 0;            // 0..foods.length；=== foods.length = 三味完成
    this.trackedFoodId = null;
    this.trackedVendorId = null;
    this.currentRouteId = 'free';
    this.vehicle = { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false };
    this._listeners = [];
  }

  // ---- 目标 ----
  get complete() { return this.requiredFoodIds.size > 0 && [...this.requiredFoodIds].every(id => this.tasted.has(id)); }
  get stamps() { return [...this.requiredFoodIds].filter(id => this.tasted.has(id)).length; }
  configureCatalog(registry) {
    if (this.catalogConfigured || !registry?.foodsById || typeof registry.vendorsFor !== 'function') return false;
    if (this.heldItem || this.basketItem || this.eating || this.tasted.size || this.discovered.size) return false;
    const source = [...registry.foodsById.values()].filter(food => food.enabled !== false);
    const foods = source.map(food => {
      const vendor = registry.vendorsFor(food.id)[0];
      return {
        ...food,
        labelZh: food.labelZh ?? food.name,
        stallId: food.stallId ?? vendor?.stallId ?? null,
        stallLabelZh: food.stallLabelZh ?? vendor?.labelZh ?? '寻味摊',
      };
    });
    const ids = new Set(foods.map(food => food.id));
    const required = new Set(registry.requiredFoodIds ?? ids);
    if ([...required].some(id => !ids.has(id))) return false;
    this.foods = foods;
    this.foodIds = ids;
    this.requiredFoodIds = required;
    this.registry = registry;
    this.catalogEdition = registry.editionId ?? DEFAULT_EDITION;
    this.catalogConfigured = true;
    this.goalIndex = 0;
    return true;
  }
  discover(foodId) {
    if (!this.foodIds.has(foodId) || this.discovered.has(foodId)) return false;
    this.discovered.add(foodId);
    this._emit({ type: 'discovered', foodId });
    return true;
  }
  track(foodId, vendorId) {
    if (!this.foodIds.has(foodId) || !this.registry?.vendorsById?.has(vendorId)) return false;
    if (this.registry.vendorsById.get(vendorId)?.foodId !== foodId) return false;
    // 目标与官方路线一致，已发现后可追踪；未发现食物不可生成追踪目标
    if (!this.discovered.has(foodId)) return false;
    const index = this.foods.findIndex(food => food.id === foodId);
    if (index < 0) return false;
    if (this.currentRouteId !== 'free' && this.goal()?.id !== foodId) this.setRoute('free');
    this.goalIndex = index;
    this.trackedFoodId = foodId;
    this.trackedVendorId = vendorId;
    this._emit({ type: 'tracked', foodId, vendorId });
    return true;
  }
  setRoute(routeId) {
    if (!PLAYER_ROUTES_BY_ID.has(routeId)) return false;
    this.currentRouteId = routeId;
    this.trackedFoodId = null;
    this.trackedVendorId = null;
    this._updateMilestones();
    this._emit({ type: 'route-selected', routeId });
    return true;
  }
  get currentRoute() {
    return PLAYER_ROUTES_BY_ID.get(this.currentRouteId) ?? PLAYER_ROUTES_BY_ID.get('free');
  }
  routeStatus(routeId = this.currentRouteId) {
    const route = PLAYER_ROUTES_BY_ID.get(routeId);
    if (!route) return null;
    if (route.id === 'free') {
      return {
        id: 'free',
        title: route.title,
        subtitle: route.subtitle,
        mode: route.mode,
        description: route.description,
        completed: this.complete,
        stamps: this.stamps,
        total: this.requiredFoodIds.size,
        badgeId: null,
        badgeTitle: null,
        stepIndex: -1,
        totalStations: this.requiredFoodIds.size,
        currentStation: null,
        currentFood: this.goal(),
        stations: [],
      };
    }
    const foodIds = route.foods;
    const stations = foodIds.map((id, index) => {
      const food = this.foods.find(f => f.id === id);
      const tasted = this.tasted.has(id);
      const discovered = this.discovered.has(id);
      return {
        index,
        id,
        name: food?.labelZh ?? food?.name ?? id,
        tasted,
        discovered,
      };
    });
    const tastedCount = foodIds.filter(id => this.tasted.has(id)).length;
    const completed = tastedCount === foodIds.length;
    const nextUntastedIndex = stations.findIndex(s => !s.tasted);
    const currentStation = nextUntastedIndex >= 0 ? stations[nextUntastedIndex] : null;
    const currentFood = currentStation ? (this.foods.find(f => f.id === currentStation.id) ?? { id: currentStation.id, labelZh: currentStation.name, stallLabelZh: '路线摊位' }) : null;
    return {
      id: route.id,
      title: route.title,
      subtitle: route.subtitle,
      mode: route.mode,
      description: route.description,
      completed,
      stamps: tastedCount,
      total: foodIds.length,
      badgeId: route.badgeId,
      badgeTitle: route.badgeTitle,
      stepIndex: nextUntastedIndex >= 0 ? nextUntastedIndex : foodIds.length,
      totalStations: foodIds.length,
      currentStation,
      currentFood,
      stations,
    };
  }
  collectionSnapshot() {
    return {
      discovered: [...this.discovered],
      tasted: [...this.tasted],
      stamps: this.stamps,
      requiredCount: this.requiredFoodIds.size,
      complete: this.complete,
      catalogEdition: this.catalogEdition,
      milestones: [...this.milestones],
      orphanedProgress: { discovered: [...this.orphanedProgress.discovered], tasted: [...this.orphanedProgress.tasted] },
      trackedFoodId: this.trackedFoodId,
      trackedVendorId: this.trackedVendorId,
      currentRouteId: this.currentRouteId,
    };
  }
  applyCollection(collection) {
    const lists = [collection?.discovered, collection?.tasted, collection?.milestones,
      collection?.orphanedProgress?.discovered, collection?.orphanedProgress?.tasted];
    if (lists.some(list => !Array.isArray(list) || list.some(id => typeof id !== 'string' || !id))) return bad('invalid-collection');
    const union = (current, incoming) => [...new Set([...current, ...incoming])];
    const raw = { ...this.toSave(),
      discovered: union(this.discovered, collection.discovered), tasted: union(this.tasted, collection.tasted),
      milestones: union(this.milestones, collection.milestones),
      orphanedProgress: { discovered: union(this.orphanedProgress.discovered, collection.orphanedProgress.discovered),
        tasted: union(this.orphanedProgress.tasted, collection.orphanedProgress.tasted) } };
    const v = validateSave(raw, this.foods, { registry: this.registry, catalogEdition: this.catalogEdition });
    if (!v.ok) return v;
    this.discovered = new Set(v.value.discovered);
    this.tasted = new Set(v.value.tasted);
    this.milestones = new Set(v.value.milestones);
    this.orphanedProgress = { discovered: new Set(v.value.orphanedProgress.discovered), tasted: new Set(v.value.orphanedProgress.tasted) };
    this._updateMilestones();
    this._emit({ type: 'collection-changed' });
    return { ok: true, warnings: v.warnings };
  }
  _updateMilestones() {
    for (const n of [6, 12, 24, 48]) if (this.stamps >= n) this.milestones.add(`tastes-${n}`);
    for (const [id,chapter] of this.registry?.chaptersById ?? []) {
      const foods = this.foods.filter(f => f.chapterId === id && this.requiredFoodIds.has(f.id));
      if (foods.length >= (chapter.targetCount??foods.length) && foods.length && foods.every(f => this.tasted.has(f.id))) this.milestones.add(`chapter-${id}`);
    }
    for (const route of PLAYER_ROUTES) {
      if (route.badgeId && Array.isArray(route.foods) && route.foods.length > 0) {
        if (route.foods.every(id => this.tasted.has(id))) {
          this.milestones.add(route.badgeId);
        }
      }
    }
  }
  goal() {
    if (this.currentRouteId && this.currentRouteId !== 'free') {
      const route = PLAYER_ROUTES_BY_ID.get(this.currentRouteId);
      if (route && Array.isArray(route.foods)) {
        const nextUntastedId = route.foods.find(id => !this.tasted.has(id));
        if (!nextUntastedId) return null;
        return this.foods.find(f => f.id === nextUntastedId) ?? { id: nextUntastedId, labelZh: nextUntastedId, stallLabelZh: '路线目标' };
      }
    }
    if (this.complete || !this.foods.length) return null;
    // 目标自动指下一味：当前目标未吃则保持，已吃则顺延到第一个未吃
    if (this.tasted.has(this.foods[this.goalIndex]?.id)) {
      const next = this.foods.findIndex(f => !this.tasted.has(f.id));
      if (next >= 0) this.goalIndex = next;
    }
    return this.foods[this.goalIndex] ?? null;
  }
  navigationGoal() {
    if (this.currentRouteId !== 'free') return this.goal();
    return this.foods.find(food => food.id === this.trackedFoodId) ?? this.goal();
  }
  selectGoal(index) {              // 小地图/点击只导向，不传送
    if (!Number.isInteger(index) || index < 0 || index >= this.foods.length) return false;
    this.goalIndex = index;
    this.trackedFoodId = null;
    this.trackedVendorId = null;
    return true;
  }

  // ---- 取食 / 进食 ----
  canTake({ playing = true } = {}) {
    if (!playing) return { ok: false, reason: 'not-playing' };
    if (this.paused) return { ok: false, reason: 'paused' };
    if (this.eating) return { ok: false, reason: 'eating' };
    if (this.heldItem) return { ok: false, reason: 'holding', held: this.heldItem };
    return { ok: true, reason: null };
  }
  take(foodId) {
    if (!this.foodIds.has(foodId)) return { ok: false, reason: 'unknown-food' };
    const gate = this.canTake({});
    if (!gate.ok) return gate;
    this.heldItem = foodId;
    this.discover(foodId);
    return { ok: true };
  }
  canEat({ playing = true } = {}) {
    if (!playing) return { ok: false, reason: 'not-playing' };
    if (this.paused) return { ok: false, reason: 'paused' };
    if (this.eating) return { ok: false, reason: 'already-eating' };
    if (!this.heldItem) return { ok: false, reason: 'empty-hand' };
    return { ok: true };
  }
  startEat() {
    const gate = this.canEat({});
    if (!gate.ok) return gate;
    this.eating = { foodId: this.heldItem, elapsed: 0 };
    return { ok: true, foodId: this.heldItem, duration: EAT_SECONDS };
  }
  cancelEat() {
    if (!this.eating) return false;
    const foodId = this.eating.foodId;
    this.eating = null;
    this._emit({ type: 'eating-cancelled', foodId });
    return true;
  }
  // 吃的过程中禁止移动/上车（walk.js / vehicle.js 读这个）
  get busyEating() { return !!this.eating; }
  // 只在未暂停帧推进；返回 null（未在吃）| {foodId, done}
  eatTick(dt) {
    if (!this.eating) return null;
    if (!Number.isFinite(dt) || dt <= 0) return null;
    this.eating.elapsed += dt;
    if (this.eating.elapsed >= EAT_SECONDS) return this.finishEat();
    return { foodId: this.eating.foodId, done: false, progress: this.eating.elapsed / EAT_SECONDS };
  }
  finishEat() {
    if (!this.eating) return null;
    const foodId = this.eating.foodId;
    this.eating = null;
    this.heldItem = null;          // 吃完从手中消失
    if (this.trackedFoodId === foodId) {
      this.trackedFoodId = null;
      this.trackedVendorId = null;
    }
    const first = !this.tasted.has(foodId);
    this.discover(foodId);
    if (first) {
      this.tasted.add(foodId);     // 首次真正吃完才盖章；重吃不重复涨
      this._updateMilestones();
      this._emit({ type: 'stamped', foodId, stamps: this.stamps });
    }
    this._emit({ type: 'eaten', foodId, first });
    return { foodId, done: true, first, complete: this.complete };
  }

  // ---- 手 ↔ 车篮（上车持物放篮，下车回手，不复制） ----
  stowHeldToBasket() {
    if (!this.heldItem || this.basketItem) return false;
    this.basketItem = this.heldItem;
    this.heldItem = null;
    return true;
  }
  takeBackFromBasket() {
    if (!this.basketItem || this.heldItem) return false;
    this.heldItem = this.basketItem;
    this.basketItem = null;
    return true;
  }

  // ---- 车 ----
  placeVehicle(pos, yaw = 0) {
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(finite)) return false;
    this.vehicle = { placed: true, pos: [...pos], yaw, viewYaw: this.vehicle?.viewYaw ?? yaw, riding: false };
    return true;
  }
  setVehicleView(viewYaw) {
    if (!finite(viewYaw)) return false;
    this.vehicle.viewYaw = viewYaw;
    return true;
  }
  setRiding(on, pos = null, yaw = null) {
    if (on) {
      if (!this.vehicle.placed) return false;
      this.vehicle.riding = true;
    } else {
      this.vehicle.riding = false;
      if (pos) this.vehicle.pos = [...pos];
      if (yaw !== null && finite(yaw)) this.vehicle.yaw = yaw;
    }
    return true;
  }
  moveVehicle(pos, yaw) {
    if (!this.vehicle.riding || !Array.isArray(pos) || !pos.every(finite)) return false;
    this.vehicle.pos = [...pos];
    if (yaw !== undefined && finite(yaw)) this.vehicle.yaw = yaw;
    return true;
  }

  // ---- 保存（调用方传入相机/脚点；这里只管玩法事实） ----
  toSave({ feet, yaw, pitch = 0 } = {}) {
    const registry = this.registry ?? registryForFoods(this.foods, this.catalogEdition);
    const goalId = this.navigationGoal()?.id ?? null;
    const tracked = registry.vendorsById.get(this.trackedVendorId);
    const vendor = tracked?.foodId === goalId ? tracked : [...registry.vendorsById.values()].find(v => v.foodId === goalId);
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      sceneVersion: SCENE_ASSET_VERSION,
      actorId: this.actorId,
      catalogEdition: this.catalogEdition,
      feet: feet && feet.every(finite) ? feet.map(v => +v.toFixed(3)) : null,
      yaw: finite(yaw) ? +yaw.toFixed(4) : 0,
      pitch: finite(pitch) ? +pitch.toFixed(4) : 0,
      heldItem: this.heldItem,
      basketItem: this.basketItem,
      eating: this.eating ? { foodId: this.eating.foodId, elapsed: +this.eating.elapsed.toFixed(3) } : null,
      tasted: [...this.tasted],
      discovered: [...this.discovered],
      milestones: [...this.milestones],
      orphanedProgress: { discovered: [...this.orphanedProgress.discovered], tasted: [...this.orphanedProgress.tasted] },
      trackedFoodId: goalId,
      trackedVendorId: goalId ? vendor?.vendorId ?? vendor?.id ?? null : null,
      vehicle: {
        placed: this.vehicle.placed,
        pos: this.vehicle.pos ? this.vehicle.pos.map(v => +v.toFixed(3)) : null,
        yaw: +this.vehicle.yaw.toFixed(4),
        viewYaw: finite(this.vehicle.viewYaw) ? +this.vehicle.viewYaw.toFixed(4) : +this.vehicle.yaw.toFixed(4),
        riding: this.vehicle.riding,
      },
      route: {
        id: this.currentRouteId ?? 'free',
      },
    };
  }
  applySave(data, { storage } = {}) {
    const v = validateSave(data, this.foods, { registry: this.registry, catalogEdition: this.catalogEdition });
    if (!v.ok) return v;
    const s = v.value;
    this.heldItem = s.heldItem;
    this.basketItem = s.basketItem;
    this.eating = s.eating ? { foodId: s.eating.foodId, elapsed: s.eating.elapsed } : null;
    this.tasted = new Set(s.tasted);
    this.discovered = new Set(s.discovered);
    this.milestones = new Set(s.milestones);
    this.orphanedProgress = { discovered: new Set(s.orphanedProgress.discovered), tasted: new Set(s.orphanedProgress.tasted) };
    this._updateMilestones();
    this.trackedFoodId = s.trackedFoodId;
    this.trackedVendorId = s.trackedVendorId;
    if (s.route && typeof s.route === 'object' && typeof s.route.id === 'string' && PLAYER_ROUTES_BY_ID.has(s.route.id)) {
      this.currentRouteId = s.route.id;
    } else if (typeof s.route === 'string' && PLAYER_ROUTES_BY_ID.has(s.route)) {
      this.currentRouteId = s.route;
    } else {
      this.currentRouteId = 'free';
    }
    const trackedIndex = this.foods.findIndex(f => f.id === s.trackedFoodId);
    const next = this.foods.findIndex(f => !this.tasted.has(f.id));
    this.goalIndex = trackedIndex >= 0 ? trackedIndex : next >= 0 ? next : this.foods.length;
    this.vehicle = { ...s.vehicle };
    if (storage) v.storageResult = persistPlaySave(storage, this.toSave(s));
    return v;
  }

  // 新散步只清行程；收藏与 v1 备份保留。明确清空图鉴由 resetCollection 负责。
  reset({ storage } = {}) {
    this.heldItem = null;
    this.basketItem = null;
    this.eating = null;
    this.trackedFoodId = null;
    this.trackedVendorId = null;
    this.currentRouteId = this.currentRouteId ?? 'free';
    const next = this.foods.findIndex(f => !this.tasted.has(f.id));
    this.goalIndex = next >= 0 ? next : this.foods.length;
    this.vehicle = { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false };
    const result = storage ? persistPlaySave(storage, this.toSave({ feet: null, yaw: 0 })) : { ok: true, error: null };
    this._emit({ type: 'reset', storageError: result.error });
    return result;
  }
  resetCollection({ storage } = {}) {
    this.tasted.clear();
    this.discovered.clear();
    this.milestones.clear();
    this.orphanedProgress.discovered.clear();
    this.orphanedProgress.tasted.clear();
    this.currentRouteId = 'free';
    const result = this.reset({ storage });
    this._emit({ type: 'collection-cleared' });
    return result;
  }

  onChange(cb) { this._listeners.push(cb); }
  _emit(evt) { for (const cb of this._listeners) cb(evt); }
}

// 严格校验：JSON 形状、已知枚举、数值有限。返回 {ok:true, value} | {ok:false, reason}。
export function validateSave(data, foods = FOODS, { registry = null, catalogEdition = DEFAULT_EDITION } = {}) {
  const decoded = decodePlaySave(data, { registry: registry ?? registryForFoods(foods, catalogEdition),
    sceneVersion: SCENE_ASSET_VERSION, editionId: catalogEdition, eatSeconds: EAT_SECONDS });
  return decoded ? { ok: true, value: decoded.save, warnings: decoded.warnings } : bad('invalid-save');
}
function registryForFoods(foods, editionId) {
  return { editionId, foodsById: new Map(foods.map(f => [f.id, f])),
    vendorsById: new Map(foods.map(f => [`food-vendor-${f.id}`, { vendorId: `food-vendor-${f.id}`, foodId: f.id }])) };
}
function bad(reason) { return { ok: false, reason }; }
