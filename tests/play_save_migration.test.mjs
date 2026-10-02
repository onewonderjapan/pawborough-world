// M02 存档迁移行为测试（先于实现编写，RED→GREEN）。
// 只测行为契约：v1→v2 迁移、解码归一化、安全持久化、读取回退。
// 不 import state.js / install.js（根常量仍是 v1，归 Codex 集成）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFoodRegistry } from '../scene-authoring/yuyuan-area/web/play/catalog.js';
import {
  LEGACY_STORAGE_KEY,
  STORAGE_KEY_V2,
  SAVE_SCHEMA_VERSION,
  migrateV1ToV2,
  decodePlaySave,
  persistPlaySave,
  loadPlaySave,
} from '../scene-authoring/yuyuan-area/web/play/save-migration.js';

const SCENE = 'play-snacks-20261001';
const EDITION = 'pawborough-snack-atlas-v1-shanghai';
const EAT_SECONDS = 3.2;

// ---- 测试用注册表（registry 是输入，不依赖 catalog.js） ----
function makeRegistry({ tanghulu = true, zongzi = false } = {}) {
  const foods = [
    { id: 'xiaolongbao', enabled: true },
    { id: 'congyoubing', enabled: true },
    { id: 'youdunzi', enabled: true },
    { id: 'tanghulu', enabled: tanghulu },
    { id: 'zongzi', enabled: zongzi },
  ];
  const foodsById = new Map(foods.map((f) => [f.id, f]));
  const vendorsById = new Map([
    ['vendor-xlb', { id: 'vendor-xlb', foodId: 'xiaolongbao', stallId: 'stall-5' }],
    ['vendor-cyb', { id: 'vendor-cyb', foodId: 'congyoubing', stallId: 'stall-6' }],
    ['vendor-ydz', { id: 'vendor-ydz', foodId: 'youdunzi', stallId: 'stall-10' }],
    ['vendor-thl', { id: 'vendor-thl', foodId: 'tanghulu', stallId: 'stall-12' }],
    ['vendor-zz', { id: 'vendor-zz', foodId: 'zongzi', stallId: 'stall-13' }],
  ]);
  const requiredFoodIds = new Set(
    ['xiaolongbao', 'congyoubing', 'youdunzi', 'tanghulu'].filter(
      (id) => foodsById.get(id).enabled !== false,
    ),
  );
  return { foodsById, vendorsById, requiredFoodIds };
}

const baseOptions = () => ({
  registry: makeRegistry(),
  sceneVersion: SCENE,
  editionId: EDITION,
  eatSeconds: EAT_SECONDS,
});

// v1 存档固定 fixture（形状对齐 state.js toSave）
function v1Save(over = {}) {
  return {
    schemaVersion: 1,
    sceneVersion: SCENE,
    actorId: 'gray-cat',
    feet: [10, 0, 20],
    yaw: 1.2,
    pitch: 0.05,
    heldItem: null,
    basketItem: null,
    eating: null,
    tasted: [],
    goalIndex: 0,
    vehicle: { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false },
    ...over,
  };
}

// v2 规范形状 fixture
function v2Save(over = {}) {
  return {
    schemaVersion: 2,
    sceneVersion: SCENE,
    catalogEdition: EDITION,
    actorId: 'gray-cat',
    feet: [1, 0, 2],
    yaw: 0.5,
    pitch: 0,
    heldItem: null,
    basketItem: null,
    eating: null,
    discovered: [],
    tasted: [],
    milestones: [],
    trackedFoodId: null,
    trackedVendorId: null,
    orphanedProgress: { discovered: [], tasted: [] },
    vehicle: { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false },
    ...over,
  };
}

