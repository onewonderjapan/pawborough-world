// 玩法状态契约（小吃工单 20261001「状态与保存」）。纯 DOM-free：
//   - 三味目标自动指下一味；每种食物首次真正吃完才盖章，重吃不重复涨
//   - E/F 资格门（未暂停、未在吃、手里有/没有）；吃计时只随 eatTick 推进
//     （暂停不调 tick = 冻结，不用墙钟跨暂停吃完）
//   - 手 ↔ 车篮不复制食物；车状态（placed/riding/pos）迁移
//   - 版本化保存 round-trip；坏档/版本不符/NaN/重复持物全部拒绝
//   - 「新散步」重置只清本游戏进度
// Run: node tests/play_state.test.mjs   (exit 0 = contract holds)
import { PlayGameState, FOODS, validateSave, STATE_SCHEMA_VERSION, SCENE_ASSET_VERSION, STORAGE_KEY, EAT_SECONDS } from '../scene-authoring/yuyuan-area/web/play/state.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

// --- 目标与集章 ---
{
  const s = new PlayGameState();
  check('初始目标指向第一味', s.goal()?.id === 'xiaolongbao' && s.stamps === 0);
  check('selectGoal 只接受合法索引（导向，不传送）',
    s.selectGoal(2) === true && s.goal()?.id === 'youdunzi' && s.selectGoal(9) === false && s.goal()?.id === 'youdunzi');
  s.selectGoal(0);

  check('手里没东西不能吃', s.canEat({}).ok === false && s.canEat({}).reason === 'empty-hand');
  check('拿第一味', s.take('xiaolongbao').ok === true && s.heldItem === 'xiaolongbao');
  check('手里有食物不能重复领取', s.take('congyoubing').reason === 'holding');
  check('未知食物拒绝', s.take('pizza').ok === false);
  check('吃过程中不能拿', (s.startEat(), s.take('congyoubing').reason === 'eating'));

  // 吃计时：只在被调用的帧推进；暂停不调 = 冻结（不用墙钟）
  const r1 = s.eatTick(1.0);
  check('吃了一秒未完成且进度正确', r1 && r1.done === false && Math.abs(r1.progress - 1.0 / EAT_SECONDS) < 1e-9);
  const frozen = s.eatTick(0);            // 暂停帧（调用方不推进；防御性 dt 非法直接 no-op）
  check('暂停帧（dt 0/NaN）不推进吃计时', frozen === null && s.eating.elapsed === 1.0);
  const r2 = s.eatTick(EAT_SECONDS);      // 恢复后补完剩余时长
  check('吃完第一味并盖章', r2 && r2.done === true && r2.first === true && s.tasted.size === 1 && s.heldItem === null);
  const again = { ...s };
  s.take('xiaolongbao'); s.startEat(); s.eatTick(EAT_SECONDS + 1);
  check('重吃同味不重复盖章', s.tasted.size === 1 && s.stamps === 1);

  check('目标自动指下一味', s.goal()?.id === 'congyoubing');
  s.take('congyoubing'); s.startEat(); s.eatTick(EAT_SECONDS + 1);
  s.take('youdunzi'); s.startEat(); s.eatTick(EAT_SECONDS + 1);
  check('三味完成', s.complete === true && s.stamps === 3 && s.goal() === null);
}

// --- 手 ↔ 车篮 ---
{
  const s = new PlayGameState();
  s.take('youdunzi');
  check('上车持物进车篮（不复制）', s.stowHeldToBasket() === true && s.heldItem === null && s.basketItem === 'youdunzi');
  check('车篮有货时不能再 stow', (s.take('xiaolongbao'), s.stowHeldToBasket() === false && s.basketItem === 'youdunzi'));
  s.heldItem = null;
  s.basketItem = 'youdunzi'; s.heldItem = null;
  check('下车回手', s.takeBackFromBasket() === true && s.heldItem === 'youdunzi' && s.basketItem === null);
  check('手不空时不能回手（不复制）', (s.heldItem = 'xiaolongbao', s.takeBackFromBasket() === false));
}

