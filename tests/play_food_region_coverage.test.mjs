// Unit tests for food atlas region coverage extension (approved 48-food expansion)
// Contract verification for:
// 1. 3-regions/4foods projection & counts
// 2. region uniqueness from multiple foods
// 3. disabled entries exclusion
// 4. missing or duplicate region reference (CatalogError field paths)
// 5. unseen privacy
// 6. old 24 -> 48 collection continuation
// 7. tastes-48 milestone
// Run: node tests/play_food_region_coverage.test.mjs

import assert from 'node:assert/strict';
import { createFoodRegistry, CatalogError } from '../scene-authoring/yuyuan-area/web/play/catalog.js';
import { atlasEntries, filterByRegion } from '../scene-authoring/yuyuan-area/web/play/atlas.js';
import { PlayGameState } from '../scene-authoring/yuyuan-area/web/play/state.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
}

// -----------------------------------------------------------------------------
// Helper: create a mock registry with custom catalog, assets, vendors, profiles
// -----------------------------------------------------------------------------
function makeTestRegistry({ regions, foods, chapters, vendors, requiredFoodIds }) {
  const chapterList = chapters || [
    { id: 'ch-east', name: '华东风味', targetCount: 2 },
    { id: 'ch-north', name: '北方风味', targetCount: 1 },
    { id: 'ch-south', name: '南方风味', targetCount: 1 },
  ];
  const catalog = {
    editionId: 'test-coverage-edition',
    chapters: chapterList,
    foods,
    requiredFoodIds: requiredFoodIds || foods.filter(f => f.enabled !== false).map(f => f.id),
  };
  if (regions !== undefined) {
    catalog.regions = regions;
  }

  const assets = {
    foods: foods.map(f => ({
      id: f.assetId || `asset-${f.id}`,
      path: `models/foods/${f.id}.glb`,
    })),
  };

  const vendorList = vendors || foods.map((f, i) => ({
    vendorId: `vendor-${f.id}`,
    foodId: f.id,
    stallId: `stall-${i + 1}`,
  }));

  const profiles = [
    { id: 'cupped', status: 'ready' },
    { id: 'wrapped', status: 'ready' },
  ];

  return createFoodRegistry({
    catalog,
    assets,
    vendors: vendorList,
    profiles,
  });
}