// 可观测的假 storage：记录写入/删除，可注入配额、读回篡改、读取故障
class FakeStorage {
  constructor(initial = {}) {
    this.map = { ...initial };
    this.setItemCalls = [];
    this.removedKeys = [];
    this.setItemErrorName = null;
    this.readbackTransform = null;
    this.getItemThrows = false;
  }
  getItem(k) {
    if (this.getItemThrows) throw new Error('storage blocked');
    return Object.prototype.hasOwnProperty.call(this.map, k) ? this.map[k] : null;
  }
  setItem(k, v) {
    this.setItemCalls.push(k);
    if (this.setItemErrorName) {
      const e = new Error('storage failure');
      e.name = this.setItemErrorName;
      throw e;
    }
    this.map[k] = this.readbackTransform ? this.readbackTransform(String(v)) : String(v);
  }
  removeItem(k) {
    this.removedKeys.push(k);
    delete this.map[k];
  }
}

let failures = 0;
async function section(name, fn) {
  console.log(`--- ${name}`);
  try {
    await fn();
    console.log(`    ok`);
  } catch (err) {
    failures += 1;
    console.error(`    FAIL: ${err && err.message}`);
  }
}

// 1. 常量契约
await section('constants', () => {
  assert.equal(LEGACY_STORAGE_KEY, 'pawborough.play.walk.v1');
  assert.equal(STORAGE_KEY_V2, 'pawborough.play.walk.v2');
  assert.equal(SAVE_SCHEMA_VERSION, 2);
});

// 2. 旧空档迁移：规范形状完整、位姿保留、无隐含奖励
await section('migrate old empty v1', () => {
  const { save, warnings } = migrateV1ToV2(v1Save(), baseOptions());
  assert.equal(save.schemaVersion, 2);
  assert.equal(save.sceneVersion, SCENE);
  assert.equal(save.catalogEdition, EDITION);
  assert.equal(save.actorId, 'gray-cat');
  assert.deepEqual(save.feet, [10, 0, 20]);
  assert.equal(save.heldItem, null);
  assert.equal(save.basketItem, null);
  assert.equal(save.eating, null);
  assert.deepEqual(save.tasted, []);
  assert.deepEqual(save.discovered, []);
  assert.deepEqual(save.milestones, []);
  assert.deepEqual(save.orphanedProgress, { discovered: [], tasted: [] });
  assert.equal(save.vehicle.placed, false);
  // goalIndex 0 指向原第一味：当前合法即映射追踪
  assert.equal(save.trackedFoodId, 'xiaolongbao');
  assert.equal(save.trackedVendorId, 'vendor-xlb');
  assert.ok(Array.isArray(warnings));
});

// 3. 旧三味全齐：保留三章 + legacy-three-tastes，不算新版完成
await section('migrate three-complete v1', () => {
  const { save, warnings } = migrateV1ToV2(
    v1Save({ tasted: ['xiaolongbao', 'congyoubing', 'youdunzi'], goalIndex: 3 }),
    baseOptions(),
  );
  assert.deepEqual(save.tasted, ['xiaolongbao', 'congyoubing', 'youdunzi']);
  assert.deepEqual(save.discovered, ['xiaolongbao', 'congyoubing', 'youdunzi']);
  assert.deepEqual(save.milestones, ['legacy-three-tastes']);
  assert.equal(save.trackedFoodId, null); // goalIndex 3 = 旧完成，不映射追踪
  assert.ok(warnings.includes('legacy-three-tastes'));
  assert.ok(!save.milestones.includes('edition-complete'));
});

// 4. goalIndex 按原三味顺序映射追踪
await section('migrate goalIndex mapping', () => {
  const a = migrateV1ToV2(v1Save({ goalIndex: 1 }), baseOptions()).save;
  assert.equal(a.trackedFoodId, 'congyoubing');
  assert.equal(a.trackedVendorId, 'vendor-cyb');
  const b = migrateV1ToV2(v1Save({ goalIndex: 2 }), baseOptions()).save;
  assert.equal(b.trackedFoodId, 'youdunzi');
  assert.equal(b.trackedVendorId, 'vendor-ydz');
});

