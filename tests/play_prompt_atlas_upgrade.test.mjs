// U01 提示与图鉴浏览整理（playtest-upgrades 20261003）。纯 Node 契约：
//   PLAY-05：摊位提示一律 foodId→food label（推车摊 stall.labelZh 是摊名，
//            绝不当食物名用）；缺字段回退后任何文案不出现 undefined。
//   PLAY-06：暂存消息剥掉与底部主提示重复的按键说明（transientNotice）。
//   PLAY-07：窄屏（≤680px）图鉴列表优先、详情抽屉按需展开（CSS/DOM 契约）。
// Run: node tests/play_prompt_atlas_upgrade.test.mjs
import { PlayGameState } from '../scene-authoring/yuyuan-area/web/play/state.js';
import { canTakeNow, takeFailHint, computeHint, foodLabelOf, stallNameOf } from '../scene-authoring/yuyuan-area/web/play/interaction.js';
import { transientNotice, goalNameOf, goalStallNameOf } from '../scene-authoring/yuyuan-area/web/play/hud.js';
import { atlasEntries } from '../scene-authoring/yuyuan-area/web/play/atlas.js';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};
const noUndefined = (s) => typeof s === 'string' && !s.includes('undefined');

// ---- 模拟真实目录形态：48 味 catalog foods 只有 name；30 个推车 vendor
//      携带摊名 labelZh（如「肠粉摊」），运行时摊位展开 vendor 字段。 ----
const state = new PlayGameState({
  foods: [
    { id: 'changfen', labelZh: '布拉肠粉', stallId: 'cart-1' },
    { id: 'xiaolongbao', labelZh: '小笼包', stallId: 'stall-5', stallLabelZh: '蒸煮小摊' },
  ],
});
state.playing = true;

// 推车摊：展开 vendor 后 labelZh=摊名、无 stallLabelZh（线上 deriveVendors cart 分支同构）
const cartStall = {
  vendorId: 'v-cart-1', foodId: 'changfen', enabled: true,
  labelZh: '肠粉摊', stallId: null,
  customerPoint: { x: 0, z: 0 },
};
// 固定摊位：labelZh=食物名、stallLabelZh=摊名（existing 分支同构）
const fixedStall = {
  vendorId: 'v-existing', foodId: 'xiaolongbao', enabled: true,
  labelZh: '小笼包', stallLabelZh: '蒸煮小摊',
  customerPoint: { x: 10, z: 0 },
};

// ==========================================
// 1. PLAY-05：取餐提示用食物名，不是摊名；无 undefined
// ==========================================
{
  const hint = computeHint({ state, feet: [0, 0, 0], stalls: [cartStall] });
  check('推车摊取餐提示是食物名', /E 取一份布拉肠粉/.test(hint ?? ''), hint);
  check('取餐提示不出现摊名当食物', !/取一份肠粉摊/.test(hint ?? ''), hint);
  check('取餐提示无 undefined', noUndefined(hint), hint);

  const mid = computeHint({ state, feet: [3, 0, 0], stalls: [cartStall] });
  check('中距离提示摊位名回退到摊名（推车）', /走近肠粉摊/.test(mid ?? ''), mid);
  check('中距离提示食物名来自 foodId', /可取布拉肠粉/.test(mid ?? ''), mid);
  check('中距离提示无 undefined', noUndefined(mid), mid);

  const fixedMid = computeHint({ state, feet: [13, 0, 0], stalls: [fixedStall] });
  check('固定摊位中距离用 stallLabelZh', /走近蒸煮小摊/.test(fixedMid ?? ''), fixedMid);

  // 全缺字段也不得 undefined
  const bare = { foodId: 'ghost-food', enabled: true, customerPoint: { x: 0, z: 0 } };
  const bareNear = computeHint({ state, feet: [0, 0, 0], stalls: [bare] });
  check('未知食物回退「小吃」而非 undefined', /E 取一份小吃/.test(bareNear ?? ''), bareNear);
  const bareMid = computeHint({ state, feet: [3, 0, 0], stalls: [bare] });
  check('无摊名字段回退「街边食摊」', /走近街边食摊/.test(bareMid ?? ''), bareMid);

  // E 距离失败提示
  const far = canTakeNow({ state, feet: [4, 0, 0], stalls: [cartStall] });
  check('too-far 附带解析后的摊名/食物名', far.stallName === '肠粉摊' && far.foodLabel === '布拉肠粉');
  const farHint = takeFailHint(far);
  check('距离失败提示无 undefined 且不叠「摊摊」', noUndefined(farHint) && /距肠粉摊约/.test(farHint ?? ''), farHint);

  const okTake = canTakeNow({ state, feet: [0.5, 0, 0], stalls: [cartStall] });
  check('可取结果食物 id 与 label 正确', okTake.ok && okTake.foodId === 'changfen' && okTake.foodLabel === '布拉肠粉');
}

