// 玩法食品注册表契约测试 (M01: Pure food registry & first edition data)
// Run: node tests/play_food_registry.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFoodRegistry, CatalogError } from '../scene-authoring/yuyuan-area/web/play/catalog.js';
import { PlayGameState } from '../scene-authoring/yuyuan-area/web/play/state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

// 载入初版 JSON 清单辅助函数
function loadFirstEditionInputs() {
  const catalogPath = path.join(rootDir, 'scene-authoring/yuyuan-area/inputs/food-catalog.json');
  const assetsPath = path.join(rootDir, 'scene-authoring/yuyuan-area/inputs/play-foods.json');
  const vendorsPath = path.join(rootDir, 'scene-authoring/yuyuan-area/inputs/play-vendors.json');
  const profilesPath = path.join(rootDir, 'scene-authoring/yuyuan-area/inputs/food-pose-profiles.json');

  return {
    catalog: JSON.parse(fs.readFileSync(catalogPath, 'utf8')),
    assets: JSON.parse(fs.readFileSync(assetsPath, 'utf8')),
    vendors: JSON.parse(fs.readFileSync(vendorsPath, 'utf8')),
    profiles: JSON.parse(fs.readFileSync(profilesPath, 'utf8')),
  };
}

// 辅助：深拷贝
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ==========================================
// 1. 初版清单统计与引用契约 (First edition counts)
// ==========================================
{
  const inputs = loadFirstEditionInputs();
  const reg = createFoodRegistry(inputs);

  check('初版只激活现有 3 种上海小吃', reg.foodsById.size === 3);
  check('拥有对应 3 处摊位', reg.vendorsById.size === 3);
  check('拥有 4 种进食动作 profile (cupped/wrapped/skewer/bowl)', reg.profilesById.size === 4);
  check('requiredFoodIds 包含 3 种必需食物', reg.requiredFoodIds.size === 3 || reg.requiredFoodIds.length === 3);

  const reqSet = new Set(reg.requiredFoodIds);
  check('必需食物包含 xiaolongbao', reqSet.has('xiaolongbao'));
  check('必需食物包含 congyoubing', reqSet.has('congyoubing'));
  check('必需食物包含 youdunzi', reqSet.has('youdunzi'));

  // 验证与现有 stall-5 / stall-6 / stall-10 对应
  const vXlb = reg.vendorsFor('xiaolongbao');
  const vCyb = reg.vendorsFor('congyoubing');
  const vYdz = reg.vendorsFor('youdunzi');
  check('xiaolongbao 对应 stall-5', vXlb.length > 0 && vXlb[0].stallId === 'stall-5');
  check('congyoubing 对应 stall-6', vCyb.length > 0 && vCyb[0].stallId === 'stall-6');
  check('youdunzi 对应 stall-10', vYdz.length > 0 && vYdz[0].stallId === 'stall-10');

  // 验证缩略图在 M05 之前为 null
  const allThumbsNull = [...reg.foodsById.values()].every(f => f.thumbId === null);
  check('初版缩略图 thumbId 均为 null', allThumbsNull);

  // 验证动作 profiles 模板状态
  const pCupped = reg.profilesById.get('cupped');
  const pWrapped = reg.profilesById.get('wrapped');
  const pSkewer = reg.profilesById.get('skewer');
  const pBowl = reg.profilesById.get('bowl');
  check('4 种 profile 全部存在', !!(pCupped && pWrapped && pSkewer && pBowl));
  check('wrapped/skewer/bowl 为 interface_template',
    pWrapped?.status === 'interface_template' &&
    pSkewer?.status === 'interface_template' &&
    pBowl?.status === 'interface_template'
  );

  // 验证注册表 immutable-ish 特性
  check('注册表根对象为只读', Object.isFrozen(reg));
}

