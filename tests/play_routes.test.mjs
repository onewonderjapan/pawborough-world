import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayGameState, FOODS, EAT_SECONDS } from '../scene-authoring/yuyuan-area/web/play/state.js';
import { PLAYER_ROUTES, PLAYER_ROUTES_BY_ID, ROUTE_IDS } from '../scene-authoring/yuyuan-area/web/play/player-routes.js';
import { decodePlaySave, migrateV1ToV2, persistPlaySave, loadPlaySave } from '../scene-authoring/yuyuan-area/web/play/save-migration.js';

// 基础测试用小吃池（包含路线所需全部小吃）
const ROUTE_TEST_FOODS = [
  { id: 'changfen', labelZh: '肠粉', stallId: 'stall-cf', stallLabelZh: '肠粉摊' },
  { id: 'boboji', labelZh: '钵钵鸡', stallId: 'stall-bbj', stallLabelZh: '钵钵鸡摊' },
  { id: 'xiaolongbao', labelZh: '小笼包', stallId: 'stall-5', stallLabelZh: '蒸煮小摊' },
  { id: 'roujiamo', labelZh: '肉夹馍', stallId: 'stall-15', stallLabelZh: '肉夹馍摊' },
  { id: 'naidoufu', labelZh: '奶豆腐', stallId: 'stall-ndf', stallLabelZh: '奶豆腐摊' },
  { id: 'qingbuliang', labelZh: '清补凉', stallId: 'stall-qbl', stallLabelZh: '清补凉摊' },
  { id: 'waguan-tang', labelZh: '瓦罐汤', stallId: 'stall-wgt', stallLabelZh: '瓦罐汤摊' },
  { id: 'lvrou-huoshao', labelZh: '驴肉火烧', stallId: 'stall-lrhs', stallLabelZh: '火烧摊' },
];

function createTestRegistry(foods = ROUTE_TEST_FOODS) {
  return {
    editionId: 'route-test-edition',
    foodsById: new Map(foods.map(f => [f.id, { ...f, enabled: true }])),
    vendorsById: new Map(foods.map(f => [`vendor-${f.id}`, { vendorId: `vendor-${f.id}`, foodId: f.id, enabled: true }])),
    chaptersById: new Map([['test', { id: 'test', name: '测试章节' }]]),
    vendorsFor(id) {
      return this.vendorsById.has(`vendor-${id}`) ? [this.vendorsById.get(`vendor-${id}`)] : [];
    },
  };
}

test('U08: 路线定义冻结包含三张紧凑路线', () => {
  assert.equal(PLAYER_ROUTES.length, 3);
  assert.deepEqual(ROUTE_IDS, ['taste', 'cruise', 'free']);

  const taste = PLAYER_ROUTES_BY_ID.get('taste');
  assert.equal(taste.title, '附近尝鲜');
  assert.deepEqual(taste.foods, ['changfen', 'boboji', 'xiaolongbao']);
  assert.equal(taste.badgeId, 'route-taste');

  const cruise = PLAYER_ROUTES_BY_ID.get('cruise');
  assert.equal(cruise.title, '骑车巡游');
  assert.deepEqual(cruise.foods, [
    'changfen',
    'boboji',
    'xiaolongbao',
    'roujiamo',
    'naidoufu',
    'qingbuliang',
    'waguan-tang',
    'lvrou-huoshao',
  ]);
  assert.equal(cruise.badgeId, 'route-cruise');

  const free = PLAYER_ROUTES_BY_ID.get('free');
  assert.equal(free.title, '自由收集');
  assert.equal(free.foods, null);
});

