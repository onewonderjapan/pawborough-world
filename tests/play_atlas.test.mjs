// M07: Food atlas entries & state projection unit tests
// Contract verification for atlasEntries pure projection, three-state data model, name hiding,
// 4th food flexibility, counts, and filters.
// Run: node tests/play_atlas.test.mjs
import { atlasEntries } from '../scene-authoring/yuyuan-area/web/play/atlas.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

function makeMockRegistry(extraFoods = []) {
  const baseFoods = [
    {
      id: 'xiaolongbao',
      name: '小笼包',
      labelZh: '南翔小笼包',
      chapterId: 'shanghai',
      regionLabel: '上海风味',
      description: '皮薄汁鲜的传统蒸笼小吃。',
      locationHint: '商业街 5 号摊',
      poseProfile: 'cupped',
      thumbId: null,
      enabled: true,
    },
    {
      id: 'congyoubing',
      name: '葱油饼',
      labelZh: '老上海葱油饼',
      chapterId: 'shanghai',
      regionLabel: '上海风味',
      description: '酥脆起层的现煎扁圆面饼。',
      locationHint: '商业街 6 号摊',
      poseProfile: 'cupped',
      thumbId: null,
      enabled: true,
    },
    {
      id: 'youdunzi',
      name: '油墩子',
      labelZh: '金黄油墩子',
      chapterId: 'shanghai',
      regionLabel: '上海风味',
      description: '金黄焦脆的油炸白萝卜丝饼。',
      locationHint: '商业街 10 号摊',
      poseProfile: 'cupped',
      thumbId: null,
      enabled: true,
    },
  ];

  const allFoods = [...baseFoods, ...extraFoods];
  const foodsById = new Map(allFoods.map(f => [f.id, f]));
  const chaptersById = new Map([
    ['shanghai', { id: 'shanghai', name: '上海起点' }],
    ['northwest', { id: 'northwest', name: '西北风味' }],
  ]);
  const vendorsById = new Map([
    ['v-xlb', { vendorId: 'v-xlb', foodId: 'xiaolongbao', stallId: 'stall-5' }],
    ['v-cyb', { vendorId: 'v-cyb', foodId: 'congyoubing', stallId: 'stall-6' }],
    ['v-ydz', { vendorId: 'v-ydz', foodId: 'youdunzi', stallId: 'stall-10' }],
  ]);
  const requiredFoodIds = new Set(allFoods.filter(f => f.enabled !== false).map(f => f.id));

  return {
    foodsById,
    chaptersById,
    vendorsById,
    requiredFoodIds,
    vendorsFor: (foodId) => {
      const v = vendorsById.get(`v-${foodId}`) || [...vendorsById.values()].find(v => v.foodId === foodId);
      return v ? [v] : [];
    },
    thumbnailFor: (foodId) => null,
  };
}

// ==========================================
// 1. Three-state data model & unseen name/location hiding
// ==========================================
{
  const registry = makeMockRegistry();
  // xiaolongbao is tasted, congyoubing is discovered only, youdunzi is unseen
  const snapshot = {
    catalogEdition: 'pawborough-snack-atlas-v1-shanghai',
    discovered: ['xiaolongbao', 'congyoubing'],
    tasted: ['xiaolongbao'],
    trackedFoodId: 'congyoubing',
    trackedVendorId: 'v-cyb',
    milestones: [],
    orphanedProgress: { discovered: [], tasted: [] },
  };

  const entries = atlasEntries(registry, snapshot);
  check('atlasEntries 返回数组结构', Array.isArray(entries) && entries.length === 3);

  const xlb = entries.find(e => e.id === 'xiaolongbao');
  const cyb = entries.find(e => e.id === 'congyoubing');
  const ydz = entries.find(e => e.id === 'youdunzi');

  // --- xiaolongbao (tasted) ---
  check('已品尝状态正确: tasted', xlb.status === 'tasted');
  check('已品尝食物 isTasted 为 true', xlb.isTasted === true);
  check('已品尝食物 isDiscovered 为 true', xlb.isDiscovered === true);
  check('已品尝食物展示真实名称', xlb.name === '小笼包' && xlb.displayName === '南翔小笼包');
  check('已品尝食物展示真实位置提示', xlb.locationHint === '商业街 5 号摊');
  check('已品尝食物展示真实风味地区', xlb.regionLabel === '上海风味');
  check('已品尝食物展示真实描述', xlb.description.includes('蒸笼小吃'));

  // --- congyoubing (discovered) ---
  check('仅发现状态正确: discovered', cyb.status === 'discovered');
  check('仅发现食物 isTasted 为 false', cyb.isTasted === false);
  check('仅发现食物 isDiscovered 为 true', cyb.isDiscovered === true);
  check('仅发现食物解锁真实名称', cyb.name === '葱油饼');
  check('仅发现食物解锁真实位置提示', cyb.locationHint === '商业街 6 号摊');
  check('仅发现食物解锁真实描述', cyb.description.includes('现煎扁圆面饼'));
  check('目标追踪状态正确标记', cyb.isTracked === true);

  // --- youdunzi (unseen) ---
  check('未发现状态正确: unseen', ydz.status === 'unseen');
  check('未发现食物 isTasted 为 false', ydz.isTasted === false);
  check('未发现食物 isDiscovered 为 false', ydz.isDiscovered === false);
  check('未发现食物名称被严格隐藏 (null 或 ??? 占位)', ydz.name === null && ydz.displayName === '???');
  check('未发现食物位置被严格隐藏 (null)', ydz.locationHint === null);
  check('未发现食物地区被严格隐藏 (null)', ydz.regionLabel === null);
  check('未发现食物提供探索指引提示而非具体内容', !ydz.description.includes('白萝卜丝'));
  check('未发现食物精确摊位 ID 隐藏为 null', ydz.defaultVendorId === null);
  check('未发现食物不可生成追踪目标', !ydz.isDiscovered || !ydz.defaultVendorId);
  check('已发现食物保留默认摊位 ID', cyb.defaultVendorId === 'v-cyb');
}

