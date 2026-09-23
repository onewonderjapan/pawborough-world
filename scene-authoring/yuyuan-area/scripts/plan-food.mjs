import {readInventory,assetPath} from '../src/project-paths.mjs';
// G5 食品接入规划：86 food_socket -> 具体食品实例（来源/LOD/位姿/支撑/尺度），产出：
//   OUT_DIR/food-placement.json   每个socket的分配（装配与检查共用的事实文件）
//   OUT_DIR/food-source-index.json 用/不用来源清单 + SHA256（对照 inputs/FOOD_INVENTORY.json）
// 只读源资产；分配规则确定性（按摊位号轮转），无随机。
// 用法：OUT_DIR=out-goal-05 node scripts/plan-food.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const HANDHELD_DIR = path.join(ROOT, 'resources/foods/handheld');
const BATCH_GLB = path.join(ROOT, 'resources/foods/tabletop/snacks-batch.glb');
const INVENTORY = readInventory();
const invByPath = new Map(INVENTORY.sources.map(s => [s.path, s]));
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const handheldCatalog = JSON.parse(fs.readFileSync(path.join(HANDHELD_DIR, 'catalog.json'), 'utf8'));
const batchCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/foods/tabletop/catalog.json'), 'utf8'));

// ---- 来源选择（语义去重：同一食品语义只保留一个来源） ----
// 手持 LOD 道具（优先候选，接入时按用途选单档 LOD）：
const USE_HANDHELD = {
  // 蒸煮
  'steamer-xiaolongbao-8': { use: '蒸煮', lod: 1, extras: ['lid'], slot: 'purpose' },
  // 烤制（炉面/炸物）
  'youdunzi': { use: '烤制', lod: 1, extras: [], slot: 'purpose' },
  'shengjian': { use: '烤制', lod: 1, extras: [], slot: 'purpose' },
  'xiekehuang': { use: '烤制', lod: 1, extras: [], slot: 'purpose' },
  'congyoubing': { use: '烤制', lod: 1, extras: [], slot: 'purpose' },
  'cifangao': { use: '烤制', lod: 1, extras: [], slot: 'purpose' },
  'chunjuan': { use: '烤制', lod: 1, extras: [], slot: 'purpose' },
  'youtiao': { use: '烤制', lod: 1, extras: [], slot: 'purpose' },
  'dabing': { use: '烤制', lod: 1, extras: [], slot: 'purpose' },
  // 饮品
  'teacup-filled': { use: '饮品', lod: 1, extras: [], slot: 'purpose' },
  // 点心（展示柜/台面）
  'xiaolongbao': { use: '点心', lod: 1, extras: [], slot: 'purpose' },
  'guantangbao': { use: '点心', lod: 1, extras: ['straw'], slot: 'purpose' },
  'tangyuan': { use: '点心', lod: 1, extras: [], slot: 'purpose' },
  'tangyuan-meat': { use: '点心', lod: 1, extras: [], slot: 'purpose' },
  'ligaotang-piece': { use: '点心', lod: 1, extras: [], slot: 'purpose' },
  'ligaotang-box-open': { use: '点心', lod: 1, extras: [], slot: 'purpose' },
};
// 桌面合集（snacks-batch.glb 按 prop__<id> 拆分，单档 LOD，用于托盘位成组展示）：
const USE_BATCH = {
  'jiuniang-yuanzi-bowl': { use: '蒸煮', slot: 'tray' },
  'tangyuan-bowl': { use: '蒸煮', slot: 'tray' },
  'xiekehuang-tray': { use: '烤制', slot: 'tray' },
  'youtiao-pair-plate': { use: '烤制', slot: 'tray' },
  'congyoubing-plate': { use: '烤制', slot: 'tray' },
  'dabing-stack': { use: '烤制', slot: 'tray' },
  'youdunzi-rack': { use: '烤制', slot: 'tray' },
  'cifangao-plate': { use: '烤制', slot: 'tray' },
  'chunjuan-plate': { use: '烤制', slot: 'tray' },
  'teapot-cups': { use: '饮品', slot: 'tray' },
  'wuxiangdou-jar': { use: '点心', slot: 'tray' },
  'wuxiangdou-packet': { use: '点心', slot: 'tray' },
  'babaofan-plate': { use: '点心', slot: 'tray' },
  'paigu-niangao-plate': { use: '点心', slot: 'tray' },
  'chopstick-cup': { use: '点心', slot: 'tray' },
  'vinegar-dish': { use: '点心', slot: 'tray' },
};
// 语义去重而未用的手持件（理由写入来源索引）：
const SKIP_HANDHELD = {
  'bean-single': '五香豆语义由桌面合集 wuxiangdou-jar/wuxiangdou-packet 覆盖（语义去重）；且 510KB 豆粒贴图×实例不适配远景街景预算',
  'bean-dish': '同上（五香豆碟=wuxiangdou-jar 同义）',
  'bean-jar': '同上（玻璃罐=wuxiangdou-jar 同义；564KB 贴图不重复嵌入）',
  'bean-packet-open': '同上（纸包=wuxiangdou-packet 同义）',
  'bowl-tangyuan': '汤糰碗语义由桌面合集 tangyuan-bowl 覆盖（语义去重）',
  'bowl-jiuniang': '酒釀碗语义由桌面合集 jiuniang-yuanzi-bowl 覆盖（语义去重）',
  'bowl-soymilk': '豆漿碗语义由桌面合集 soymilk-bowl… 由 teapot-cups/teacup-filled 覆盖饮品摆设（语义去重）',
  'chopsticks-pair': '筷子语义由桌面合集 chopstick-cup 覆盖（语义去重）',
  'wuxiangdou-packet': '与桌面合集 wuxiangdou-packet 同义，保留桌面版（免 510KB 贴图重复）',
  'vinegar-dish': '与桌面合集 vinegar-dish 同义，保留桌面版',
  'plate-paigu-niangao': '排骨年糕盤与桌面合集 paigu-niangao-plate 同义，保留桌面版',
};
const SKIP_BATCH = {
  'ligaotang-box': '梨膏糖盒语义由手持件 ligaotang-box-open 覆盖（语义去重，保留带盒盖开启状态的手持版）',
};
const SKIP_OTHER_SOURCES = {
  'pawborough-snackshop-20260921/building/snacks.glb (蒸笼/包点合集 9件)': '蒸笼语义已由手持件 steamer-xiaolongbao-8 覆盖（语义去重）；不再重复接入第二套蒸笼',
  'pawborough-snackshop-20260921/building/model.glb (店面参考)': '仅店面造型参考；商城 16 楼壳/30 店屋整区覆盖已有，不因新增来源重复加店',
};