// ==========================================
// 2. 单一主要动作提示（取/持/吃/骑互斥，一次只一条）
// ==========================================
{
  const feet = [0, 0, 0];
  const takeHint = computeHint({ state, feet, stalls: [cartStall] });
  check('取餐态提示含 E 不含 F/R', /E 取一份/.test(takeHint) && !/F 开吃/.test(takeHint) && !/R 下车/.test(takeHint), takeHint);

  state.take('changfen');
  const held = computeHint({ state, feet, stalls: [cartStall] });
  check('持物态提示只指 F 开吃', /手上有布拉肠粉 · F 开吃/.test(held ?? '') && !/E 取一份/.test(held ?? ''), held);

  state.startEat();
  const eating = computeHint({ state, feet, stalls: [cartStall] });
  check('进食态提示只指 P 暂停', /正在品尝布拉肠粉/.test(eating ?? '') && !/F 开吃/.test(eating ?? '') && !/E 取一份/.test(eating ?? ''), eating);
  state.cancelEat();
  state.heldItem = null;

  const riding = computeHint({ state, feet, stalls: [cartStall], riding: true });
  check('骑车态提示是操控一行，不含取餐', /R 下车/.test(riding ?? '') && !/E 取一份/.test(riding ?? ''), riding);
}

// ==========================================
// 3. PLAY-06：transientNotice 收敛暂存消息
// ==========================================
{
  check('拿到简讯剥掉「· F 开吃」',
    transientNotice('拿到一份布拉肠粉（免费试吃）· F 开吃') === '拿到一份布拉肠粉（免费试吃）',
    transientNotice('拿到一份布拉肠粉（免费试吃）· F 开吃'));
  check('骑上消息剥掉整段操控括号',
    transientNotice('骑上共享自行车（W 加速 · S 刹停后倒车 · Space 刹车 · A/D 转向 · R 下车 · 鼠标自由看）') === '骑上共享自行车');
  check('非操控括号保留',
    transientNotice('恢复骑乘（车与位置按上次存档还原）') === '恢复骑乘（车与位置按上次存档还原）');
  check('重要失败原样保留',
    transientNotice('部分摊位暂时备餐失败，其他小吃和骑车都可以继续').includes('备餐失败'));
  check('边缘失败提示的 R 指令保留（无 · 前缀不误伤）',
    transientNotice('车辆悬在边缘！原地按 R 下车或后退') === '车辆悬在边缘！原地按 R 下车或后退');
  check('普通成功简讯不动', transientNotice('新散步已开始，图鉴收藏保留') === '新散步已开始，图鉴收藏保留');
  check('空串安全', transientNotice('') === '' && transientNotice(null) === '');
}

// ==========================================
// 4. 目标文案回退（HUD 下一味行）
// ==========================================
{
  check('goal 缺 stallLabelZh 回退不 undefined', goalStallNameOf({ labelZh: '肉夹馍' }) === '街边食摊');
  check('goal 缺 labelZh 回退 name', goalNameOf({ name: '肉夹馍', stallLabelZh: '腊汁肉摊' }) === '肉夹馍');
  check('goal 全缺回退沿街寻味', goalNameOf(null) === '沿街寻味' && goalStallNameOf(undefined) === '街边食摊');
  check('拼行无 undefined', noUndefined(`下一味：${goalNameOf({ name: 'x' })}（${goalStallNameOf({})}）`));
}

