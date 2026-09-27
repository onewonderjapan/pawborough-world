// goal-identity-20260927：baseline/layout.json 的 facadeBay 身份一次性迁移（幂等）。
// 只改两类元数据：每个 facadeBay 的 {id, legacyId, doorVariant} + 顶层 facadeIdentity 对账块；
// 其余内容字节语义不变（写入格式 JSON.stringify(d,null,1)+'\n'，与原文件逐字节同构，先自检往返）。
// 用法：node scripts/migrate-facade-identity.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { facadeBayId, legacyDoorVariant, registerFacadeId } from '../src/facade-identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.resolve(ROOT, process.env.BASE_LAYOUT || 'baseline/layout.json');
const dry = process.argv.includes('--check');

const raw = fs.readFileSync(BASE);
const before = raw.toString('utf8');
// 往返自检：确认本脚本的序列化与文件现有格式同构（除目标字段外不会引入任何字节差异）
if (JSON.stringify(JSON.parse(before), null, 1) + '\n' !== before) {
  console.error(`FAIL ${BASE}: JSON round-trip not byte-identical — format drifted, refusing to migrate`);
  process.exit(1);
}
const d = JSON.parse(before);
const bays = d.objects.filter((o) => o.kind === 'facadeBay');
const used = new Set();
const aliases = {};
let renamed = 0, already = 0;
for (const o of bays) {
  const newId = facadeBayId(o.parentBuilding, o.geometry);
  const legacy = o.legacyId ?? o.id;
  const variant = o.doorVariant ?? legacyDoorVariant(o.id);
  if (o.legacyId && o.doorVariant && o.id === newId) { already++; }
  else renamed++;
  registerFacadeId(used, newId, `parent=${o.parentBuilding} legacy=${legacy}`);
  (aliases[legacy] ||= []).push(newId);
  o.id = newId;
  o.legacyId = legacy;
  o.doorVariant = variant;
}
// 顶层 facadeIdentity 对账块：内容确定性 → 重复运行字节不变（幂等）
d.facadeIdentity = {
  rule: 'id = facade-{parentShort}-{base36(fnv1a32(parentBuilding|px|pz|rYm|wm))}; px/pz=position mm, rY=rotY milliradians, wm=width mm; derived from parent + own geometry only so unrelated insertions never reshuffle ids; duplicates/indistinguishable bays fail at migration/generation time',
  doorVariant: "center = door centered (hashStr(legacyId)%2==0); offsetLeft = door offset -w*0.22; value derived from the legacy counter id, byte-parity with the frozen baseline visuals; buildFacadeBay reads this metadata first, un-migrated files fall back to legacy hashStr(id)",
  totals: { bays: bays.length, legacyIds: Object.keys(aliases).length },
  legacyAliases: aliases,
};

const after = JSON.stringify(d, null, 1) + '\n';
const legacyCount = Object.keys(aliases).length;
console.log(`facade-identity migration: ${bays.length} bays, ${legacyCount} legacy ids, ${renamed} renamed, ${already} already migrated`);
if (dry) {
  console.log('--check: not written');
} else {
  fs.writeFileSync(BASE, after);
  console.log(`written: ${BASE} (${Buffer.byteLength(before)} -> ${Buffer.byteLength(after)} bytes)`);
}
