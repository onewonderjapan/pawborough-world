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
export const STATE_SCHEMA_VERSION = 1;
// 专用 key：不碰既有相机/项目 localStorage（fangbangMain 的 STORE_KEY 等）
export const STORAGE_KEY = 'pawborough.play.walk.v1';
// scene/asset 版本标记：食物/摊位/世界布局变化时递增，旧档按版本不符处理
export const SCENE_ASSET_VERSION = 'play-snacks-20261001';

export const EAT_SECONDS = 3.2;

// 三味与摊位（GOAL.md 建议：stall-5 蒸煮小笼包 / stall-6 烤制葱油饼 / stall-10 点心油墩子）。
// 坐标/朝向不在这里写死——stalls.js 从 out/layout.json + out/food-sockets.json 派生。
export const FOODS = [
  { id: 'xiaolongbao', labelZh: '小笼包', stallId: 'stall-5', stallLabelZh: '蒸煮小摊' },
  { id: 'congyoubing', labelZh: '葱油饼', stallId: 'stall-6', stallLabelZh: '烤饼小摊' },
  { id: 'youdunzi', labelZh: '油墩子', stallId: 'stall-10', stallLabelZh: '点心小摊' },
];

const FOOD_IDS = new Set(FOODS.map(f => f.id));
const finite = (v) => Number.isFinite(v);

export class PlayGameState {
  constructor({ foods = FOODS, actorId = 'gray-cat' } = {}) {
    this.foods = foods;
    this.actorId = actorId;
    this.playing = false;          // 已进入 play（入场/退出由 session 管，这里只镜像）
    this.paused = false;
    this.heldItem = null;          // foodId | null（手中）
    this.basketItem = null;        // foodId | null（车篮）
    this.eating = null;            // { foodId, elapsed } | null
    this.tasted = new Set();       // 已吃完的 foodId
    this.goalIndex = 0;            // 0..foods.length；=== foods.length = 三味完成
    this.vehicle = { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false };
    this._listeners = [];
  }

  // ---- 目标 ----
  get complete() { return this.tasted.size >= this.foods.length; }
  get stamps() { return this.tasted.size; }
  goal() {
    if (this.complete) return null;
    // 目标自动指下一味：当前目标未吃则保持，已吃则顺延到第一个未吃
    if (this.tasted.has(this.foods[this.goalIndex]?.id)) {
      const next = this.foods.findIndex(f => !this.tasted.has(f.id));
      if (next >= 0) this.goalIndex = next;
    }
    return this.foods[this.goalIndex] ?? null;
  }
  selectGoal(index) {              // 小地图/点击只导向，不传送
    if (!Number.isInteger(index) || index < 0 || index >= this.foods.length) return false;
    this.goalIndex = index;
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
    if (!FOOD_IDS.has(foodId)) return { ok: false, reason: 'unknown-food' };
    const gate = this.canTake({});
    if (!gate.ok) return gate;
    this.heldItem = foodId;
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
    const first = !this.tasted.has(foodId);
    if (first) {
      this.tasted.add(foodId);     // 首次真正吃完才盖章；重吃不重复涨
      this._emit({ type: 'stamped', foodId, stamps: this.tasted.size });
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
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      sceneVersion: SCENE_ASSET_VERSION,
      actorId: this.actorId,
      feet: feet && feet.every(finite) ? feet.map(v => +v.toFixed(3)) : null,
      yaw: finite(yaw) ? +yaw.toFixed(4) : 0,
      pitch: finite(pitch) ? +pitch.toFixed(4) : 0,
      heldItem: this.heldItem,
      basketItem: this.basketItem,
      eating: this.eating ? { foodId: this.eating.foodId, elapsed: +this.eating.elapsed.toFixed(3) } : null,
      tasted: [...this.tasted],
      goalIndex: this.goalIndex,
      vehicle: {
        placed: this.vehicle.placed,
        pos: this.vehicle.pos ? this.vehicle.pos.map(v => +v.toFixed(3)) : null,
        yaw: +this.vehicle.yaw.toFixed(4),
        viewYaw: finite(this.vehicle.viewYaw) ? +this.vehicle.viewYaw.toFixed(4) : +this.vehicle.yaw.toFixed(4),
        riding: this.vehicle.riding,
      },
    };
  }
  applySave(data, { storage } = {}) {
    const v = validateSave(data, this.foods);
    if (!v.ok) return v;
    const s = v.value;
    this.heldItem = s.heldItem;
    this.basketItem = s.basketItem;
    this.eating = s.eating ? { foodId: s.eating.foodId, elapsed: s.eating.elapsed } : null;
    this.tasted = new Set(s.tasted);
    this.goalIndex = s.goalIndex;
    this.vehicle = { ...s.vehicle };
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(this.toSave(s)));
    return v;
  }

  // 「新散步」重置：只清本游戏进度（章/手中/车/目标），不动世界、不动旧业务数据
  reset({ storage } = {}) {
    this.heldItem = null;
    this.basketItem = null;
    this.eating = null;
    this.tasted = new Set();
    this.goalIndex = 0;
    this.vehicle = { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false };
    if (storage) storage.removeItem(STORAGE_KEY);
    this._emit({ type: 'reset' });
  }

  onChange(cb) { this._listeners.push(cb); }
  _emit(evt) { for (const cb of this._listeners) cb(evt); }
}