// 5. held/basket 也是已发现；tasted 不被手持放大
await section('held/basket imply discovered', () => {
  const { save } = migrateV1ToV2(
    v1Save({ heldItem: 'xiaolongbao', basketItem: 'youdunzi', tasted: ['xiaolongbao'] }),
    baseOptions(),
  );
  assert.equal(save.heldItem, 'xiaolongbao');
  assert.equal(save.basketItem, 'youdunzi');
  assert.deepEqual(save.tasted, ['xiaolongbao']);
  assert.deepEqual(save.discovered, ['xiaolongbao', 'youdunzi']);
});

// 6. 骑行中不能处于进食：合法骑行保留，eating 取消
await section('riding keeps vehicle, cancels eating', () => {
  const ridingVehicle = { placed: true, pos: [3, 0, 4], yaw: 0.7, viewYaw: 0.8, riding: true };
  const { save, warnings } = migrateV1ToV2(
    v1Save({
      heldItem: 'xiaolongbao',
      eating: { foodId: 'xiaolongbao', elapsed: 1 },
      vehicle: ridingVehicle,
    }),
    baseOptions(),
  );
  assert.deepEqual(save.vehicle, ridingVehicle);
  assert.equal(save.eating, null);
  assert.equal(save.heldItem, 'xiaolongbao');
  assert.deepEqual(save.tasted, []); // 不发味觉
  assert.ok(warnings.includes('eating-cancelled'));
});

// 7. 合法 eating 可恢复；错配/越界 eating 取消且不发味觉
await section('eating validity', () => {
  const ok = migrateV1ToV2(
    v1Save({ heldItem: 'xiaolongbao', eating: { foodId: 'xiaolongbao', elapsed: 1.5 } }),
    baseOptions(),
  ).save;
  assert.deepEqual(ok.eating, { foodId: 'xiaolongbao', elapsed: 1.5 });

  const mismatch = migrateV1ToV2(
    v1Save({
      heldItem: 'xiaolongbao',
      eating: { foodId: 'congyoubing', elapsed: 1 },
      tasted: [],
    }),
    baseOptions(),
  );
  assert.equal(mismatch.save.eating, null);
  assert.deepEqual(mismatch.save.tasted, []);
  assert.ok(mismatch.warnings.includes('eating-cancelled'));

  for (const elapsed of [EAT_SECONDS, -0.1, NaN]) {
    const bad = migrateV1ToV2(
      v1Save({ heldItem: 'xiaolongbao', eating: { foodId: 'xiaolongbao', elapsed } }),
      baseOptions(),
    );
    assert.equal(bad.save.eating, null, `elapsed ${elapsed} must cancel`);
  }
});

// 8. 场景不匹配：只重置位姿与车辆，收藏保留
await section('scene mismatch resets pose only', () => {
  const { save, warnings } = migrateV1ToV2(
    v1Save({
      sceneVersion: 'old-world-2026',
      tasted: ['xiaolongbao'],
      vehicle: { placed: true, pos: [3, 0, 4], yaw: 0.7, viewYaw: 0.8, riding: false },
    }),
    baseOptions(),
  );
  assert.equal(save.feet, null);
  assert.deepEqual(save.vehicle, { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false });
  assert.deepEqual(save.tasted, ['xiaolongbao']);
  assert.ok(warnings.includes('scene-mismatch'));
});

// 9. 非有限位姿：收藏保留，位姿与车辆回安全值
await section('nonfinite pose resets pose, keeps collection', () => {
  for (const feet of [[NaN, 0, 0], [1, 2], Infinity, 'x']) {
    const { save, warnings } = migrateV1ToV2(
      v1Save({
        feet,
        tasted: ['congyoubing'],
        vehicle: { placed: true, pos: [3, 0, 4], yaw: 0.7, viewYaw: 0.8, riding: false },
      }),
      baseOptions(),
    );
    assert.equal(save.feet, null, `feet ${JSON.stringify(feet)}`);
    assert.equal(save.vehicle.placed, false);
    assert.deepEqual(save.tasted, ['congyoubing']);
    assert.ok(warnings.includes('pose-reset'), `feet ${JSON.stringify(feet)}`);
  }
});