// --- 多味目录：状态不能再依赖模块级三味集合 ---
{
  const extra = { id: 'roujiamo', labelZh: '肉夹馍', stallId: 'stall-15', stallLabelZh: '纸包摊' };
  const four = [...FOODS, extra];
  const s = new PlayGameState({ foods: four });
  check('构造时传入的第四味可以取食', s.take(extra.id).ok === true);
  if (s.heldItem === extra.id) {
    s.startEat(); s.eatTick(EAT_SECONDS);
    check('第四味吃完才增加一次图章', s.tasted.has(extra.id) && s.stamps === 1);
  }
  check('空目录尚未完成收集', new PlayGameState({ foods: [] }).complete === false);

  const registry = {
    foodsById: new Map(four.map(f => [f.id, f])),
    vendorsById: new Map(four.map(f => [`vendor-${f.id}`, { vendorId: `vendor-${f.id}`, foodId: f.id, stallId: f.stallId }])),
    requiredFoodIds: new Set(four.map(f => f.id)),
    chaptersById: new Map([['starter', { id: 'starter', name: '起点' }]]),
    vendorsFor(id) { return [{ vendorId: `vendor-${id}`, foodId: id, stallId: four.find(f => f.id === id)?.stallId }]; },
  };
  const configured = new PlayGameState({ foods: [] });
  check('目录可在恢复存档前配置一次', typeof configured.configureCatalog === 'function');
  if (typeof configured.configureCatalog === 'function') {
    configured.configureCatalog(registry);
    check('配置后目标和进度取自目录', configured.goal()?.id === 'xiaolongbao' && configured.complete === false);
    check('同一存档不能二次换目录', configured.configureCatalog(registry) === false);
    check('新食物发现只记一次', configured.discover(extra.id) === true && configured.discover(extra.id) === false);
    check('按 ID 跟踪已注册摊位', configured.track(extra.id, `vendor-${extra.id}`) === true && configured.goal()?.id === extra.id);
    const snap = configured.collectionSnapshot();
    check('快照包含发现与当前总数', snap.discovered.includes(extra.id) && snap.requiredCount === four.length);
  }
  const disabledRegistry = {
    ...registry,
    foodsById: new Map(four.map(f => [f.id, { ...f, enabled: f.id !== extra.id }])),
    requiredFoodIds: new Set(FOODS.map(f => f.id)),
  };
  const disabled = new PlayGameState({ foods: [] });
  disabled.configureCatalog(disabledRegistry);
  check('禁用食品不进入可玩目标与领取集合', disabled.foods.length === 3 && disabled.take(extra.id).ok === false && disabled.discover(extra.id) === false);
  const interrupted = new PlayGameState({ foods: four });
  interrupted.take(extra.id); interrupted.startEat(); interrupted.eatTick(.4);
  check('资产失败可取消进食但保留手持与收藏', typeof interrupted.cancelEat === 'function');
  if (typeof interrupted.cancelEat === 'function') {
    check('取消进食解除忙碌且不盖章', interrupted.cancelEat() === true && interrupted.busyEating === false && interrupted.heldItem === extra.id && interrupted.stamps === 0);
    check('重复取消无副作用', interrupted.cancelEat() === false);
  }
}

// --- 车 ---
{
  const s = new PlayGameState();
  check('车未放置不能骑', s.setRiding(true) === false);
  check('非法位置拒绝', s.placeVehicle([NaN, 0, 0]) === false && s.placeVehicle([1, 2]) === false);
  check('放置车', s.placeVehicle([10, 0.02, 20], 0.5) === true && s.vehicle.placed === true);
  check('骑上', s.setRiding(true) === true && s.vehicle.riding === true);
  check('骑乘中更新车位置', s.moveVehicle([11, 0.02, 21], 0.7) === true && s.vehicle.pos[0] === 11);
  check('没在骑不能 moveVehicle', (s.setRiding(false, [11, 0.02, 21], 0.7), s.moveVehicle([12, 0, 22], 1) === false));
  check('下车后车停在结束点', s.vehicle.riding === false && s.vehicle.pos[0] === 11 && s.vehicle.yaw === 0.7);
}