// ---- 读取 socket ----
const sockets = JSON.parse(fs.readFileSync(path.join(OUT, 'food-sockets.json'), 'utf8')).sockets;
if (sockets.length !== 86) throw new Error(`socket 数 ${sockets.length} != 86`);

const cycle = (list, stall) => list[stall.num % list.length];
const stallNum = (id) => parseInt(id.replace(/^stall-/, ''), 10);
const itemTri = (name) => handheldCatalog.items[name].triangles[`lod${USE_HANDHELD[name].lod}`] +
  Object.entries(handheldCatalog.items[name].extraNodeTriangles || {})
    .filter(([k]) => USE_HANDHELD[name].extras.includes(k)).reduce((s, [, v]) => s + v, 0);

const placements = [];
const issues = [];
for (const s of sockets) {
  const num = stallNum(s.stall);
  const isTray = s.purpose === 'food-tray-display';
  let entry;
  if (isTray) {
    const pool = Object.keys(USE_BATCH).filter(k => USE_BATCH[k].use === s.foodUse);
    const id = cycle(pool, { num });
    const cat = batchCatalog.props[id];
    entry = {
      item: id, source: BATCH_GLB, sourceKind: 'tabletop_collection', lod: null, extras: [],
      node: `prop__${id}`, triangles: cat.triangles,
      footprintM: [cat.sizeMeters.x, cat.sizeMeters.z],
    };
  } else {
    const pool = Object.keys(USE_HANDHELD).filter(k => USE_HANDHELD[k].use === s.foodUse && USE_HANDHELD[k].slot === 'purpose');
    const id = cycle(pool, { num });
    const cat = handheldCatalog.items[id];
    entry = {
      item: id, source: path.join(HANDHELD_DIR, id + '.glb'), sourceKind: 'handheld_lod',
      lod: USE_HANDHELD[id].lod, extras: USE_HANDHELD[id].extras,
      node: `${id}_LOD${USE_HANDHELD[id].lod}`, triangles: itemTri(id),
      footprintM: [cat.bounds.size[0], cat.bounds.size[2]],
    };
  }
  // 尺度匹配：footprint 必须放进 socket 可用面（两轴都不超）
  const fits = entry.footprintM[0] <= s.usableSizeM[0] + 1e-6 && entry.footprintM[1] <= s.usableSizeM[1] + 1e-6;
  if (!fits) issues.push(`${s.id}: ${entry.item} footprint ${entry.footprintM} > usable ${s.usableSizeM}`);
  placements.push({
    socketId: s.id, stall: s.stall, zone: s.zone, cluster: s.cluster, foodUse: s.foodUse,
    purpose: s.purpose, ...entry,
    worldPosition: s.worldPosition, worldRotY: s.worldRotY, surfaceHeightM: s.surfaceHeightM,
    usableSizeM: s.usableSizeM, fits,
    sceneNode: `food|${s.id}`,
    rule: entry.sourceKind === 'handheld_lod'
      ? 'LOD1 单档（1.5–6m 街视带；G3/G4 实拍眼高 1.6–1.8m、机距 2–12m）'
      : '桌面合集成组展示件（单档 LOD）',
  });
}