// 严格校验：JSON 形状、已知枚举、数值有限。返回 {ok:true, value} | {ok:false, reason}。
export function validateSave(data, foods = FOODS) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return bad('not-object');
  if (data.schemaVersion !== STATE_SCHEMA_VERSION) return bad(`schema-${data.schemaVersion}`);
  if (data.sceneVersion !== SCENE_ASSET_VERSION) return bad(`scene-${data.sceneVersion}`);
  if (typeof data.actorId !== 'string' || !data.actorId) return bad('actorId');
  const ids = new Set(foods.map(f => f.id));
  const foodOrNull = (v) => v === null || (typeof v === 'string' && ids.has(v));
  if (!foodOrNull(data.heldItem)) return bad('heldItem');
  if (!foodOrNull(data.basketItem)) return bad('basketItem');
  for (const k of ['feet']) {
    if (data[k] !== null && (!Array.isArray(data[k]) || data[k].length !== 3 || !data[k].every(finite))) return bad(k);
  }
  if (!finite(data.yaw) || !finite(data.pitch)) return bad('yaw/pitch');
  if (data.eating !== null) {
    const e = data.eating;
    if (!e || typeof e !== 'object' || !foodOrNull(e.foodId) || e.foodId === null
      || !finite(e.elapsed) || e.elapsed < 0 || e.elapsed >= EAT_SECONDS) return bad('eating');
  }
  if (!Array.isArray(data.tasted) || data.tasted.some(t => !ids.has(t))
    || new Set(data.tasted).size !== data.tasted.length) return bad('tasted');
  if (!Number.isInteger(data.goalIndex) || data.goalIndex < 0 || data.goalIndex > foods.length) return bad('goalIndex');
  const veh = data.vehicle;
  if (!veh || typeof veh !== 'object') return bad('vehicle');
  if (typeof veh.placed !== 'boolean' || typeof veh.riding !== 'boolean') return bad('vehicle-flags');
  if (veh.placed && (!Array.isArray(veh.pos) || veh.pos.length !== 3 || !veh.pos.every(finite))) return bad('vehicle-pos');
  if (!finite(veh.yaw)) return bad('vehicle-yaw');
  if (veh.viewYaw !== undefined && !finite(veh.viewYaw)) return bad('vehicle-viewYaw');
  // 手里与车篮不重复持同一份（不复制食物）
  if (data.heldItem && data.heldItem === data.basketItem) return bad('duplicated-food');
  return { ok: true, value: data };
}
function bad(reason) { return { ok: false, reason }; }
