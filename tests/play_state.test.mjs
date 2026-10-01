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
  check('位置节流精度（toFixed 截断）', save.feet[0] === 1.235 && save.feet[2] === 2.346);
  check('手中物与车/章都在档里', save.heldItem === 'congyoubing' && save.vehicle.placed === true && save.tasted.length === 0);

  const s2 = new PlayGameState();
  const back = s2.applySave(JSON.parse(JSON.stringify(save)));
  check('round-trip 恢复', back.ok === true && s2.heldItem === 'congyoubing' && s2.vehicle.pos[1] === 0.02);

  // 坏档矩阵：全部拒绝且给原因
  const cases = [
    ['not-object', 'x'],
    ['schema-0', { ...save, schemaVersion: 0 }],
    ['scene-old', { ...save, sceneVersion: 'old' }],
    ['bad-held', { ...save, heldItem: 'pizza' }],
    ['bad-feet-NaN', { ...save, feet: [NaN, 0, 0] }],
    ['bad-feet-shape', { ...save, feet: [1, 2] }],
    ['bad-eating', { ...save, eating: { foodId: 'congyoubing', elapsed: -1 } }],
    ['bad-eating-too-long', { ...save, eating: { foodId: 'congyoubing', elapsed: EAT_SECONDS + 1 } }],
    ['bad-tasted', { ...save, tasted: ['pizza'] }],
    ['dup-tasted', { ...save, tasted: ['xiaolongbao', 'xiaolongbao'] }],
    ['bad-goal', { ...save, goalIndex: 7 }],
    ['bad-vehicle', { ...save, vehicle: { ...save.vehicle, pos: [Infinity, 0, 0] } }],
    ['dup-food', { ...save, heldItem: 'youdunzi', basketItem: 'youdunzi' }],
  ];
  for (const [why, bad] of cases) {
    const v = validateSave(bad);
    check(`坏档拒绝：${why}`, v.ok === false && typeof v.reason === 'string');
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
  s.take('xiaolongbao'); s.placeVehicle([1, 0, 2], 0);
  storage.setItem(STORAGE_KEY, JSON.stringify(s.toSave({ feet: [0, 0, 0], yaw: 0 })));
  s.reset({ storage });
  check('重置清进度/手里/车', s.stamps === 0 && s.heldItem === null && s.vehicle.placed === false && s.goal()?.id === 'xiaolongbao');
  check('重置清专用 key', storage.getItem(STORAGE_KEY) === null);
}

console.log(failures === 0 ? 'PLAY_STATE PASS' : `PLAY_STATE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
