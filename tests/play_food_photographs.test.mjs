// F02: 2D 摄影图鉴试点契约测试
// 覆盖：照片优先不被 3D thumbnail 污染、缺照片回落、未发现不露图、
// 路径私有/traversal 拦截、错误 foodId/重复/sha 字段、旧 48 食品行为不变、4:3 布局。
// Run: node tests/play_food_photographs.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createFoodRegistry, attachFoodPhotographs, CatalogError } from '../scene-authoring/yuyuan-area/web/play/catalog.js';
import { atlasEntries } from '../scene-authoring/yuyuan-area/web/play/atlas.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const AREA = join(HERE, '..', 'scene-authoring', 'yuyuan-area');
const readJson = p => JSON.parse(readFileSync(join(AREA, p), 'utf8'));
const readText = p => readFileSync(join(AREA, p), 'utf8');

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}
function expectError(name, fn) {
  try {
    fn();
    check(name, false, 'expected CatalogError but none thrown');
  } catch (e) {
    check(name, e instanceof CatalogError, `thrown ${e?.name}: ${e?.message}`);
  }
}

const catalog = readJson('inputs/food-catalog.json');
const assets = readJson('inputs/play-foods.json');
const vendors = readJson('inputs/play-vendors.json');
const profiles = readJson('inputs/food-pose-profiles.json');

const FIX_SHA = 'a'.repeat(64); // 测试夹具哈希，非真实文件声明
const pilotPhoto = (foodId, extra = {}) => ({
  foodId,
  path: `resources/atlas/food-photo-pilot/${foodId}-v1.png`,
  sha256: FIX_SHA,
  bytes: 123456,
  width: 1024,
  height: 768,
  sourceKind: 'generated-photographic',
  variant: 'v1',
  ...extra,
});
const enabledManifest = photos => ({
  schemaVersion: 1,
  styleId: 'pawborough-food-photo-v1',
  enabled: true,
  photos,
});

// ==========================================
// 1. 旧 48 食品基线：无 photoManifest 时行为不变
// ==========================================
{
  const base = createFoodRegistry({ catalog, assets, vendors, profiles });
  check('基线注册表 48 食品', base.foodsById.size === 48, `got ${base.foodsById.size}`);
  check('基线照片索引为空', base.photosByFoodId instanceof Map && base.photosByFoodId.size === 0);

  const t = base.thumbnailFor('changfen');
  check('基线 changfen 仍用 3D 渲染缩略图', !!t && t.path === '/resources/foods/thumbnails/changfen.png', JSON.stringify(t?.path));
  check('基线缩略无 photo 标记', t != null && t.kind === undefined);

  const withStub = createFoodRegistry({
    catalog, assets, vendors, profiles,
    photoManifest: { ...readJson('inputs/food-photographs.json'), enabled: false },
  });
  check('显式 disabled 摄影清单不建索引', withStub.photosByFoodId.size === 0);
  const ts = withStub.thumbnailFor('changfen');
  check('enabled=false 时 changfen 回落 3D 缩略图', ts?.path === '/resources/foods/thumbnails/changfen.png');
}

// ==========================================
// 2. 接线一：createFoodRegistry photoManifest 参数
// ==========================================
const manifest = enabledManifest([pilotPhoto('changfen'), pilotPhoto('boboji'), pilotPhoto('xiaolongbao')]);
{
  const reg = createFoodRegistry({ catalog, assets, vendors, profiles, photoManifest: manifest });
  check('照片索引含 3 样本', reg.photosByFoodId.size === 3);

  const t = reg.thumbnailFor('changfen');
  check('changfen 优先照片路径', t?.path === '/resources/atlas/food-photo-pilot/changfen-v1.png', JSON.stringify(t?.path));
  check('照片带 photo 标记', t?.kind === 'photo');
  check('照片记录 sha/尺寸/风格/变体', t?.sha256 === FIX_SHA && t?.width === 1024 && t?.height === 768
    && t?.styleId === 'pawborough-food-photo-v1' && t?.variant === 'v1' && t?.sourceKind === 'generated-photographic');
  check('照片不混入 3D 缩略路径', !JSON.stringify(t).includes('foods/thumbnails'));

  const tb = reg.thumbnailFor('boboji');
  check('boboji 照片生效', tb?.kind === 'photo' && tb?.path.endsWith('/boboji-v1.png'));
}