console.log('=== 1. 3-regions / 4-foods projection & zero state ===');
{
  const regions = [
    { id: 'reg-shanghai', name: '上海' },
    { id: 'reg-beijing', name: '北京' },
    { id: 'reg-sichuan', name: '四川' },
  ];

  const foods = [
    {
      id: 'food-xlb',
      name: '小笼包',
      labelZh: '南翔小笼包',
      chapterId: 'ch-east',
      regionId: 'reg-shanghai',
      assetId: 'asset-xlb',
      poseProfile: 'cupped',
    },
    {
      id: 'food-sjb',
      name: '生煎包',
      labelZh: '大壶春生煎',
      chapterId: 'ch-east',
      regionId: 'reg-shanghai',
      assetId: 'asset-sjb',
      poseProfile: 'cupped',
    },
    {
      id: 'food-thl',
      name: '糖葫芦',
      labelZh: '冰糖葫芦',
      chapterId: 'ch-north',
      regionId: 'reg-beijing',
      assetId: 'asset-thl',
      poseProfile: 'wrapped',
    },
    {
      id: 'food-ddm',
      name: '担担面',
      labelZh: '成都担担面',
      chapterId: 'ch-south',
      regionId: 'reg-sichuan',
      assetId: 'asset-ddm',
      poseProfile: 'cupped',
    },
  ];

  const registry = makeTestRegistry({ regions, foods });

  check('createFoodRegistry exposes regionsById Map', registry.regionsById instanceof Map);
  check('regionsById size is 3', registry.regionsById.size === 3);
  check('regionsById has reg-shanghai', registry.regionsById.has('reg-shanghai'));

  // Zero state projection
  const emptySnapshot = {
    discovered: [],
    tasted: [],
  };
  const zeroEntries = atlasEntries(registry, emptySnapshot);

  check('zero state: counts.regionTotal is 3', zeroEntries.counts?.regionTotal === 3);
  check('zero state: counts.regionsDiscovered is 0', zeroEntries.counts?.regionsDiscovered === 0);
  check('zero state: counts.regionsTasted is 0', zeroEntries.counts?.regionsTasted === 0);
  check('zero state: entries.regions array has 3 regions', Array.isArray(zeroEntries.regions) && zeroEntries.regions.length === 3);

  const zeroSh = zeroEntries.regions?.find(r => r.id === 'reg-shanghai');
  check('zero state: reg-shanghai total is 2', zeroSh?.total === 2);
  check('zero state: reg-shanghai discovered is 0', zeroSh?.discovered === 0);
  check('zero state: reg-shanghai tasted is 0', zeroSh?.tasted === 0);

  // Active projection: food-xlb is tasted, food-thl is discovered only, food-sjb and food-ddm unseen
  const activeSnapshot = {
    discovered: ['food-xlb', 'food-thl'],
    tasted: ['food-xlb'],
  };
  const entries = atlasEntries(registry, activeSnapshot);

  check('active: counts.regionTotal is 3', entries.counts?.regionTotal === 3);
  check('active: counts.regionsDiscovered is 2 (shanghai, beijing)', entries.counts?.regionsDiscovered === 2);
  check('active: counts.regionsTasted is 1 (shanghai)', entries.counts?.regionsTasted === 1);

  const sh = entries.regions?.find(r => r.id === 'reg-shanghai');
  check('reg-shanghai: total is 2, discovered is 1, tasted is 1',
    sh?.total === 2 && sh?.discovered === 1 && sh?.tasted === 1);

  const bj = entries.regions?.find(r => r.id === 'reg-beijing');
  check('reg-beijing: total is 1, discovered is 1, tasted is 0',
    bj?.total === 1 && bj?.discovered === 1 && bj?.tasted === 0);

  const sc = entries.regions?.find(r => r.id === 'reg-sichuan');
  check('reg-sichuan: total is 1, discovered is 0, tasted is 0',
    sc?.total === 1 && sc?.discovered === 0 && sc?.tasted === 0);

  // Filter by region helper
  const shEntries = typeof entries.filterByRegion === 'function'
    ? entries.filterByRegion('reg-shanghai')
    : (typeof filterByRegion === 'function' ? filterByRegion(entries, 'reg-shanghai') : null);

  check('filterByRegion(reg-shanghai) returns 2 foods', Array.isArray(shEntries) && shEntries.length === 2);
  check('filterByRegion with filterKey tasted returns 1 food',
    typeof entries.filterByRegion === 'function' &&
    entries.filterByRegion('reg-shanghai', 'tasted').length === 1 &&
    entries.filterByRegion('reg-shanghai', 'tasted')[0].id === 'food-xlb'
  );
}