// ---- 预算（食品单列，不占纯场景 450k/30MB 目标） ----
const triPurpose = placements.filter(p => p.slot !== 'tray' && p.purpose !== 'food-tray-display').reduce((s, p) => s + p.triangles, 0);
const triTray = placements.filter(p => p.purpose === 'food-tray-display').reduce((s, p) => s + p.triangles, 0);
const usedSources = [...new Set(placements.map(p => p.source))];
const sourceIndex = {
  generatedAt: new Date().toISOString(),
  policy: '只读源资产；接入为候选（ownerAdopted=false）；语义去重：同一食品语义只保留一个来源，合集不重复计 Food 种类',
  used: usedSources.map(p => {
    const inv = invByPath.get(p) || {};
    const actual = sha256(p);
    return {
      path: p, kind: inv.kind || (p === BATCH_GLB ? 'tabletop_collection' : 'handheld_lod'),
      sha256Recorded: inv.sha256 || null, sha256Actual: actual,
      shaMatch: actual === inv.sha256, bytes: inv.bytes || null,
      instances: placements.filter(x => x.source === p).length,
      catalog: p === BATCH_GLB ? path.join(ROOT, 'resources/foods/tabletop/catalog.json')
        : path.join(ROOT, 'resources/foods/handheld/catalog.json'),
    };
  }),
  skipped: [
    ...Object.entries(SKIP_HANDHELD).map(([id, why]) => ({
      path: path.join(HANDHELD_DIR, id + '.glb'), kind: 'handheld_lod', reason: why,
      sha256Recorded: invByPath.get(path.join(HANDHELD_DIR, id + '.glb'))?.sha256 || null,
    })),
    ...Object.entries(SKIP_BATCH).map(([id, why]) => ({
      path: BATCH_GLB + '#prop__' + id, kind: 'tabletop_collection', reason: why, note: '文件本身在 used 列表（按节点拆分使用）',
    })),
    ...Object.entries(SKIP_OTHER_SOURCES).map(([k, why]) => ({ path: k, kind: 'other', reason: why })),
  ],
};

const budget = {
  note: '食品预算单列（PLAN G5：不偷换旧纯场景预算）。核心三区 placed 400k/450k 与主 GLB 27.2MB/30MB 目标仍按纯场景口径复核。',
  foodPlacedTriangles: triPurpose + triTray,
  foodPlacedTarget: 120000,
  breakdown: { purposeSlots: { count: 43, triangles: triPurpose }, traySlots: { count: 43, triangles: triTray } },
  instances: placements.length,
  uniqueItemsUsed: usedSources.length,
};

const report = {
  generatedAt: new Date().toISOString(),
  outDir: path.relative(ROOT, OUT),
  lodPolicy: '手持件按用途固定单档 LOD1 接入（街视 1.5–6m 带）；bean-* 高密度件未接入（语义去重），故「高密度豆罐远景低档」由 wuxiangdou-jar 单档桌面件承担；每实例仅 1 个 LOD 节点 + 必要子件（lid/straw）',
  restPolicy: '食品 origin=落地中心（来源目录约定），直接置于 socket surfaceHeightM 台面；朝向取 socket worldRotY，不另加随机',
  budget, issues,
  counts: {
    sockets: sockets.length, placements: placements.length,
    byPurpose: placements.reduce((m, p) => (m[p.purpose] = (m[p.purpose] || 0) + 1, m), {}),
    byUse: placements.reduce((m, p) => (m[p.foodUse] = (m[p.foodUse] || 0) + 1, m), {}),
  },
  placements,
};
fs.writeFileSync(path.join(OUT, 'food-placement.json'), JSON.stringify(report, null, 1));
fs.writeFileSync(path.join(OUT, 'food-source-index.json'), JSON.stringify(sourceIndex, null, 1));
console.log('placements', placements.length, 'issues', issues.length);
console.log('budget', JSON.stringify(budget.breakdown), 'total', budget.foodPlacedTriangles);
const shaBad = sourceIndex.used.filter(u => !u.shaMatch);
console.log('sha mismatch', shaBad.length ? JSON.stringify(shaBad) : 'none — sources untouched');
if (issues.length || shaBad.length) process.exit(2);