// ==========================================
// 3. 接线二：attachFoodPhotographs 代理 + 3D 重建不污染照片
// ==========================================
{
  const base = createFoodRegistry({ catalog, assets, vendors, profiles });
  const reg = attachFoodPhotographs(base, manifest);

  check('attach 后照片优先', reg.thumbnailFor('changfen')?.kind === 'photo'
    && reg.thumbnailFor('changfen')?.path === '/resources/atlas/food-photo-pilot/changfen-v1.png');
  check('原 registry 未被改写', base.thumbnailFor('changfen')?.path === '/resources/foods/thumbnails/changfen.png');

  // 3D 重建：asset.thumbnail 换新路径后重建 registry，再 attach 同一 manifest
  const rebuiltAssets = JSON.parse(JSON.stringify(assets));
  for (const a of (rebuiltAssets.foods ?? rebuiltAssets.assets ?? [])) {
    if (a.id === 'changfen' && a.thumbnail) a.thumbnail.path = 'resources/foods/thumbnails/changfen-REBUILD.png';
  }
  const rebuiltBase = createFoodRegistry({ catalog, assets: rebuiltAssets, vendors, profiles });
  check('重建后 3D 缩略路径已变', rebuiltBase.thumbnailFor('changfen')?.path === '/resources/foods/thumbnails/changfen-REBUILD.png');
  const rebuilt = attachFoodPhotographs(rebuiltBase, manifest);
  check('3D 重建不盖掉照片', rebuilt.thumbnailFor('changfen')?.kind === 'photo'
    && rebuilt.thumbnailFor('changfen')?.path === '/resources/atlas/food-photo-pilot/changfen-v1.png');

  expectError('attach 同样校验非法 manifest', () => attachFoodPhotographs(base, enabledManifest([pilotPhoto('ghost-food')])));
  expectError('attach 拒绝非 registry 输入', () => attachFoodPhotographs({}, manifest));
}

// ==========================================
// 4. 缺照片回落：manifest 只接一道菜
// ==========================================
{
  const reg = createFoodRegistry({ catalog, assets, vendors, profiles, photoManifest: enabledManifest([pilotPhoto('changfen')]) });
  check('未接照片的 boboji 回落 3D 缩略图', reg.thumbnailFor('boboji')?.path === '/resources/foods/thumbnails/boboji.png'
    && reg.thumbnailFor('boboji')?.kind === undefined);
  check('未接照片的 xiaolongbao 回落 3D 缩略图', reg.thumbnailFor('xiaolongbao')?.kind === undefined);
  check('其余 45 食品不受影响', reg.thumbnailFor('congyoubing')?.kind === undefined
    && String(reg.thumbnailFor('congyoubing')?.path).startsWith('/resources/foods/thumbnails/'));
}

// ==========================================
// 5. 未发现不露图：atlasEntries 投影隐藏
// ==========================================
{
  const reg = createFoodRegistry({ catalog, assets, vendors, profiles, photoManifest: manifest });
  const unseen = atlasEntries(reg, { discovered: [], tasted: [] });
  const e = unseen.find(x => x.id === 'changfen');
  check('未发现 changfen 不露照片', e?.thumbnail === null && e?.thumbnailKind === null && e?.displayName === '???');
  const discovered = atlasEntries(reg, { discovered: ['changfen'], tasted: [] });
  const d = discovered.find(x => x.id === 'changfen');
  check('已发现未品尝 changfen 露照片', d?.thumbnailKind === 'photo' && d?.thumbnail === '/resources/atlas/food-photo-pilot/changfen-v1.png');
  const other = atlasEntries(reg, { discovered: ['congyoubing'], tasted: [] }).find(x => x.id === 'congyoubing');
  check('已发现旧食品仍为 3D 缩略', other?.thumbnailKind !== 'photo' && String(other?.thumbnail).startsWith('/resources/foods/thumbnails/'));
}