console.log('\n=== 2. Region uniqueness from multiple foods ===');
{
  const regions = [
    { id: 'reg-shanghai', name: '上海' },
    { id: 'reg-beijing', name: '北京' },
  ];

  const foods = [
    { id: 'food-1', name: '食物1', chapterId: 'ch-east', regionId: 'reg-shanghai', assetId: 'a1', poseProfile: 'cupped' },
    { id: 'food-2', name: '食物2', chapterId: 'ch-east', regionId: 'reg-shanghai', assetId: 'a2', poseProfile: 'cupped' },
    { id: 'food-3', name: '食物3', chapterId: 'ch-east', regionId: 'reg-shanghai', assetId: 'a3', poseProfile: 'cupped' },
    { id: 'food-4', name: '食物4', chapterId: 'ch-north', regionId: 'reg-beijing', assetId: 'a4', poseProfile: 'wrapped' },
  ];

  const registry = makeTestRegistry({ regions, foods });

  // Only food-1 tasted in shanghai
  const snap1 = { tasted: ['food-1'], discovered: ['food-1'] };
  const entries1 = atlasEntries(registry, snap1);
  check('1 food in shanghai tasted -> regionsTasted is 1', entries1.counts?.regionsTasted === 1);

  // Both food-1 and food-2 tasted in shanghai -> regionsTasted is STILL 1 (unique region coverage)
  const snap2 = { tasted: ['food-1', 'food-2'], discovered: ['food-1', 'food-2'] };
  const entries2 = atlasEntries(registry, snap2);
  check('2 foods in shanghai tasted -> regionsTasted is still 1 (not duplicated)', entries2.counts?.regionsTasted === 1);
  check('shanghai region total is 3, tasted is 2',
    entries2.regions?.find(r => r.id === 'reg-shanghai')?.tasted === 2 &&
    entries2.regions?.find(r => r.id === 'reg-shanghai')?.total === 3
  );

  // All 3 foods in shanghai tasted -> regionsTasted is still 1
  const snap3 = { tasted: ['food-1', 'food-2', 'food-3'], discovered: ['food-1', 'food-2', 'food-3'] };
  const entries3 = atlasEntries(registry, snap3);
  check('3 foods in shanghai tasted -> regionsTasted is still 1', entries3.counts?.regionsTasted === 1);

  // When food-4 (beijing) is also tasted -> regionsTasted becomes 2
  const snap4 = { tasted: ['food-1', 'food-2', 'food-3', 'food-4'], discovered: ['food-1', 'food-2', 'food-3', 'food-4'] };
  const entries4 = atlasEntries(registry, snap4);
  check('shanghai + beijing tasted -> regionsTasted is 2', entries4.counts?.regionsTasted === 2);
}

console.log('\n=== 3. Disabled entries exclusion and unique food counts (not vendors) ===');
{
  const regions = [
    { id: 'reg-active', name: '有效地区' },
    { id: 'reg-disabled-only', name: '全禁用地区' },
  ];

  const foods = [
    { id: 'f-active-1', name: '有效1', chapterId: 'ch-east', regionId: 'reg-active', assetId: 'a1', poseProfile: 'cupped', enabled: true },
    { id: 'f-disabled-1', name: '禁用1', chapterId: 'ch-east', regionId: 'reg-active', assetId: 'a2', poseProfile: 'cupped', enabled: false },
    { id: 'f-disabled-2', name: '禁用2', chapterId: 'ch-east', regionId: 'reg-disabled-only', assetId: 'a3', poseProfile: 'cupped', enabled: false },
  ];

  // Vendor assignment: f-active-1 has 2 vendors assigned
  const vendors = [
    { vendorId: 'v-1a', foodId: 'f-active-1', stallId: 's1' },
    { vendorId: 'v-1b', foodId: 'f-active-1', stallId: 's2' },
    { vendorId: 'v-2', foodId: 'f-disabled-1', stallId: 's3' },
    { vendorId: 'v-3', foodId: 'f-disabled-2', stallId: 's4' },
  ];

  const registry = makeTestRegistry({ regions, foods, vendors, requiredFoodIds: ['f-active-1'] });
  const entries = atlasEntries(registry, { discovered: ['f-active-1'], tasted: [] });

  check('entries excludes disabled foods (total is 1)', entries.length === 1);
  check('reg-disabled-only is excluded from entries.regions',
    !entries.regions?.some(r => r.id === 'reg-disabled-only'));
  check('reg-active has total = 1 (unique food count, not 2 vendors)',
    entries.regions?.find(r => r.id === 'reg-active')?.total === 1);
  check('entries.counts.regionTotal is 1 (excluding region with only disabled foods)',
    entries.counts?.regionTotal === 1);
}