// ==========================================
// 2. 注入第四味合法食物 (Fourth valid food)
// ==========================================
{
  const inputs = loadFirstEditionInputs();
  const c = clone(inputs.catalog);
  const a = clone(inputs.assets);
  const v = clone(inputs.vendors);
  const p = clone(inputs.profiles);

  // 注入肉夹馍
  c.foods.push({
    id: 'roujiamo',
    name: '肉夹馍',
    chapterId: 'shanghai',
    regionLabel: '陕西风味',
    description: '白吉馍夹腊汁肉，馍酥肉香。',
    locationHint: '商业街 15 号摊',
    poseProfile: 'wrapped',
    assetId: 'roujiamo',
    thumbId: null,
    enabled: true,
  });
  c.requiredFoodIds.push('roujiamo');

  const foodAssets = a.foods ?? a;
  foodAssets.push({
    id: 'roujiamo',
    labelZh: '肉夹馍',
    stallId: 'stall-15',
    path: 'resources/foods/handheld/roujiamo.glb',
    bytes: 45678,
    sha256: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
  });

  const vendorList = v.vendors ?? v;
  vendorList.push({
    vendorId: 'food-vendor-roujiamo',
    foodId: 'roujiamo',
    kind: 'existing',
    stallId: 'stall-15',
    labelZh: '肉夹馍摊',
  });

  const reg = createFoodRegistry({ catalog: c, assets: a, vendors: v, profiles: p });
  check('注入第四味成功且 foodsById 计数为 4', reg.foodsById.size === 4 && reg.foodsById.has('roujiamo'));
  check('vendorsFor("roujiamo") 能够查到对应 vendor', reg.vendorsFor('roujiamo').length === 1 && reg.vendorsFor('roujiamo')[0].stallId === 'stall-15');

  // 与 PlayGameState 兼容性集成测试
  const s = new PlayGameState({ foods: [] });
  const confOk = s.configureCatalog(reg);
  check('注入第四味的注册表可成功驱动 PlayGameState', confOk === true);
  check('第四味可被 take 与 discover', s.take('roujiamo').ok === true && s.discovered.has('roujiamo'));
}

// ==========================================
// 3. 重复 ID 拒绝 (Duplicate ID)
// ==========================================
{
  const inputs = loadFirstEditionInputs();

  // 重复 chapter ID
  {
    const c = clone(inputs.catalog);
    c.chapters.push({ id: 'shanghai', name: '上海起点2' });
    let err = null;
    try {
      createFoodRegistry({ ...inputs, catalog: c });
    } catch (e) {
      err = e;
    }
    check('重复 chapter ID 抛 CatalogError', err instanceof CatalogError);
    check('错误指示 duplicate chapter 字段路径', err?.fieldPath?.includes('chapters'));
  }

  // 重复 food ID
  {
    const c = clone(inputs.catalog);
    c.foods.push(clone(c.foods[0]));
    let err = null;
    try {
      createFoodRegistry({ ...inputs, catalog: c });
    } catch (e) {
      err = e;
    }
    check('重复 food ID 抛 CatalogError', err instanceof CatalogError);
    check('错误指示 duplicate food 字段路径', err?.fieldPath?.includes('foods'));
  }

  // 重复 vendor ID
  {
    const v = clone(inputs.vendors);
    const list = v.vendors ?? v;
    list.push(clone(list[0]));
    let err = null;
    try {
      createFoodRegistry({ ...inputs, vendors: v });
    } catch (e) {
      err = e;
    }
    check('重复 vendor ID 抛 CatalogError', err instanceof CatalogError);
    check('错误指示 duplicate vendor 字段路径', err?.fieldPath?.includes('vendors'));
  }

  // 重复 profile ID
  {
    const p = clone(inputs.profiles);
    const list = p.profiles ?? p;
    list.push(clone(list[0]));
    let err = null;
    try {
      createFoodRegistry({ ...inputs, profiles: p });
    } catch (e) {
      err = e;
    }
    check('重复 profile ID 抛 CatalogError', err instanceof CatalogError);
    check('错误指示 duplicate profile 字段路径', err?.fieldPath?.includes('profiles'));
  }
}