// 10. 未知/停用 ID：手持清空、收藏进 orphanedProgress
await section('unknown ids orphaned, unknown held cleared', () => {
  const { save, warnings } = migrateV1ToV2(
    v1Save({
      heldItem: 'ghost-snack',
      tasted: ['xiaolongbao', 'zongzi'],
      goalIndex: 0,
    }),
    baseOptions(), // zongzi 在注册表中停用
  );
  assert.equal(save.heldItem, null);
  assert.deepEqual(save.tasted, ['xiaolongbao']);
  assert.deepEqual(save.discovered, ['xiaolongbao']);
  assert.deepEqual(save.orphanedProgress, { discovered: [], tasted: ['zongzi'] });
  assert.ok(warnings.includes('cleared-unknown-held'));
  assert.ok(warnings.includes('orphaned-foods'));
  assert.equal(save.trackedFoodId, 'xiaolongbao'); // 当前合法目标仍映射
});

// 11. 重复 ID：集合去重；手持车篮同物只留一份
await section('duplicates normalized', () => {
  const { save, warnings } = migrateV1ToV2(
    v1Save({
      tasted: ['xiaolongbao', 'xiaolongbao', 'youdunzi'],
      heldItem: 'congyoubing',
      basketItem: 'congyoubing',
    }),
    baseOptions(),
  );
  assert.deepEqual(save.tasted, ['xiaolongbao', 'youdunzi']);
  assert.equal(save.heldItem, 'congyoubing');
  assert.equal(save.basketItem, null);
  assert.ok(warnings.includes('cleared-duplicate-basket'));
  assert.ok(warnings.includes('duplicate-ids'));
});

// 12. 非法结构：null 且不抛
await section('invalid schema/json -> null', () => {
  const opt = baseOptions();
  assert.equal(decodePlaySave('not-json{', opt), null);
  assert.equal(decodePlaySave('[1,2,3]', opt), null);
  assert.equal(decodePlaySave(null, opt), null);
  assert.equal(decodePlaySave(42, opt), null);
  assert.equal(decodePlaySave(v1Save({ schemaVersion: 99 }), opt), null);
  assert.equal(decodePlaySave(v1Save({ actorId: 42 }), opt), null);
  assert.equal(migrateV1ToV2(null, opt), null);
  assert.equal(migrateV1ToV2('[]', opt), null);
});

// 13. 字符串与对象等价解码（v1/v2 两路）
await section('decode accepts string or object', () => {
  const opt = baseOptions();
  const v1 = v1Save({ tasted: ['xiaolongbao'] });
  const fromObj = decodePlaySave(v1, opt);
  const fromStr = decodePlaySave(JSON.stringify(v1), opt);
  assert.deepEqual(fromObj.save, fromStr.save);

  const v2 = v2Save({ tasted: ['youdunzi'], discovered: ['youdunzi'] });
  assert.deepEqual(decodePlaySave(v2, opt).save, decodePlaySave(JSON.stringify(v2), opt).save);
  assert.equal(decodePlaySave(v2, opt).save.schemaVersion, 2);
});

// 14. 归档孤儿味复用：食品恢复后重新归类为当前进度
await section('orphan reclassifies when food returns', () => {
  const opt = baseOptions();
  const v2 = v2Save({
    tasted: ['xiaolongbao'],
    discovered: ['xiaolongbao'],
    orphanedProgress: { discovered: [], tasted: ['zongzi'] },
  });
  const before = decodePlaySave(v2, opt).save;
  assert.deepEqual(before.tasted, ['xiaolongbao']);
  assert.deepEqual(before.orphanedProgress.tasted, ['zongzi']);

  const enabledRegistry = makeRegistry({ zongzi: true });
  const after = decodePlaySave(v2, { ...opt, registry: enabledRegistry }).save;
  assert.deepEqual(after.tasted, ['xiaolongbao', 'zongzi']);
  assert.deepEqual(after.orphanedProgress, { discovered: [], tasted: [] });
});