// ==========================================
// 2. Flexible 4th food (data-driven, no fake 24 foods)
// ==========================================
{
  const extra = [
    {
      id: 'roujiamo',
      name: '肉夹馍',
      labelZh: '腊汁肉夹馍',
      chapterId: 'northwest',
      regionLabel: '西北风味',
      description: '白吉馍夹腊汁肉，馍酥肉香。',
      locationHint: '中心广场西北角',
      poseProfile: 'wrapped',
      thumbId: null,
      enabled: true,
    },
  ];

  const registry = makeMockRegistry(extra);
  const snapshot = {
    discovered: ['roujiamo'],
    tasted: [],
    milestones: [],
    orphanedProgress: { discovered: [], tasted: [] },
  };

  const entries = atlasEntries(registry, snapshot);
  check('动态支持第 4 种小吃注入，长度变为 4', entries.length === 4);

  const rjm = entries.find(e => e.id === 'roujiamo');
  check('第 4 种小吃存在且所属章节正确', rjm && rjm.chapterId === 'northwest' && rjm.chapterTitle === '西北风味');
  check('第 4 种小吃为 discovered 状态', rjm.status === 'discovered' && rjm.name === '肉夹馍');
}

// ==========================================
// 3. Required counts and chapter statistics
// ==========================================
{
  const registry = makeMockRegistry();
  const snapshot = {
    discovered: ['xiaolongbao', 'congyoubing'],
    tasted: ['xiaolongbao'],
    milestones: [],
    orphanedProgress: { discovered: [], tasted: [] },
  };

  const entries = atlasEntries(registry, snapshot);

  check('总计条目数 total 正确', entries.counts.total === 3);
  check('已发现计数 discovered 正确', entries.counts.discovered === 2);
  check('已品尝计数 tasted 正确', entries.counts.tasted === 1);
  check('未完成计数 incomplete 正确 (total - tasted)', entries.counts.incomplete === 2);
  check('必需总数 required 正确', entries.counts.required === 3);

  // 章节统计
  check('包含章节统计列表', Array.isArray(entries.chapters) && entries.chapters.length >= 1);
  const sh = entries.chapters.find(c => c.id === 'shanghai');
  check('上海起点章节统计: 总计 3, 已发现 2, 已品尝 1',
    sh && sh.total === 3 && sh.discovered === 2 && sh.tasted === 1
  );
}

// ==========================================
// 4. Four filters: 全部 / 已发现 / 已品尝 / 未完成
// ==========================================
{
  const registry = makeMockRegistry();
  const snapshot = {
    discovered: ['xiaolongbao', 'congyoubing'],
    tasted: ['xiaolongbao'],
    milestones: [],
    orphanedProgress: { discovered: [], tasted: [] },
  };

  const entries = atlasEntries(registry, snapshot);

  // 全部
  const allList = entries.filterBy('全部');
  check('全部 筛选返回 3 项', allList.length === 3);

  // 已发现 (含已品尝)
  const discoveredList = entries.filterBy('已发现');
  check('已发现 筛选返回 2 项 (xiaolongbao, congyoubing)',
    discoveredList.length === 2 &&
    discoveredList.every(e => e.isDiscovered)
  );

  // 已品尝
  const tastedList = entries.filterBy('已品尝');
  check('已品尝 筛选返回 1 项 (xiaolongbao)',
    tastedList.length === 1 && tastedList[0].id === 'xiaolongbao'
  );

  // 未完成 (未发现 + 已发现但未品尝)
  const incompleteList = entries.filterBy('未完成');
  check('未完成 筛选返回 2 项 (congyoubing, youdunzi)',
    incompleteList.length === 2 &&
    incompleteList.every(e => !e.isTasted)
  );
}

console.log(`\nplay_atlas tests completed: failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