// ==========================================
// 4. 缺失引用拒绝 (Missing asset/vendor/profile/chapter)
// ==========================================
{
  const inputs = loadFirstEditionInputs();

  // 字段完全缺失也必须失败，不能绕过跨表校验后进入线上必需目录。
  for (const field of ['chapterId', 'assetId', 'poseProfile']) {
    const c = clone(inputs.catalog);
    delete c.foods[0][field];
    let err = null;
    try { createFoodRegistry({ ...inputs, catalog: c }); } catch (e) { err = e; }
    check(`必需食品缺少 ${field} 字段拒绝`, err instanceof CatalogError && err.fieldPath?.includes(field));
  }
  {
    const a = clone(inputs.assets);
    delete a.foods[0].path;
    let err = null;
    try { createFoodRegistry({ ...inputs, assets: a }); } catch (e) { err = e; }
    check('被引用的模型无文件路径拒绝', err instanceof CatalogError && err.fieldPath?.includes('path'));
  }
  {
    const c = clone(inputs.catalog);
    c.requiredFoodIds.push(c.requiredFoodIds[0]);
    let err = null;
    try { createFoodRegistry({ ...inputs, catalog: c }); } catch (e) { err = e; }
    check('必需食品 ID 重复拒绝', err instanceof CatalogError && err.fieldPath?.includes('requiredFoodIds'));
  }

  // 缺失 chapter
  {
    const c = clone(inputs.catalog);
    c.foods[0].chapterId = 'nonexistent-chapter';
    let err = null;
    try {
      createFoodRegistry({ ...inputs, catalog: c });
    } catch (e) {
      err = e;
    }
    check('缺失 chapter 抛 CatalogError', err instanceof CatalogError);
    check('错误指出缺失 chapter 字段路径', err?.fieldPath?.includes('chapterId'));
  }

  // 缺失 asset
  {
    const c = clone(inputs.catalog);
    c.foods[0].assetId = 'nonexistent-asset';
    let err = null;
    try {
      createFoodRegistry({ ...inputs, catalog: c });
    } catch (e) {
      err = e;
    }
    check('缺失 asset 抛 CatalogError', err instanceof CatalogError);
    check('错误指出缺失 asset 字段路径', err?.fieldPath?.includes('assetId'));
  }

  // 缺失 pose profile
  {
    const c = clone(inputs.catalog);
    c.foods[0].poseProfile = 'nonexistent-profile';
    let err = null;
    try {
      createFoodRegistry({ ...inputs, catalog: c });
    } catch (e) {
      err = e;
    }
    check('缺失 pose profile 抛 CatalogError', err instanceof CatalogError);
    check('错误指出缺失 poseProfile 字段路径', err?.fieldPath?.includes('poseProfile'));
  }

  // 必需食物没有 vendor
  {
    const v = clone(inputs.vendors);
    // 过滤掉 xiaolongbao 的 vendor
    if (v.vendors) {
      v.vendors = v.vendors.filter(entry => entry.foodId !== 'xiaolongbao');
    }
    let err = null;
    try {
      createFoodRegistry({ ...inputs, vendors: v });
    } catch (e) {
      err = e;
    }
    check('必需食物缺少 vendor 时抛 CatalogError', err instanceof CatalogError);
    check('错误指出缺少 vendor 的 requiredFoodIds 字段路径', err?.fieldPath?.includes('requiredFoodIds'));
  }

  // 必需食物被禁用 (enabled = false)
  {
    const c = clone(inputs.catalog);
    c.foods[0].enabled = false;
    let err = null;
    try {
      createFoodRegistry({ ...inputs, catalog: c });
    } catch (e) {
      err = e;
    }
    check('必需食物为 disabled 时拒绝', err instanceof CatalogError);
    check('错误指出 disabled 食物不可作为 requiredFoodIds', err?.fieldPath?.includes('requiredFoodIds'));
  }

  // Vendor 引用不存在的 foodId
  {
    const v = clone(inputs.vendors);
    const list = v.vendors ?? v;
    list[0].foodId = 'unknown-snack';
    let err = null;
    try {
      createFoodRegistry({ ...inputs, vendors: v });
    } catch (e) {
      err = e;
    }
    check('Vendor 引用不存在的 foodId 抛 CatalogError', err instanceof CatalogError);
    check('错误指出 vendor 的 foodId 字段路径', err?.fieldPath?.includes('foodId'));
  }
}

