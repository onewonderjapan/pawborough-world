// wave12-debt D5：方浜放置覆盖「取 4 位小数」的跨语言契约测试（Python / Node 两端逐值相等）。
//
// 审查背景（REVIEW-astra-R5 可选 1）：scripts/fangbang_overrides.py 用 round()（银行家舍入，
// 0.03125 → 0.0312），scripts/fangbang-overrides.mjs 用 toFixed()（另一套舍入，0.03125 → 0.0313）——
// 精确半数（二进可表示的 1/32 类）上两端分歧。两端现已统一为同一规则、同一 double 运算序：
//   「四舍五入到 1e-4、半数远离零」= sign(x) * floor(|x| * 1e4 + 0.5) / 1e4
// （IEEE 754 基本运算确定，两端逐位一致；不再用 round() / toFixed()）。
//
// 断言（期望独立取得，不拿被测输出回填）：
//   1) 同一组输入（含 0.03125 这类精确半数、正负、真实数据量级）两端输出逐值严格相等；
//   2) 精确半数/边界用例的绝对值按十进制手算期望（半数远离零：0.03125→0.0313、-0.03125→-0.0313）；
//   3) 非半数常规值不受影响（1.23456→1.2346）。
// 红（旧实现 round()/toFixed()）：精确半数上两端分歧，本测试 FAIL（工单包 artifacts/d5/RED-old-rounding.log）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { add as addJs } from '../scripts/fangbang-overrides.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond, msg, data) => { if (cond) { console.log('PASS', msg); } else { fails++; console.error('FAIL', msg, data !== undefined ? JSON.stringify(data) : ''); } };

// 独立构造的向量（v, d 各 3 分量）：精确半数（1/32 系）、非半数、负值、零位移、真实量级
const VECTORS = [
  [[0.03125, 1.0, -0.03125], [0.0, 0.0, 0.0]],       // d=0 分量原样返回（不动值）
  [[0.0, 0.0, 0.0], [0.03125, -0.03125, 0.06256]],   // base=0 + 半数位移
  [[1.0, 1.0, 1.0], [0.03125, 0.031249, 0.0313]],    // 半数 / 半数下方 1e-6 / 半数上方
  [[12.53125, -3.46875, 7.25], [0.0, 0.03125, -0.03125]],
  [[1.23456, -1.23456, 2.00005], [0.0, 0.0, 0.0]],   // 常规 5 位小数（d=0 原样返回）
  [[100.00015, 0.00005, -0.00005], [0.0, 0.0, 0.0]],
  [[5.5, 5.5, 5.5], [0.12345, -0.12345, 0.54321]],   // 真实量级叠加
  [[-78.2104, 22.0417, 13.74995], [0.0001, -0.00005, 0.03125]],
];

// Python 端：同一组向量喂给 scripts/fangbang_overrides.py 的 _add（子进程跑，JSON 往返）
const tmp = path.join(os.tmpdir(), `fangbang-round-contract-${process.pid}.json`);
fs.writeFileSync(tmp, JSON.stringify(VECTORS), 'utf8');
const pyOut = execFileSync('python3', ['-X', 'utf8', '-c', [
  'import sys, json',
  "sys.path.insert(0, 'scripts')",
  'import fangbang_overrides as F',
  "vecs = json.load(open(sys.argv[1]))",
  "print(json.dumps([F._add(v, d) for v, d in vecs]))",
].join('\n'), tmp], { cwd: ROOT, encoding: 'utf8' });
const pyResults = JSON.parse(pyOut);
fs.rmSync(tmp, { force: true });
const jsResults = VECTORS.map(([v, d]) => addJs(v, d));

// 1) 两端逐值严格相等（JSON 往返后的 number 与本进程 double 同值）
let nDiff = 0, firstDiff = null;
for (let i = 0; i < VECTORS.length; i++) for (let k = 0; k < 3; k++) {
  const a = pyResults[i][k], b = jsResults[i][k];
  if (!(a === b || (Number.isNaN(a) && Number.isNaN(b)))) { nDiff++; if (!firstDiff) firstDiff = { vec: i, comp: k, py: a, js: b }; }
}
ok(nDiff === 0, `跨语言逐值相等：${VECTORS.length} 组 × 3 分量（含 0.03125 类精确半数）`, { nDiff, firstDiff, pyResults, jsResults });

// 2) 绝对期望（十进制手算，独立于两端实现；半数远离零）
const abs = (i, k, exp, label) => ok(jsResults[i][k] === exp, `绝对期望 ${label} = ${exp}`, jsResults[i][k]);
abs(1, 0, 0.0313, '0 + 0.03125（半数 → 远离零进位）');
abs(1, 1, -0.0313, '0 + (-0.03125)（负半数 → 远离零）');
abs(2, 0, 1.0313, '1 + 0.03125（半数 → 1.0313，旧 round() 给 1.0312）');
abs(2, 1, 1.0312, '1 + 0.031249（半数下方，不进位）');
abs(3, 1, -3.4375, '-3.46875 + 0.03125 = -3.4375（恰 4 位小数，不变）');
abs(3, 2, 7.2188, '7.25 - 0.03125 = 7.21875（半数 → 远离零 7.2188，旧 round() 给 7.2188 但两端不一致）');
abs(6, 0, 5.6235, '5.5 + 0.12345 = 5.62345（十进制半数 → 远离零 5.6235，两端按同一 double 一致）');
abs(7, 2, 13.7812, '13.74995 + 0.03125 = 13.78120（第 5 位是 0，不进位）');

if (fails) { console.error(`fangbang-rounding-contract: ${fails} fail`); process.exit(1); }
console.log('fangbang-rounding-contract: all pass');