// ==========================================
// 6. 路径安全：私有目录 + traversal/绝对/协议/反斜杠/扩展名拦截
// ==========================================
const badPaths = [
  ['traversal 上跳', 'resources/atlas/food-photo-pilot/../../evil.png'],
  ['绝对路径', '/resources/atlas/food-photo-pilot/x.png'],
  ['协议 scheme', 'https://cdn.example.com/x.png'],
  ['反斜杠', 'resources\\atlas\\x.png'],
  ['越出私有 atlas 目录', 'resources/foods/thumbnails/evil.png'],
  ['越出 resources 目录', 'web/play/evil.png'],
  ['非 png 扩展名', 'resources/atlas/food-photo-pilot/x.html'],
];
for (const [label, p] of badPaths) {
  expectError(`拦截照片路径：${label}`, () => createFoodRegistry({
    catalog, assets, vendors, profiles,
    photoManifest: enabledManifest([pilotPhoto('changfen', { path: p })]),
  }));
}

// ==========================================
// 7. 字段校验：未知/重复 foodId、sha、尺寸、sourceKind、styleId
// ==========================================
expectError('未知 foodId 拒绝', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: enabledManifest([pilotPhoto('not-a-real-food')]),
}));
expectError('重复 foodId 拒绝', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: enabledManifest([pilotPhoto('changfen'), pilotPhoto('changfen', { path: 'resources/atlas/food-photo-pilot/changfen-v2.png', variant: 'v2' })]),
}));
expectError('sha256 非十六进制拒绝', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: enabledManifest([pilotPhoto('changfen', { sha256: 'not-a-hash' })]),
}));
expectError('sha256 长度不足拒绝', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: enabledManifest([pilotPhoto('changfen', { sha256: 'a'.repeat(63) })]),
}));
expectError('sha256 大写拒绝（仅收小写实测值）', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: enabledManifest([pilotPhoto('changfen', { sha256: 'A'.repeat(64) })]),
}));
expectError('bytes 非正整数拒绝', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: enabledManifest([pilotPhoto('changfen', { bytes: 0 })]),
}));
expectError('width 非整数拒绝', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: enabledManifest([pilotPhoto('changfen', { width: 1024.5 })]),
}));
expectError('height 缺失拒绝', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: enabledManifest([{ ...pilotPhoto('changfen'), height: undefined }]),
}));
expectError('sourceKind 不符拒绝', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: enabledManifest([pilotPhoto('changfen', { sourceKind: 'hand-drawn' })]),
}));
expectError('manifest 级 styleId 不符拒绝', () => createFoodRegistry({
  catalog, assets, vendors, profiles,
  photoManifest: { ...enabledManifest([pilotPhoto('changfen')]), styleId: 'other-style' },
}));
{
  const reg = createFoodRegistry({
    catalog, assets, vendors, profiles,
    photoManifest: { ...manifest, enabled: undefined },
  });
  check('enabled 缺失不建索引、不校验占位', reg.photosByFoodId.size === 0
    && reg.thumbnailFor('changfen')?.path === '/resources/foods/thumbnails/changfen.png');
}

// ==========================================
// 8. 4:3 布局契约（CSS/JS 文本级，离线可跑）
// ==========================================
{
  const css = readText('web/play/atlas.css');
  const js = readText('web/play/atlas.js');
  const thumbWrapBlock = css.slice(css.indexOf('.pb-atlas-card-thumb-wrap {'), css.indexOf('.pb-atlas-card-thumb {'));
  check('卡片 thumb 为 4:3 圆角框', /aspect-ratio:\s*4\s*\/\s*3/.test(thumbWrapBlock) && /border-radius:\s*10px/.test(thumbWrapBlock));
  check('卡片 thumb 不再写死圆形裁切', !/border-radius:\s*50%/.test(thumbWrapBlock));
  check('摄影图 contain 完整器皿留边距', /\.pb-atlas-card-thumb\.is-photo\s*{[^}]*object-fit:\s*contain[^}]*padding/.test(css));
  check('详情独立大幅 4:3 摄影框', /\.pb-atlas-detail-photo-frame\s*{[^}]*aspect-ratio:\s*4\s*\/\s*3/.test(css)
    && /\.pb-atlas-detail-photo\s*{[^}]*object-fit:\s*contain/.test(css));
  check('图片 lazy 加载且卡片/详情均不预载大图', (js.match(/loading = 'lazy'/g) || []).length >= 3);
  check('照片 alt 走外置文本 displayName', /photoImg\.alt = selectedEntry\.displayName/.test(js));
  check('照片只在 thumbnailKind=photo 时用大框', /selectedEntry\.thumbnailKind === 'photo'/.test(js));
}

console.log(`\nplay_food_photographs tests completed: failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