// 15. v2 规范化解码：无隐含奖励、idempotent fixpoint
await section('v2 decode normalization is a fixpoint', () => {
  const opt = baseOptions();
  const v2 = v2Save({
    tasted: ['xiaolongbao', 'congyoubing', 'xiaolongbao'],
    discovered: ['xiaolongbao'],
    heldItem: 'youdunzi',
    milestones: ['legacy-three-tastes'],
    trackedFoodId: 'congyoubing',
    trackedVendorId: 'vendor-cyb',
  });
  const first = decodePlaySave(v2, opt);
  assert.deepEqual(first.save.tasted, ['xiaolongbao', 'congyoubing']);
  assert.ok(first.save.discovered.includes('youdunzi'));
  assert.deepEqual(first.save.milestones, ['legacy-three-tastes']); // 不追加
  const second = decodePlaySave(first.save, opt);
  assert.deepEqual(second.save, first.save);
  assert.deepEqual(second.warnings, []);
});

// 16. 车辆不安全：回退未放置
await section('unsafe vehicle falls back to unplaced', () => {
  const cases = [
    { placed: true, pos: [NaN, 0, 4], yaw: 0, viewYaw: 0, riding: false },
    { placed: true, pos: null, yaw: 0, viewYaw: 0, riding: false },
    { placed: false, pos: [1, 1, 1], yaw: NaN, viewYaw: 0, riding: true },
    null,
  ];
  for (const vehicle of cases) {
    const { save, warnings } = migrateV1ToV2(v1Save({ vehicle }), baseOptions());
    assert.deepEqual(
      save.vehicle,
      { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false },
      JSON.stringify(vehicle),
    );
    assert.ok(warnings.includes('vehicle-reset'), JSON.stringify(vehicle));
  }
});

// 17. 幂等：同一 v1 迁移两次结果一致
await section('migration idempotent', () => {
  const opt = baseOptions();
  const v1 = v1Save({
    tasted: ['xiaolongbao', 'congyoubing', 'youdunzi'],
    goalIndex: 3,
    heldItem: 'tanghulu',
  });
  const a = migrateV1ToV2(v1, opt);
  const b = migrateV1ToV2(v1, opt);
  assert.deepEqual(a.save, b.save);
  assert.deepEqual(a.warnings, b.warnings);
});

// 18. persist：写 v2、读回一致、v1 不动
await section('persist writes v2, readback, preserves v1', () => {
  const opt = baseOptions();
  const { save } = migrateV1ToV2(v1Save({ tasted: ['xiaolongbao'] }), opt);
  const storage = new FakeStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1Save()) });
  const result = persistPlaySave(storage, save);
  assert.deepEqual(result, { ok: true, error: null });
  assert.deepEqual(storage.setItemCalls, [STORAGE_KEY_V2]); // 只写 v2
  assert.deepEqual(storage.removedKeys, []); // 不删任何 key
  assert.ok(JSON.parse(storage.map[LEGACY_STORAGE_KEY]).schemaVersion === 1);

  const loaded = loadPlaySave(storage, opt);
  assert.equal(loaded.sourceKey, STORAGE_KEY_V2);
  assert.equal(loaded.migrated, false);
  assert.deepEqual(loaded.save, save);
});

// 19. persist 拒绝会写出 NaN 的形状
await section('persist rejects invalid canonical shape', () => {
  const storage = new FakeStorage();
  assert.deepEqual(
    persistPlaySave(storage, v2Save({ yaw: NaN })),
    { ok: false, error: 'invalid-save' },
  );
  assert.deepEqual(
    persistPlaySave(storage, v2Save({ schemaVersion: 1 })),
    { ok: false, error: 'invalid-save' },
  );
  assert.deepEqual(
    persistPlaySave(storage, null),
    { ok: false, error: 'invalid-save' },
  );
  assert.deepEqual(storage.setItemCalls, []);
});