console.log('\n=== 4. Missing or duplicate region reference with CatalogError field paths ===');
{
  // 4a. Duplicate region ID
  assert.throws(
    () => {
      makeTestRegistry({
        regions: [
          { id: 'dup-region', name: '地区A' },
          { id: 'dup-region', name: '地区B' },
        ],
        foods: [
          { id: 'f1', name: '食物1', chapterId: 'ch-east', regionId: 'dup-region', assetId: 'a1', poseProfile: 'cupped' },
        ],
      });
    },
    (err) => {
      check('duplicate region ID throws CatalogError', err instanceof CatalogError);
      check('duplicate region fieldPath is catalog.regions[1].id', err.fieldPath === 'catalog.regions[1].id');
      return true;
    }
  );

  // 4b. Unknown food region reference
  assert.throws(
    () => {
      makeTestRegistry({
        regions: [
          { id: 'valid-region', name: '有效地区' },
        ],
        foods: [
          { id: 'f1', name: '食物1', chapterId: 'ch-east', regionId: 'non-existent-region', assetId: 'a1', poseProfile: 'cupped' },
        ],
      });
    },
    (err) => {
      check('unknown food region reference throws CatalogError', err instanceof CatalogError);
      check('unknown region fieldPath is catalog.foods[0].regionId', err.fieldPath === 'catalog.foods[0].regionId');
      return true;
    }
  );

  // 4c. Legacy fixture without regions list remains compatible
  const legacyRegistry = makeTestRegistry({
    regions: undefined, // no regions in catalog
    foods: [
      { id: 'f-legacy', name: '传统小吃', regionLabel: '上海老味道', chapterId: 'ch-east', assetId: 'a1', poseProfile: 'cupped' },
    ],
  });
  check('legacy fixture: regionsById is empty Map', legacyRegistry.regionsById instanceof Map && legacyRegistry.regionsById.size === 0);

  const legacyEntries = atlasEntries(legacyRegistry, { discovered: ['f-legacy'], tasted: [] });
  check('legacy fixture: counts.regionTotal is 0', legacyEntries.counts?.regionTotal === 0);
  check('legacy fixture: entries.regions is empty array', Array.isArray(legacyEntries.regions) && legacyEntries.regions.length === 0);
}

console.log('\n=== 5. Unseen privacy protection ===');
{
  const regions = [
    { id: 'reg-secret', name: '秘境风味' },
  ];
  const foods = [
    {
      id: 'food-secret',
      name: '绝密小吃',
      labelZh: '绝密小吃真名',
      regionId: 'reg-secret',
      regionLabel: '秘境风味',
      locationHint: '隐秘角落 99 号',
      chapterId: 'ch-east',
      assetId: 'a-sec',
      poseProfile: 'cupped',
    },
  ];

  const registry = makeTestRegistry({ regions, foods });

  // Unseen projection
  const unseenEntries = atlasEntries(registry, { discovered: [], tasted: [] });
  const unseen = unseenEntries[0];

  check('unseen food: status is unseen', unseen.status === 'unseen');
  check('unseen food: regionId is strictly null (hidden)', unseen.regionId === null);
  check('unseen food: name is strictly null (hidden)', unseen.name === null);
  check('unseen food: displayName is ???', unseen.displayName === '???');
  check('unseen food: regionLabel is strictly null (hidden)', unseen.regionLabel === null);
  check('unseen food: locationHint is strictly null (hidden)', unseen.locationHint === null);
  check('unseen food: defaultVendorId is strictly null (hidden)', unseen.defaultVendorId === null);

  // Discovered projection
  const discoveredEntries = atlasEntries(registry, { discovered: ['food-secret'], tasted: [] });
  const discovered = discoveredEntries[0];

  check('discovered food: status is discovered', discovered.status === 'discovered');
  check('discovered food: regionId is exposed', discovered.regionId === 'reg-secret');
  check('discovered food: name is exposed', discovered.name === '绝密小吃');
  check('discovered food: displayName is exposed', discovered.displayName === '绝密小吃真名');
  check('discovered food: regionLabel is exposed', discovered.regionLabel === '秘境风味');
}

