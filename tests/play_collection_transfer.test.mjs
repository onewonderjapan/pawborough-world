// M07: Collection transfer unit tests
// Contract verification for exportCollection & importCollection
// Run: node tests/play_collection_transfer.test.mjs
import assert from 'node:assert/strict';
import {
  exportCollection,
  importCollection,
  CollectionImportError,
} from '../scene-authoring/yuyuan-area/web/play/collection-transfer.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

function makeRegistry(foods = ['xiaolongbao', 'congyoubing', 'youdunzi']) {
  const foodsById = new Map();
  for (const f of foods) {
    if (typeof f === 'string') {
      foodsById.set(f, { id: f, name: f, enabled: true });
    } else {
      foodsById.set(f.id, f);
    }
  }
  return { foodsById };
}

// ==========================================
// 1. Export format and privacy (No leak of coordinates / vehicle / eating)
// ==========================================
{
  const snapshot = {
    catalogEdition: 'pawborough-snack-atlas-v1-shanghai',
    discovered: ['xiaolongbao', 'congyoubing'],
    tasted: ['xiaolongbao'],
    milestones: ['legacy-three-tastes'],
    orphanedProgress: {
      discovered: ['old-food-1'],
      tasted: ['old-food-1'],
    },
    // Extraneous simulation state that MUST NOT leak into export
    feet: [12.5, 0.0, -8.3],
    yaw: 1.57,
    pitch: 0.1,
    vehicle: { placed: true, pos: [10, 0, 10], riding: true },
    eating: { foodId: 'xiaolongbao', elapsed: 1.5 },
    heldItem: 'xiaolongbao',
    basketItem: 'congyoubing',
    actorId: 'gray-cat',
    sceneVersion: 'play-snacks-20261001',
  };

  const exported = exportCollection(snapshot);
  check('exportCollection 返回有效字符串', typeof exported === 'string');

  const parsed = JSON.parse(exported);
  check('schemaVersion 为 1', parsed.schemaVersion === 1);
  check('type 为 pawborough-food-collection', parsed.type === 'pawborough-food-collection');
  check('catalogEdition 正确', parsed.catalogEdition === 'pawborough-snack-atlas-v1-shanghai');
  check('discovered 包含已发现食物', parsed.discovered.length === 2 && parsed.discovered.includes('xiaolongbao'));
  check('tasted 包含已品尝食物', parsed.tasted.length === 1 && parsed.tasted[0] === 'xiaolongbao');
  check('milestones 包含里程碑', parsed.milestones.includes('legacy-three-tastes'));
  check('orphanedProgress 正确导出', parsed.orphanedProgress?.discovered?.includes('old-food-1'));

  // 严禁泄露游玩位姿与实体状态
  check('不包含 feet 坐标', parsed.feet === undefined);
  check('不包含 vehicle 状态', parsed.vehicle === undefined);
  check('不包含 eating 状态', parsed.eating === undefined);
  check('不包含 heldItem / basketItem', parsed.heldItem === undefined && parsed.basketItem === undefined);
  check('不包含 actorId / sceneVersion', parsed.actorId === undefined && parsed.sceneVersion === undefined);
}