// 20. 配额 / 不可用 / 读回不一致故障
await section('persist storage faults', () => {
  const opt = baseOptions();
  const { save } = migrateV1ToV2(v1Save({ tasted: ['xiaolongbao'] }), opt);

  const quota = new FakeStorage();
  quota.setItemErrorName = 'QuotaExceededError';
  assert.deepEqual(persistPlaySave(quota, save), { ok: false, error: 'quota-exceeded' });

  const blocked = new FakeStorage();
  blocked.setItemErrorName = 'SecurityError';
  assert.deepEqual(persistPlaySave(blocked, save), { ok: false, error: 'storage-unavailable' });

  const tamper = new FakeStorage();
  tamper.readbackTransform = (v) => v + 'tampered';
  assert.deepEqual(persistPlaySave(tamper, save), { ok: false, error: 'readback-mismatch' });
});

// 21. 损坏 v2 回退有效 v1；读取不改写不删 key
await section('load falls back to v1, never mutates storage', () => {
  const opt = baseOptions();
  const legacy = JSON.stringify(v1Save({ tasted: ['youdunzi'], goalIndex: 2 }));
  const storage = new FakeStorage({
    [STORAGE_KEY_V2]: '{"schemaVersion":2,broken',
    [LEGACY_STORAGE_KEY]: legacy,
  });
  const loaded = loadPlaySave(storage, opt);
  assert.ok(loaded, 'must fall back');
  assert.equal(loaded.sourceKey, LEGACY_STORAGE_KEY);
  assert.equal(loaded.migrated, true);
  assert.deepEqual(loaded.save.tasted, ['youdunzi']);
  assert.equal(loaded.save.trackedFoodId, 'youdunzi');
  assert.deepEqual(storage.removedKeys, []);
  assert.deepEqual(storage.setItemCalls, []); // 读取本身不写
});

// 22. v2 优先；两者都无效返回 null；storage 故障不抛
await section('load preference and null paths', () => {
  const opt = baseOptions();
  const v2 = JSON.stringify(v2Save({ tasted: ['tanghulu'], discovered: ['tanghulu'] }));
  const prefer = loadPlaySave(
    new FakeStorage({ [STORAGE_KEY_V2]: v2, [LEGACY_STORAGE_KEY]: '{"schemaVersion":1,{' }),
    opt,
  );
  assert.equal(prefer.sourceKey, STORAGE_KEY_V2);
  assert.equal(prefer.migrated, false);
  assert.deepEqual(prefer.save.tasted, ['tanghulu']);

  assert.equal(loadPlaySave(new FakeStorage(), opt), null);
  assert.equal(
    loadPlaySave(
      new FakeStorage({ [STORAGE_KEY_V2]: 'junk', [LEGACY_STORAGE_KEY]: 'also-junk' }),
      opt,
    ),
    null,
  );
  const broken = new FakeStorage();
  broken.getItemThrows = true;
  assert.equal(loadPlaySave(broken, opt), null);
  assert.equal(loadPlaySave(null, opt), null);
});

// 23. 迁移→持久化→读取 全链路稳定（刷新等价）
await section('full roundtrip stable', () => {
  const opt = baseOptions();
  const v1 = v1Save({
    tasted: ['xiaolongbao', 'congyoubing', 'youdunzi'],
    goalIndex: 3,
    heldItem: 'tanghulu',
    vehicle: { placed: true, pos: [5, 0, 6], yaw: 1, viewYaw: 1, riding: false },
  });
  const first = migrateV1ToV2(v1, opt);
  const storage = new FakeStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1) });
  assert.ok(persistPlaySave(storage, first.save).ok);
  const reloaded = loadPlaySave(storage, opt);
  assert.deepEqual(reloaded.save, first.save);
  assert.ok(persistPlaySave(storage, reloaded.save).ok);
  const again = loadPlaySave(storage, opt);
  assert.deepEqual(again.save, first.save); // 二次迁移/读回不追加奖励
  assert.deepEqual(again.save.milestones, ['legacy-three-tastes']);
});