console.log('\n=== 6. Old 24 -> 48 collection continuation ===');
{
  // Generate 48 food catalog with 34 regions
  const regions48 = [];
  for (let r = 1; r <= 34; r++) {
    regions48.push({ id: `reg-${r}`, name: `地区-${r}` });
  }

  const foods48 = [];
  for (let i = 1; i <= 48; i++) {
    const regId = `reg-${((i - 1) % 34) + 1}`;
    foods48.push({
      id: `snack-${i}`,
      name: `小吃-${i}`,
      chapterId: `ch-${((i - 1) % 8) + 1}`,
      regionId: regId,
      assetId: `asset-${i}`,
      poseProfile: 'cupped',
    });
  }

  const chapters8 = [];
  for (let c = 1; c <= 8; c++) {
    chapters8.push({ id: `ch-${c}`, name: `章节-${c}`, targetCount: 6 });
  }

  const registry48 = makeTestRegistry({
    regions: regions48,
    foods: foods48,
    chapters: chapters8,
    requiredFoodIds: foods48.map(f => f.id),
  });

  // Old save with 24 foods completed (first 24 snacks)
  const old24Tasted = [];
  for (let i = 1; i <= 24; i++) {
    old24Tasted.push(`snack-${i}`);
  }

  const oldSave = {
    schemaVersion: 2,
    sceneVersion: 'play-snacks-20261001',
    catalogEdition: 'pawborough-snack-atlas-v1-twenty-four',
    actorId: 'gray-cat',
    feet: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    heldItem: null,
    basketItem: null,
    eating: null,
    discovered: [...old24Tasted],
    tasted: [...old24Tasted],
    milestones: ['tastes-6', 'tastes-12', 'tastes-24'],
    orphanedProgress: { discovered: [], tasted: [] },
    vehicle: { placed: false, pos: null, yaw: 0, viewYaw: 0, riding: false },
  };

  const state = new PlayGameState();
  const configured = state.configureCatalog(registry48);
  check('PlayGameState successfully configured with 48 foods', configured === true);

  const applied = state.applySave(oldSave);
  check('applySave succeeds with old 24 save into 48 registry', applied.ok === true);
  check('old 24 tasted records completely preserved (size 24)', state.tasted.size === 24);
  check('stamps count is 24', state.stamps === 24);
  check('game not yet complete (24 / 48)', state.complete === false);
  check('milestones contain tastes-6, 12, 24',
    state.milestones.has('tastes-6') &&
    state.milestones.has('tastes-12') &&
    state.milestones.has('tastes-24')
  );
  check('milestones do NOT yet contain tastes-48', !state.milestones.has('tastes-48'));

  // Player eats the 25th food: progress continues seamlessly
  state.take('snack-25');
  state.startEat();
  state.eatTick(3.5);

  check('eating 25th snack increases tasted to 25', state.tasted.size === 25);
  check('stamps is now 25', state.stamps === 25);
  check('snack-25 is in tasted', state.tasted.has('snack-25'));
}

console.log('\n=== 7. tastes-48 milestone ===');
{
  const foods48 = [];
  for (let i = 1; i <= 48; i++) {
    foods48.push({
      id: `snack-${i}`,
      name: `小吃-${i}`,
      chapterId: 'ch-main',
      regionId: `reg-${((i - 1) % 34) + 1}`,
      assetId: `asset-${i}`,
      poseProfile: 'cupped',
    });
  }
  const regions34 = [];
  for (let r = 1; r <= 34; r++) {
    regions34.push({ id: `reg-${r}`, name: `地区${r}` });
  }
  const registry48 = makeTestRegistry({
    regions: regions34,
    foods: foods48,
    chapters: [{ id: 'ch-main', name: '主章节', targetCount: 48 }],
    requiredFoodIds: foods48.map(f => f.id),
  });

  const state = new PlayGameState();
  state.configureCatalog(registry48);

  // Simulate tasting all 48 snacks
  const all48Tasted = foods48.map(f => f.id);
  const save48 = {
    schemaVersion: 2,
    sceneVersion: 'play-snacks-20261001',
    catalogEdition: 'pawborough-snack-atlas-v1-forty-eight',
    actorId: 'gray-cat',
    discovered: all48Tasted,
    tasted: all48Tasted,
    milestones: [],
    orphanedProgress: { discovered: [], tasted: [] },
  };

  state.applySave(save48);

  check('48 foods tasted: stamps is 48', state.stamps === 48);
  check('48 foods tasted: game is complete', state.complete === true);
  check('milestones has tastes-6', state.milestones.has('tastes-6'));
  check('milestones has tastes-12', state.milestones.has('tastes-12'));
  check('milestones has tastes-24', state.milestones.has('tastes-24'));
  check('milestones has tastes-48', state.milestones.has('tastes-48'));
}

console.log(`\nplay_food_region_coverage tests completed: failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