// ==========================================
// 2. 64 KiB boundary enforcement
// ==========================================
{
  const reg = makeRegistry();
  const validSnapshot = {
    catalogEdition: 'pawborough-snack-atlas-v1-shanghai',
    discovered: ['xiaolongbao'],
    tasted: ['xiaolongbao'],
    milestones: [],
    orphanedProgress: { discovered: [], tasted: [] },
  };
  const validJson = exportCollection(validSnapshot);

  // Exactly at boundary
  const filler = 'a'.repeat(64 * 1024 - validJson.length - 20);
  const boundaryObj = {
    schemaVersion: 1,
    type: 'pawborough-food-collection',
    catalogEdition: 'pawborough-snack-atlas-v1-shanghai',
    discovered: ['xiaolongbao'],
    tasted: ['xiaolongbao'],
    milestones: [],
    orphanedProgress: { discovered: [], tasted: [] },
    _extraComment: '',
  };

  // Adjust exact byte count to 65536
  const baseEncoded = new TextEncoder().encode(JSON.stringify(boundaryObj));
  const diff = (64 * 1024) - baseEncoded.length;
  boundaryObj._extraComment = 'x'.repeat(diff);
  const boundaryText = JSON.stringify(boundaryObj);
  const boundaryBytes = new TextEncoder().encode(boundaryText).length;
  check('精确 64 KiB (65536 bytes) 数据构造成功', boundaryBytes === 65536);

  const res64k = importCollection(boundaryText, { registry: reg, current: validSnapshot });
  check('刚好 64 KiB 数据导入成功', res64k.collection.discovered.includes('xiaolongbao'));

  // 65537 bytes: 超过 1 字节必须拒绝
  boundaryObj._extraComment += 'y';
  const overText = JSON.stringify(boundaryObj);
  const overBytes = new TextEncoder().encode(overText).length;
  check('构造 65537 字节超出数据', overBytes === 65537);

  let overError = null;
  try {
    importCollection(overText, { registry: reg, current: validSnapshot });
  } catch (err) {
    overError = err;
  }
  check('超出 64 KiB 抛出 CollectionImportError', overError instanceof CollectionImportError);
  check('错误信息为通俗中文提示', typeof overError?.message === 'string' && overError.message.includes('64'));
}

// ==========================================
// 3. Malformed JSON / shape / ID validation & current state untouched
// ==========================================
{
  const reg = makeRegistry();
  const current = Object.freeze({
    catalogEdition: 'pawborough-snack-atlas-v1-shanghai',
    discovered: Object.freeze(['congyoubing']),
    tasted: Object.freeze(['congyoubing']),
    milestones: Object.freeze(['orig-milestone']),
    orphanedProgress: Object.freeze({
      discovered: Object.freeze(['orig-orphan']),
      tasted: Object.freeze([]),
    }),
  });

  const testCases = [
    { name: '非 JSON 损坏文本', text: '{ broken json: true' },
    { name: '顶层为数组而非对象', text: '["invalid"]' },
    { name: 'type 不匹配', text: JSON.stringify({ schemaVersion: 1, type: 'wrong-type', discovered: [], tasted: [], milestones: [] }) },
    { name: 'schemaVersion 不为 1', text: JSON.stringify({ schemaVersion: 2, type: 'pawborough-food-collection', discovered: [], tasted: [], milestones: [] }) },
    { name: 'discovered 不是数组', text: JSON.stringify({ schemaVersion: 1, type: 'pawborough-food-collection', discovered: 'not-array', tasted: [], milestones: [] }) },
    { name: 'tasted 不是数组', text: JSON.stringify({ schemaVersion: 1, type: 'pawborough-food-collection', discovered: [], tasted: 123, milestones: [] }) },
    { name: '包含非法 ID 类型（数字）', text: JSON.stringify({ schemaVersion: 1, type: 'pawborough-food-collection', discovered: [123], tasted: [], milestones: [] }) },
    { name: '包含非法 ID 字符（特殊字符）', text: JSON.stringify({ schemaVersion: 1, type: 'pawborough-food-collection', discovered: ['../../bad/path'], tasted: [], milestones: [] }) },
  ];

  for (const tc of testCases) {
    let thrown = null;
    try {
      importCollection(tc.text, { registry: reg, current });
    } catch (e) {
      thrown = e;
    }
    check(`拒绝错误格式: ${tc.name}`, thrown instanceof CollectionImportError);
  }

  // 验证 current 完全未被修改
  check('发生错误时 current 保持不变', current.discovered.length === 1 && current.discovered[0] === 'congyoubing');
}