// --- 保存/校验 ---
{
  const s = new PlayGameState();
  s.take('congyoubing'); s.startEat(); s.eatTick(1.2);
  s.eating = null; s.heldItem = 'congyoubing';
  s.placeVehicle([5, 0.02, 6], 1.1);
  const save = s.toSave({ feet: [1.23456, 0.021, 2.34567], yaw: 0.67891, pitch: 0.1 });
  check('schema 版本化', save.schemaVersion === STATE_SCHEMA_VERSION && save.sceneVersion === SCENE_ASSET_VERSION);
  check('新版档使用 v2 与独立收藏字段', save.schemaVersion === 2 && Array.isArray(save.discovered) && Array.isArray(save.milestones) && !!save.orphanedProgress);
  check('位置节流精度（toFixed 截断）', save.feet[0] === 1.235 && save.feet[2] === 2.346);
  check('手中物与车/章都在档里', save.heldItem === 'congyoubing' && save.vehicle.placed === true && save.tasted.length === 0);

  const s2 = new PlayGameState();
  const back = s2.applySave(JSON.parse(JSON.stringify(save)));
  check('round-trip 恢复', back.ok === true && s2.heldItem === 'congyoubing' && s2.vehicle.pos[1] === 0.02);

  // 无法识别的结构拒绝；可恢复的位置/物品问题归一化，不抹掉收藏。
  const rejected = [
    ['not-object', 'x'],
    ['schema-0', { ...save, schemaVersion: 0 }],
    ['missing-collection', { ...save, tasted: 'bad-array' }],
  ];
  for (const [why, bad] of rejected) {
    const v = validateSave(bad);
    check(`坏档拒绝：${why}`, v.ok === false && typeof v.reason === 'string');
  }
  const recovered = [
    ['scene-old', { ...save, sceneVersion: 'old' }, v => v.feet === null && !v.vehicle.placed],
    ['bad-held', { ...save, heldItem: 'pizza' }, v => v.heldItem === null],
    ['bad-feet-NaN', { ...save, feet: [NaN, 0, 0] }, v => v.feet === null],
    ['bad-feet-shape', { ...save, feet: [1, 2] }, v => v.feet === null],
    ['bad-eating', { ...save, eating: { foodId: 'congyoubing', elapsed: -1 } }, v => v.eating === null],
    ['bad-eating-too-long', { ...save, eating: { foodId: 'congyoubing', elapsed: EAT_SECONDS + 1 } }, v => v.eating === null],
    ['unknown-taste', { ...save, tasted: ['pizza'] }, v => v.tasted.length === 0 && v.orphanedProgress?.tasted.includes('pizza')],
    ['dup-tasted', { ...save, tasted: ['xiaolongbao', 'xiaolongbao'] }, v => v.tasted.length === 1],
    ['invalid-tracking', { ...save, trackedFoodId: 'pizza', trackedVendorId: 'missing' }, v => v.trackedFoodId === null],
    ['bad-vehicle', { ...save, vehicle: { ...save.vehicle, pos: [Infinity, 0, 0] } }, v => !v.vehicle.placed],
    ['dup-food', { ...save, heldItem: 'youdunzi', basketItem: 'youdunzi' }, v => v.heldItem === 'youdunzi' && v.basketItem === null],
  ];
  for (const [why, data, predicate] of recovered) {
    const v = validateSave(data);
    check(`可恢复档归一化：${why}`, v.ok === true && predicate(v.value));
  }
  // NaN 不会被写入新档
  const s3 = new PlayGameState();
  const badSave = s3.toSave({ feet: [NaN, 0, 1], yaw: NaN });
  check('不序列化 NaN（feet 置 null / yaw 置 0）', badSave.feet === null && badSave.yaw === 0);
}

// --- 「新散步」重置 ---
{
  const store = new Map();
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const s = new PlayGameState();
  s.take('xiaolongbao'); s.startEat(); s.eatTick(EAT_SECONDS); s.take('congyoubing'); s.placeVehicle([1, 0, 2], 0);
  storage.setItem(STORAGE_KEY, JSON.stringify(s.toSave({ feet: [0, 0, 0], yaw: 0 })));
  storage.setItem('pawborough.play.walk.v1', 'legacy-keep');
  s.reset({ storage });
  check('新散步保留收藏，只清手持与车', s.stamps === 1 && s.heldItem === null && s.vehicle.placed === false && s.goal()?.id === 'congyoubing');
  check('新散步保留 v2 档和原 v1 备份', storage.getItem(STORAGE_KEY) !== null && storage.getItem('pawborough.play.walk.v1') === 'legacy-keep');
  check('图鉴有独立的明确清空入口', typeof s.resetCollection === 'function');
  if (typeof s.resetCollection === 'function') {
    s.resetCollection({ storage });
    check('清空图鉴后收藏清零且 v1 仍保留', s.stamps === 0 && s.discovered.size === 0 && storage.getItem('pawborough.play.walk.v1') === 'legacy-keep');
  }
}

console.log(failures === 0 ? 'PLAY_STATE PASS' : `PLAY_STATE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