test('U08: 新玩家默认自由收集，且可随时切换路线', () => {
  const state = new PlayGameState({ foods: ROUTE_TEST_FOODS });
  assert.equal(state.currentRouteId, 'free');

  const freeStatus = state.routeStatus();
  assert.equal(freeStatus.id, 'free');
  assert.equal(freeStatus.completed, false);

  // 切换为附近尝鲜
  assert.ok(state.setRoute('taste'));
  assert.equal(state.currentRouteId, 'taste');
  assert.equal(state.goal().id, 'changfen', '第一站指向肠粉');

  const tasteStatus = state.routeStatus('taste');
  assert.equal(tasteStatus.totalStations, 3);
  assert.equal(tasteStatus.stepIndex, 0);
  assert.equal(tasteStatus.currentStation.id, 'changfen');
  assert.equal(tasteStatus.completed, false);

  // 切换为骑车巡游
  assert.ok(state.setRoute('cruise'));
  assert.equal(state.currentRouteId, 'cruise');
  assert.equal(state.goal().id, 'changfen');
  assert.equal(state.routeStatus('cruise').totalStations, 8);

  // 非法路线拒绝
  assert.equal(state.setRoute('non-existent'), false);
  assert.equal(state.currentRouteId, 'cruise');
});

test('U08: 实际进食驱动路线推进，重吃不重复推进', () => {
  const state = new PlayGameState({ foods: ROUTE_TEST_FOODS });
  state.setRoute('taste');

  // 第一站：吃肠粉
  assert.equal(state.goal().id, 'changfen');
  state.take('changfen');
  state.startEat();
  state.eatTick(EAT_SECONDS);
  assert.ok(state.tasted.has('changfen'));

  // 推进到第二站：钵钵鸡
  assert.equal(state.goal().id, 'boboji');
  let st = state.routeStatus();
  assert.equal(st.stepIndex, 1);
  assert.equal(st.currentStation.id, 'boboji');
  assert.equal(st.completed, false);

  // 重吃第一站肠粉：不重复盖章，不影响当前第二站目标
  state.take('changfen');
  state.startEat();
  const res = state.finishEat();
  assert.equal(res.first, false, '重复进食 first 应为 false');
  assert.equal(state.goal().id, 'boboji', '目标仍指向未吃的第二站');
  assert.equal(state.routeStatus().stepIndex, 1);

  // 第二站：吃钵钵鸡
  state.take('boboji');
  state.startEat();
  state.eatTick(EAT_SECONDS);
  assert.equal(state.goal().id, 'xiaolongbao');
  assert.equal(state.routeStatus().stepIndex, 2);

  // 第三站：吃小笼包，完成附近尝鲜路线并获得完成章
  state.take('xiaolongbao');
  state.startEat();
  state.eatTick(EAT_SECONDS);

  st = state.routeStatus();
  assert.equal(st.completed, true);
  assert.equal(st.stamps, 3);
  assert.ok(state.milestones.has('route-taste'), '获得附近尝鲜完成章');
  assert.equal(state.goal(), null, '路线全部完成后目标为 null');
});

test('U08: 未发现食物不泄露点位，且不可追踪 vendor', () => {
  const registry = createTestRegistry();
  const state = new PlayGameState({ foods: [] });
  state.configureCatalog(registry);

  // 未发现的食物不可 track
  assert.equal(state.discovered.has('changfen'), false);
  assert.equal(state.track('changfen', 'vendor-changfen'), false, '未发现时 track 必须拒绝');
  assert.equal(state.trackedFoodId, null);

  // 发现后才允许 track
  state.discover('changfen');
  assert.ok(state.discovered.has('changfen'));
  assert.equal(state.track('changfen', 'vendor-changfen'), true, '发现后 track 允许');
  assert.equal(state.trackedFoodId, 'changfen');
  assert.equal(state.trackedVendorId, 'vendor-changfen');
});