await section('real registry exposes edition and migrates canonical vendorId', () => {
  const read = name => JSON.parse(readFileSync(new URL(`../scene-authoring/yuyuan-area/inputs/${name}`, import.meta.url), 'utf8'));
  const catalog = read('food-catalog.json');
  const registry = createFoodRegistry({ catalog, assets: read('play-foods.json'), vendors: read('play-vendors.json'), profiles: read('food-pose-profiles.json') });
  assert.equal(registry.editionId, catalog.editionId);
  const migrated = migrateV1ToV2(v1Save(), { registry, sceneVersion: SCENE, editionId: catalog.editionId });
  assert.equal(migrated.save.trackedFoodId, 'xiaolongbao');
  assert.equal(migrated.save.trackedVendorId, 'food-vendor-xiaolongbao');
});

await section('edition default comes from registry', () => {
  const result = migrateV1ToV2(v1Save(), { registry: { ...makeRegistry(), editionId: EDITION }, sceneVersion: SCENE });
  assert.equal(result?.save.catalogEdition, EDITION);
});

await section('partial v2 must not mask intact v1 collection', () => {
  const partial = { schemaVersion: 2, actorId: 'gray-cat', catalogEdition: EDITION };
  const old = v1Save({ tasted: ['xiaolongbao', 'congyoubing', 'youdunzi'] });
  const result = loadPlaySave(new FakeStorage({ [STORAGE_KEY_V2]: JSON.stringify(partial), [LEGACY_STORAGE_KEY]: JSON.stringify(old) }), baseOptions());
  assert.equal(result.sourceKey, LEGACY_STORAGE_KEY);
  assert.deepEqual(result.save.tasted, old.tasted);
});

await section('malformed v2 collection elements fall back to intact v1', () => {
  const old = v1Save({ tasted: ['xiaolongbao', 'congyoubing', 'youdunzi'] });
  const bad = v2Save({ tasted: [null, null, null], discovered: [null, null, null] });
  const result = loadPlaySave(new FakeStorage({ [STORAGE_KEY_V2]: JSON.stringify(bad), [LEGACY_STORAGE_KEY]: JSON.stringify(old) }), baseOptions());
  assert.equal(result.sourceKey, LEGACY_STORAGE_KEY);
  assert.deepEqual(result.save.tasted, old.tasted);
});

await section('current and orphan progress merge as a unique set', () => {
  const result = decodePlaySave(v2Save({ tasted: ['xiaolongbao'], discovered: ['xiaolongbao'], orphanedProgress: { tasted: ['xiaolongbao'], discovered: ['xiaolongbao'] } }), baseOptions());
  assert.deepEqual(result.save.tasted, ['xiaolongbao']);
  assert.deepEqual(result.save.discovered, ['xiaolongbao']);
});

await section('any valid vendor for a tracked food survives refresh', () => {
  const options = baseOptions();
  options.registry.vendorsById.set('second-xlb', { vendorId: 'second-xlb', foodId: 'xiaolongbao' });
  const result = decodePlaySave(v2Save({ trackedFoodId: 'xiaolongbao', trackedVendorId: 'second-xlb' }), options);
  assert.equal(result.save.trackedVendorId, 'second-xlb');
});

await section('edition refresh updates metadata while retaining collection', () => {
  const result = decodePlaySave(v2Save({ tasted: ['xiaolongbao'], discovered: ['xiaolongbao'] }), { ...baseOptions(), editionId: 'next-edition' });
  assert.equal(result.save.catalogEdition, 'next-edition');
  assert.deepEqual(result.save.tasted, ['xiaolongbao']);
});

await section('inconsistent canonical vehicle is rejected before storage', () => {
  const storage = new FakeStorage();
  assert.equal(persistPlaySave(storage, v2Save({ vehicle: { placed: true, pos: null, yaw: 0, viewYaw: 0, riding: true } })).ok, false);
  assert.deepEqual(storage.setItemCalls, []);
});

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} SECTION(S) FAILED`);
if (failures > 0) process.exitCode = 1;
