// 工单 A（playtest-remnants 20261002）：取景/游玩画面标签遮脸（BUG-PLAYTEST-007）契约测试。
// 复现几何：play 第三人称/取景机位低（肩高 0.62），远方区域级标签锚定 (x,4,z) 投影落在水平线
// 附近 = 画面中央猫头位置；labels.js dedupeLabels 现接受 playerRect（玩家剪影屏幕保留区，
// 优先级无关：压区即隐），main.js 用控制器脚点 + 一次性缓存剪影尺寸投影 8 角（无逐帧网格遍历）。
// 本测试用桩投影器（纯 DOM-free）复现该画面几何并断言：
//   L1 rectFromWorldBox：投影 8 角 → 外接矩形（含 margin），任一角在相机后方 → null；
//   L2 压玩家剪影的 chip 全部隐藏（区域级/地标优先级也让位），计数 playerHidden；
//   L3 玩家不在画内（playerRect=null）时行为与旧版一致（viewer 页零变化）；
//   L4 有用远景标签保留（不压主角的 chip 不受牵连），去重后 overlaps=0。
// 用法：node tests/play_photo_labels.test.mjs（仓库根）
import { dedupeLabels, rectFromWorldBox } from '../scene-authoring/yuyuan-area/web/labels.js';

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const el = (text) => { const e = { text, style: {}, offsetWidth: 76, offsetHeight: 22 }; return e; };
const rectOfEl = (it) => {
  const w = it.el.offsetWidth, h = it.el.offsetHeight;
  return { x0: it.x - w / 2 - 2, y0: it.y - h * 1.3 - 2, x1: it.x + w / 2 + 2, y1: it.y - h * 0.3 + 2 };
};

// ---------- L1 rectFromWorldBox ----------
{
  // 桩投影器：世界 (x,y,z) → 屏幕，线性映射（x 右，y 上），z>1 表示相机后方
  const project = (x, y, z) => [640 + x * 40, 360 - y * 40, z];
  const rect = rectFromWorldBox(project, [[-2, 0.2, 0], [2, 0.2, 0], [-2, 1.6, 0], [2, 1.6, 0], [-2, 0.2, 0.5], [2, 0.2, 0.5], [-2, 1.6, 0.5], [2, 1.6, 0.5]], 4);
  check(!!rect && Math.abs(rect.x0 - (640 - 80 - 4)) < 1e-6 && Math.abs(rect.y1 - (360 - 8 + 4)) < 1e-6,
    'L1 rectFromWorldBox: screen-space bounds of the projected box (+margin)', rect ? `x0=${rect.x0} y1=${rect.y1}` : 'null');
  const behind = rectFromWorldBox(project, [[-2, 0.2, 0], [2, 0.2, 2.5]], 4);
  check(behind === null, 'L1 rectFromWorldBox: any corner behind the camera → null');
}

// ---------- BUG-007 复现画面：低机位 + 三个远方区域标签 + 猫头 ----------
// 投影模型：镜头在猫后 2.4m、肩高 0.62，注视猫；远方标签锚 (x,4,z) 投影在猫头上方一点。
// 屏幕 1280x720；猫剪影屏幕矩形 ≈ (594..686, 300..420)（画面中央头部区域）。
const W = 1280, H = 720;
const PLAYER_RECT = { x0: 594, y0: 300, x1: 686, y1: 420 };
// 远方标签的屏幕落点（修复前实测：直接糊在猫头，见试玩截图 viewfinder_screen.png）
const items = [
  { el: el('九曲桥'), prio: 0, x: 640, y: 316, dist: 38 },   // 区域级，压头
  { el: el('湖心亭'), prio: 0, x: 700, y: 316, dist: 44 },   // 区域级，压头右缘
  { el: el('大假山（示意）'), prio: 0, x: 633, y: 331, dist: 60 }, // 区域级，压头下缘
  { el: el('和丰楼'), prio: 0, x: 452, y: 272, dist: 30 },   // 区域级，左上远处（不压猫）
];

// ---------- L2 压头标签隐藏 ----------
{
  const shown = items.map((it) => ({ ...it, el: { ...it.el, style: {} } }));
  const r = dedupeLabels(shown, W, H, 12, { playerRect: PLAYER_RECT });
  const hidden = shown.filter((it) => it.el.style.visibility === 'hidden').map((it) => it.el.text);
  const kept = shown.filter((it) => it.el.style.visibility !== 'hidden').map((it) => it.el.text);
  check(r.playerHidden >= 3, 'L2 chips on the player silhouette are hidden (priority-independent)', `playerHidden=${r.playerHidden} hidden=[${hidden}]`);
  check(!hidden.includes('和丰楼'), 'L4 useful distant label survives', `kept=[${kept}]`);
  check(r.overlaps === 0, 'L4 no overlaps after dedupe');
  // 每个隐藏项确实与玩家矩形相交（防误伤）
  const allHiddenIntersect = shown.every((it) => it.el.style.visibility !== 'hidden' ||
    (() => { const q = rectOfEl(it); return !(q.x1 < PLAYER_RECT.x0 || q.x0 > PLAYER_RECT.x1 || q.y1 < PLAYER_RECT.y0 || q.y0 > PLAYER_RECT.y1); })());
  check(allHiddenIntersect, 'L2 every hidden chip truly intersects the player rect');
}

// ---------- L3 无 playerRect 时与旧版一致 ----------
{
  const shown = items.map((it) => ({ ...it, el: { ...it.el, style: {} } }));
  const r = dedupeLabels(shown, W, H, 12, {});
  // 旧版没有玩家保留区：playerHidden 恒为 0（压头的标签至多被普通 overlap 去重隐藏，不区分主体）
  check(r.playerHidden === 0 && r.overlaps === 0 && shown.some((it) => it.el.style.visibility !== 'hidden'),
    'L3 viewer page (no playerRect) keeps legacy behavior', `playerHidden=${r.playerHidden}`);
}

// ---------- L2b 高优先级标签同样让位 + 保留区多标签压力 ----------
{
  const crowd = [];
  for (let k = 0; k < 8; k++) crowd.push({ el: el(`设施${k}`), prio: 2, x: 600 + (k % 4) * 30, y: 330 + Math.floor(k / 4) * 26, dist: 20 + k });
  crowd.push({ el: el('九曲桥'), prio: 0, x: 640, y: 340, dist: 38 });
  const shown = crowd.map((it) => ({ ...it, el: { ...it.el, style: {} } }));
  const r = dedupeLabels(shown, W, H, 12, { playerRect: PLAYER_RECT });
  const jiuzqu = shown.find((it) => it.el.text === '九曲桥');
  check(jiuzqu.el.style.visibility === 'hidden', 'L2b region-level chip on the player yields to the subject');
  check(r.overlaps === 0, 'L2b crowd scene still overlap-free');
}

console.log(`RESULT play_photo_labels ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exitCode = failed === 0 ? 0 : 1;