// ==========================================
// 4. Duplicate / idempotent union & tasted implies discovered
// ==========================================
{
  const reg = makeRegistry(['xiaolongbao', 'congyoubing', 'youdunzi']);
  const current = {
    catalogEdition: 'pawborough-snack-atlas-v1-shanghai',
    discovered: ['xiaolongbao'],
    tasted: ['xiaolongbao'],
    milestones: ['m1'],
    orphanedProgress: { discovered: [], tasted: [] },
  };

  const incoming = {
    schemaVersion: 1,
    type: 'pawborough-food-collection',
    catalogEdition: 'pawborough-snack-atlas-v1-shanghai',
    // 只有 tasted 中有 congyoubing，discovered 中没有显式写
    discovered: ['xiaolongbao'],
    tasted: ['xiaolongbao', 'congyoubing'],
    milestones: ['m1', 'm2'],
    orphanedProgress: { discovered: [], tasted: [] },
  };

  const res1 = importCollection(JSON.stringify(incoming), { registry: reg, current });
  check('并集后包含两种已品尝食物', res1.collection.tasted.length === 2 && res1.collection.tasted.includes('congyoubing'));
  check('品尝推导发现: congyoubing 自动进入 discovered', res1.collection.discovered.includes('congyoubing'));
  check('里程碑正确去重合并', res1.collection.milestones.length === 2 && res1.collection.milestones.includes('m2'));

  // 重复导入幂等性
  const res2 = importCollection(JSON.stringify(incoming), { registry: reg, current: res1.collection });
  check('重复导入集合完全相同（幂等）',
    JSON.stringify(res1.collection.discovered) === JSON.stringify(res2.collection.discovered) &&
    JSON.stringify(res1.collection.tasted) === JSON.stringify(res2.collection.tasted) &&
    JSON.stringify(res1.collection.milestones) === JSON.stringify(res2.collection.milestones)
  );

  // 验证未知字段被忽略（例如导入中带有车辆或位置伪造字段）
  const hacked = {
    ...incoming,
    feet: [0, 0, 0],
    vehicle: { riding: true },
    dangerousCode: 'eval()',
  };
  const res3 = importCollection(JSON.stringify(hacked), { registry: reg, current });
  check('未知额外字段被安全忽略不导入', res3.collection.feet === undefined && res3.collection.vehicle === undefined);
}

// ==========================================
// 5. Unknown foods preserved as orphan progress & returning IDs reclassified
// ==========================================
{
  // 注册表中当前只有 xiaolongbao 和 congyoubing，没有 future-snack
  const reg1 = makeRegistry(['xiaolongbao', 'congyoubing']);
  const current = {
    catalogEdition: 'pawborough-snack-atlas-v1-shanghai',
    discovered: ['xiaolongbao'],
    tasted: ['xiaolongbao'],
    milestones: [],
    orphanedProgress: {
      discovered: ['old-retired-snack'],
      tasted: ['old-retired-snack'],
    },
  };

  const incoming = {
    schemaVersion: 1,
    type: 'pawborough-food-collection',
    catalogEdition: 'pawborough-snack-atlas-v2-preview',
    discovered: ['congyoubing', 'future-snack'],
    tasted: ['future-snack'],
    milestones: [],
    orphanedProgress: { discovered: [], tasted: [] },
  };

  const res1 = importCollection(JSON.stringify(incoming), { registry: reg1, current });
  check('未知食物 future-snack 不进入 active discovered', !res1.collection.discovered.includes('future-snack'));
  check('未知食物 future-snack 保留在 orphanedProgress.discovered', res1.collection.orphanedProgress.discovered.includes('future-snack'));
  check('未知食物 future-snack 保留在 orphanedProgress.tasted', res1.collection.orphanedProgress.tasted.includes('future-snack'));
  check('既有孤立记录 old-retired-snack 依然保留', res1.collection.orphanedProgress.discovered.includes('old-retired-snack'));
  check('警告信息包含对未知小吃的提示', res1.warnings.some(w => w.includes('future-snack')));

  // 当注册表更新，重新上线 future-snack，再次导入或合并时 reclassify 成为合法小吃
  const reg2 = makeRegistry(['xiaolongbao', 'congyoubing', 'future-snack']);
  const res2 = importCollection(JSON.stringify(incoming), { registry: reg2, current: res1.collection });
  check('再上线小吃从 orphan 重新归类到 active discovered', res2.collection.discovered.includes('future-snack'));
  check('再上线小吃从 orphan 重新归类到 active tasted', res2.collection.tasted.includes('future-snack'));
  check('再上线小吃从 orphan 列表中移除', !res2.collection.orphanedProgress.discovered.includes('future-snack'));
}

console.log(`\nplay_collection_transfer tests completed: failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
