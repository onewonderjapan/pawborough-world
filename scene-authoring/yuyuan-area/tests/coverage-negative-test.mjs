// 对账器负例测试：
// 正例——完整节点集必须对账通过（missing=0）；
// 负例——故意抽掉 1 个对象节点和 1 个实例锚点，对账必须失败并点名缺件。
// 用法：node tests/coverage-negative-test.mjs（需先完成 out-v2/scene-areas.glb 总装）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGlbJson, nodeNamesOf, buildExpectations, reconcile } from '../src/reconcile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));
const procStats = JSON.parse(fs.readFileSync(path.join(OUT, 'procedural-stats.json'), 'utf8'));
const names = nodeNamesOf(parseGlbJson(fs.readFileSync(path.join(OUT, 'scene-areas.glb'))));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, detail); }
};

// 正例
const base = reconcile(buildExpectations(layout, procStats), names);
check('正例: 完整导出对账通过', base.missing.length === 0, `missing=${JSON.stringify(base.missing.slice(0, 5))}`);

// 负例1：抽掉一个对象节点（带屋面的园建 body 节点）
const victimObj = layout.objects.find(o => o.zone === 'garden' && o.kind === 'tower');
const victimName = `${victimObj.zone}|${victimObj.id}|`;
const namesMinusObj = new Set([...names].filter(n => !n.includes(victimName)));
const neg1 = reconcile(buildExpectations(layout, procStats), namesMinusObj);
check('负例1: 抽掉对象节点被点名', neg1.missing.length === 1 && neg1.missing[0].id === victimObj.id,
  JSON.stringify(neg1.missing.slice(0, 3)));

// 负例2：抽掉一个实例锚点（店屋行实例）
const victimInst = layout.instances.find(i => i.id.startsWith('strow-') || i.id.startsWith('temple-'));
const namesMinusInst = new Set([...names].filter(n => n !== victimInst.id && !n.startsWith(victimInst.id + '.')));
const neg2 = reconcile(buildExpectations(layout, procStats), namesMinusInst);
check('负例2: 抽掉实例锚点被点名', neg2.missing.some(m => m.id === `instance:${victimInst.id}`),
  JSON.stringify(neg2.missing.slice(0, 3)));

// 负例3：缺席对象（skipRender 道路）若被渲染必须报 unexpectedPresent
const skipped = layout.objects.find(o => o.skipRender);
const namesPlusSkipped = new Set([...names, `${skipped.zone}|${skipped.id}|road|L0`]);
const neg3 = reconcile(buildExpectations(layout, procStats), namesPlusSkipped);
check('负例3: 应缺席对象在场被点名', neg3.unexpectedPresent.length === 1 && neg3.unexpectedPresent[0].id === skipped.id,
  JSON.stringify(neg3.unexpectedPresent));

console.log(`\ncoverage-negative-test: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