// ==========================================
// 5. atlasEntries 文案契约：缺字段不产生 undefined 字符串
// ==========================================
{
  const registry = {
    foodsById: new Map([
      ['kaolengmian', { id: 'kaolengmian', name: '烤冷面', chapterId: 'dongbei', enabled: true, regionId: 'dongbei' }],
      ['mystery', { id: 'mystery', name: '神秘味', chapterId: 'dongbei', enabled: true }], // 无 regionId/labelZh
    ]),
    chaptersById: new Map([['dongbei', { id: 'dongbei', name: '东北风味' }]]),
    regionsById: new Map([['dongbei', { id: 'dongbei', name: '东北' }]]),
    requiredFoodIds: new Set(['kaolengmian', 'mystery']),
    vendorsFor: () => [],
    thumbnailFor: () => null,
  };
  const snap = { discovered: ['kaolengmian', 'mystery'], tasted: ['kaolengmian'], milestones: [], orphanedProgress: { discovered: [], tasted: [] } };
  const entries = atlasEntries(registry, snap);
  const mystery = entries.find((e) => e.id === 'mystery');
  check('discovered 食物 labelZh 回退 name', mystery.displayName === '神秘味', mystery.displayName);
  check('全部条目 displayName 无 undefined', entries.every((e) => e.displayName !== 'undefined' && !(typeof e.displayName === 'string' && e.displayName.includes('undefined'))));
  check('全部条目 regionLabel/chapterTitle 无 undefined',
    entries.every((e) => noUndefined(String(e.regionLabel ?? '')) && noUndefined(String(e.chapterTitle))));
  const unseen = atlasEntries(registry, { discovered: [], tasted: [], milestones: [], orphanedProgress: { discovered: [], tasted: [] } })
    .find((e) => e.id === 'kaolengmian');
  check('未发现条目名称/位置严格隐藏', unseen.displayName === '???' && unseen.locationHint === null && unseen.name === null);
}

// ==========================================
// 6. PLAY-07：窄屏详情抽屉 CSS/DOM 契约（源码结构断言）
// ==========================================
{
  const css = await readFile(resolve(root, 'scene-authoring/yuyuan-area/web/play/atlas.css'), 'utf8');
  const js = await readFile(resolve(root, 'scene-authoring/yuyuan-area/web/play/atlas.js'), 'utf8');
  const mobileIdx = css.indexOf('@media (max-width: 680px)');
  const mobile = mobileIdx >= 0 ? css.slice(mobileIdx) : '';
  check('保留 680px 窄屏断点', mobileIdx >= 0);
  check('窄屏卡片列表占满剩余高度（flex:1 + overflow-y:auto）',
    /\.pb-atlas-cards\s*{[^}]*flex:\s*1/.test(mobile) && /\.pb-atlas-cards\s*{[^}]*overflow-y:\s*auto/.test(mobile));
  check('窄屏不再给列表 260px 上限', !/max-height:\s*260px/.test(mobile));
  check('详情抽屉默认隐藏、is-detail-open 展开',
    /\.pb-atlas-detail\s*{[^}]*display:\s*none/.test(mobile) && mobile.includes('.pb-atlas-main-split.is-detail-open .pb-atlas-detail'));
  check('返回列表按钮窄屏显示', mobile.includes('.pb-atlas-detail-back') && /display:\s*inline-flex/.test(mobile));
  check('基础样式里返回按钮隐藏（宽屏分栏不受影响）',
    /\.pb-atlas-detail-back\s*{[^}]*display:\s*none/.test(css.slice(0, mobileIdx)));
  check('atlas.js 创建返回列表按钮并挂 is-detail-open',
    js.includes('pb-atlas-detail-back') && js.includes("classList.toggle('is-detail-open', detailOpen)"));
  check('atlas.js 用 matchMedia 对齐 680px 断点', js.includes('(max-width: 680px)'));
  check('Esc 分层：抽屉先于模态收起', /detailOpen\) {\s*closeDetail\(\);\s*} else {\s*close\(\);/.test(js));
}

console.log(failures === 0 ? 'PROMPT_ATLAS_UPGRADE PASS' : `PROMPT_ATLAS_UPGRADE FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