// ==========================================
// 5. 非法路径与不安全 ID / 数值校验 (Invalid path & safety)
// ==========================================
{
  const inputs = loadFirstEditionInputs();

  // 路径中包含 ../ 目录穿越
  {
    const a = clone(inputs.assets);
    const list = a.foods ?? a;
    list[0].path = '../unsafe/path.glb';
    let err = null;
    try {
      createFoodRegistry({ ...inputs, assets: a });
    } catch (e) {
      err = e;
    }
    check('包含 ../ 的相对路径抛 CatalogError', err instanceof CatalogError);
    check('错误指出 path 字段路径', err?.fieldPath?.includes('path'));
  }

  // 路径以 / 开头（绝对路径）
  {
    const a = clone(inputs.assets);
    const list = a.foods ?? a;
    list[0].path = '/etc/passwd';
    let err = null;
    try {
      createFoodRegistry({ ...inputs, assets: a });
    } catch (e) {
      err = e;
    }
    check('绝对路径抛 CatalogError', err instanceof CatalogError);
    check('错误指出 path 字段路径', err?.fieldPath?.includes('path'));
  }

  // 路径包含反斜杠 \
  {
    const a = clone(inputs.assets);
    const list = a.foods ?? a;
    list[0].path = 'resources\\foods\\handheld\\xiaolongbao.glb';
    let err = null;
    try {
      createFoodRegistry({ ...inputs, assets: a });
    } catch (e) {
      err = e;
    }
    check('反斜杠路径抛 CatalogError', err instanceof CatalogError);
  }

  // 不合法 ID（包含斜杠或特殊字符）
  {
    const c = clone(inputs.catalog);
    c.foods[0].id = 'bad/id/name';
    let err = null;
    try {
      createFoodRegistry({ ...inputs, catalog: c });
    } catch (e) {
      err = e;
    }
    check('包含斜杠的不安全 ID 抛 CatalogError', err instanceof CatalogError);
    check('错误指出 id 字段路径', err?.fieldPath?.includes('id'));
  }

  // Vendor 存在非有限数值 (NaN / Infinity)
  {
    const v = clone(inputs.vendors);
    const list = v.vendors ?? v;
    list[0].position = [10.5, NaN, 20.0];
    let err = null;
    try {
      createFoodRegistry({ ...inputs, vendors: v });
    } catch (e) {
      err = e;
    }
    check('Vendor position 含有 NaN 抛 CatalogError', err instanceof CatalogError);
    check('错误指出 vendor 坐标字段路径', err?.fieldPath?.includes('position'));
  }
}

// ==========================================
// 6. 空但合法的目录 (Empty-but-valid catalog)
// ==========================================
{
  const emptyCatalog = {
    schemaVersion: 1,
    editionId: 'empty-test-edition',
    requiredFoodIds: [],
    chapters: [],
    foods: [],
  };
  const emptyAssets = { foods: [] };
  const emptyVendors = { vendors: [] };
  const emptyProfiles = { profiles: [] };

  const reg = createFoodRegistry({
    catalog: emptyCatalog,
    assets: emptyAssets,
    vendors: emptyVendors,
    profiles: emptyProfiles,
  });

  check('空目录正常生成注册表', !!reg);
  check('空目录 foodsById 为空 Map', reg.foodsById.size === 0);
  check('空目录 vendorsById 为空 Map', reg.vendorsById.size === 0);
  check('空目录 requiredFoodIds 为空', (reg.requiredFoodIds.size ?? reg.requiredFoodIds.length) === 0);
  check('空目录 vendorsFor 返回空数组', Array.isArray(reg.vendorsFor('anything')) && reg.vendorsFor('anything').length === 0);

  // 传入 PlayGameState，空目录应处于 complete = false 状态
  const s = new PlayGameState({ foods: [] });
  s.configureCatalog(reg);
  check('空目录配置后 complete 为 false', s.complete === false);
}

// 汇总测试结果
if (failures > 0) {
  console.error(`\nFAILED: ${failures} checks failed.`);
  process.exit(1);
} else {
  console.log('\nPLAY_FOOD_REGISTRY PASS');
  process.exit(0);
}
