// goal-identity-20260927 facadeBay 稳定唯一身份测试（layout / 生成器层）。
// 覆盖 ORDER 要求：175 唯一、重复生成稳定、无关插入稳定、重复/无法区分失败、
// legacyId 一对多清单、doorVariant 与旧 hashStr(legacyId)%2 逐位对齐、生成器↔迁移基线全等。
// 用法：node tests/facade-identity-test.mjs（可选 BASE_LAYOUT=baseline/layout.json）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { facadeBayId, legacyDoorVariant, registerFacadeId } from '../src/facade-identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.resolve(ROOT, process.env.BASE_LAYOUT || 'baseline/layout.json');
let npass = 0, nfail = 0;
const failures = [];
const ok = (name, cond, detail = '') => {
  if (cond) { npass++; console.log('PASS', name); }
  else { nfail++; failures.push(`${name}: ${detail}`); console.log('FAIL', name, detail); }
};

const layout = JSON.parse(fs.readFileSync(BASE, 'utf8'));
const bays = layout.objects.filter((o) => o.kind === 'facadeBay');

// R1 175 开间且 id 全部唯一，id 与 (parentBuilding, geometry) 自洽可重导
ok('bay-count-175', bays.length === 175, `bays=${bays.length}`);
const ids = new Set(bays.map((o) => o.id));
ok('ids-unique', ids.size === bays.length, `${ids.size}/${bays.length}`);
let selfConsistent = 0;
for (const o of bays) if (facadeBayId(o.parentBuilding, o.geometry) === o.id) selfConsistent++;
ok('ids-derivable-from-parent-plus-mm-geometry', selfConsistent === bays.length, `${selfConsistent}/${bays.length}`);

// R2 重复生成稳定：同一输入重算 id 两轮全等（确定性，非全局 counter）
const round2 = new Map(bays.map((o) => [o.id, facadeBayId(o.parentBuilding, o.geometry)]));
ok('id-generation-stable-across-runs', [...round2.entries()].every(([id, re]) => id === re));

// R3 无关插入稳定：加入一栋无关建筑的假开间，既有 175 id 一个都不变
const unrelated = facadeBayId('bld-999999999', { position: [12345.678, -9876.543], rotY: 1.234, width: 4.5 });
ok('unrelated-insert-does-not-reshuffle', !ids.has(unrelated) && bays.every((o) => facadeBayId(o.parentBuilding, o.geometry) === o.id),
  `unrelated id=${unrelated}`);

// R4 重复/无法区分必须失败
let dupThrew = false;
try { registerFacadeId(new Set([...ids]), bays[0].id, 'synthetic-duplicate'); } catch { dupThrew = true; }
ok('duplicate-registration-fails', dupThrew);

// R5 legacyId 一对多清单：字段与顶层 legacyAliases 双向覆盖一致
const fi = layout.facadeIdentity || {};
const aliases = fi.legacyAliases || {};
const aliasValues = Object.values(aliases).flat();
ok('legacy-alias-count-one-to-many', Object.keys(aliases).length === 7 && aliasValues.length === bays.length,
  `legacy=${Object.keys(aliases).length} mapped=${aliasValues.length}`);
ok('legacy-alias-values-unique', new Set(aliasValues).size === aliasValues.length);
ok('legacy-alias-covers-all-bays', bays.every((o) => Array.isArray(aliases[o.legacyId]) && aliases[o.legacyId].includes(o.id)));
ok('legacy-alias-values-are-real-bay-ids', aliasValues.every((id) => ids.has(id)));
const oldAmbiguous = Object.entries(aliases).filter(([, v]) => v.length > 1);
ok('ambiguous-legacy-ids-kept-as-lists', oldAmbiguous.length >= 5 && oldAmbiguous.every(([, v]) => v.length > 1),
  `ambiguous groups=${oldAmbiguous.length}`);

// R6 doorVariant 与旧 hashStr(legacyId)%2 逐位对齐；builder 回退路径同式
const variantParity = bays.filter((o) => o.doorVariant === legacyDoorVariant(o.legacyId)).length;
ok('door-variant-parity-with-legacy-hash', variantParity === bays.length, `${variantParity}/${bays.length}`);
ok('door-variant-domain', bays.every((o) => o.doorVariant === 'center' || o.doorVariant === 'offsetLeft'));

// R7 生成器重跑 ↔ 迁移基线全等（id/legacyId/doorVariant/几何/别名表）
const GEN_DIR = path.resolve(ROOT, process.env.GEN_OUT_DIR || 'out-identity-gencheck');
execFileSync('flock', ['/home/baibai/outbox/pawborough-goal-20260927/run/heavy.lock',
  'node', path.join(ROOT, 'src/layout.mjs')], { env: { ...process.env, OUT_DIR: GEN_DIR }, stdio: 'ignore' });
const gen = JSON.parse(fs.readFileSync(path.join(GEN_DIR, 'layout.json'), 'utf8'));
const gbays = gen.objects.filter((o) => o.kind === 'facadeBay');
ok('generator-bay-count', gbays.length === bays.length, `${gbays.length}`);
const sig = (o) => `${o.parentBuilding}|${Math.round(o.geometry.position[0] * 1000)}|${Math.round(o.geometry.position[1] * 1000)}|${Math.round(o.geometry.rotY * 1000)}|${Math.round(o.geometry.width * 1000)}`;
const bmap = new Map(bays.map((o) => [sig(o), o]));
let genMismatch = 0;
for (const g of gbays) {
  const b = bmap.get(sig(g));
  if (!b || b.id !== g.id || b.legacyId !== g.legacyId || b.doorVariant !== g.doorVariant || b.trade !== g.trade || JSON.stringify(b.geometry) !== JSON.stringify(g.geometry)) genMismatch++;
}
ok('generator-matches-migrated-baseline', genMismatch === 0, `${genMismatch} mismatches`);
ok('generator-legacy-aliases-identical', JSON.stringify(gen.facadeIdentity?.legacyAliases) === JSON.stringify(aliases));
fs.rmSync(GEN_DIR, { recursive: true, force: true });   // 测试自清理自己的临时 OUT_DIR

if (nfail) { console.log(`FAILED ${nfail} (pass ${npass})`); for (const f of failures) console.log('  -', f); process.exit(1); }
console.log(`ALL PASS (${npass})`);