test('U08: 存档向下兼容：旧 v1 档迁移默认 free 路线并保留全部收藏', () => {
  const registry = createTestRegistry();
  const legacyV1 = {
    schemaVersion: 1,
    actorId: 'gray-cat',
    sceneVersion: 'test-scene',
    feet: [-150, 0, -20],
    yaw: 0,
    pitch: 0,
    heldItem: null,
    basketItem: null,
    eating: null,
    tasted: ['xiaolongbao', 'changfen'],
    goalIndex: 0,
    vehicle: { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false },
  };

  const migrated = migrateV1ToV2(legacyV1, { registry, editionId: 'route-test-edition', sceneVersion: 'test-scene' });
  assert.ok(migrated && migrated.save);
  assert.deepEqual(migrated.save.route, { id: 'free' }, '旧档迁移默认 free 路线');
  assert.ok(migrated.save.tasted.includes('xiaolongbao'));
  assert.ok(migrated.save.tasted.includes('changfen'));
});

test('U08: v2 路线字段持久化与往返恢复', () => {
  const state = new PlayGameState({ foods: ROUTE_TEST_FOODS });
  state.setRoute('taste');
  state.take('changfen');
  state.startEat();
  state.eatTick(EAT_SECONDS);

  const save = state.toSave();
  assert.deepEqual(save.route, { id: 'taste' });

  // 恢复到另一个 state
  const restored = new PlayGameState({ foods: ROUTE_TEST_FOODS });
  const result = restored.applySave(save);
  assert.ok(result.ok);
  assert.equal(restored.currentRouteId, 'taste');
  assert.equal(restored.goal().id, 'boboji');
  assert.equal(restored.routeStatus().stepIndex, 1);
});

test('U08: 坏 route 字段优雅 fallback 到 free 且绝不丢失图鉴收藏', () => {
  const registry = createTestRegistry();
  const badRouteSave = {
    schemaVersion: 2,
    actorId: 'gray-cat',
    catalogEdition: 'route-test-edition',
    sceneVersion: 'test-scene',
    feet: null,
    yaw: 0,
    pitch: 0,
    heldItem: null,
    basketItem: null,
    eating: null,
    discovered: ['changfen', 'boboji', 'xiaolongbao'],
    tasted: ['changfen'],
    milestones: [],
    trackedFoodId: null,
    trackedVendorId: null,
    orphanedProgress: { discovered: [], tasted: [] },
    vehicle: { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false },
    route: { id: 'invalid-nonexistent-route' }, // 损坏的路线配置
  };

  const decoded = decodePlaySave(badRouteSave, { registry, editionId: 'route-test-edition', sceneVersion: 'test-scene' });
  assert.ok(decoded && decoded.save);
  assert.deepEqual(decoded.save.route, { id: 'free' }, '坏路线安全回退到 free');
  assert.ok(decoded.warnings.includes('route-fallback-free'), '记录 fallback 警告');
  assert.deepEqual(decoded.save.tasted, ['changfen'], '收藏数据毫发无损');
  assert.deepEqual(decoded.save.discovered, ['changfen', 'boboji', 'xiaolongbao']);
});


test('U08: 重载后进食继续推进，旧追踪点不覆盖所选路线', () => {
  const registry = createTestRegistry();
  const state = new PlayGameState({ foods: [] });
  state.configureCatalog(registry);
  state.setRoute('taste');
  state.take('changfen'); state.startEat(); state.eatTick(EAT_SECONDS);
  const saved = state.toSave({ feet: [0, 0.02, 0], yaw: 0 });
  const restored = new PlayGameState({ foods: [] });
  restored.configureCatalog(registry);
  assert.ok(restored.applySave(saved).ok);
  assert.equal(restored.navigationGoal().id, 'boboji');
  restored.take('boboji'); restored.startEat(); restored.eatTick(EAT_SECONDS);
  assert.equal(restored.navigationGoal().id, 'xiaolongbao');
  restored.discover('roujiamo');
  assert.ok(restored.track('roujiamo', 'vendor-roujiamo'));
  assert.equal(restored.currentRouteId, 'free');
  assert.equal(restored.navigationGoal().id, 'roujiamo');
  assert.equal(restored.stamps, 2);
});
