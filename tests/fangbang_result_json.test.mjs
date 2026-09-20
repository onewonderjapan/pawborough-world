// Player-experience batch A regression #7 — the lanes-construction RESULT.json
// must be VALID JSON (it shipped with the pasted JS expression
// `x3.mainStreetRouteCheck.pass` in place of a value), its
// mainStreetRouteCheck must match what x3-live-report.json actually recorded,
// and the other facts of the report (budget overage included) stay intact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = async (p) => readFile(resolve(root, p), 'utf8');

test('RESULT.json parses as JSON (no pasted code expressions)', async () => {
  const raw = await read('artifacts/lanes-construction/RESULT.json');
  assert.ok(!/[a-zA-Z_][\w.]*\.\w+\s*,?\s*$/.test(raw.split('\n').find((l) => l.includes('mainStreetRouteCheck')) ?? ''), 'no dotted expression left in place of a value');
  const j = JSON.parse(raw);   // throws on any syntax error
  assert.equal(typeof j, 'object');
});

test('mainStreetRouteCheck equals the x3-live-report measured value', async () => {
  const j = JSON.parse(await read('artifacts/lanes-construction/RESULT.json'));
  const x3 = JSON.parse(await read('artifacts/lanes-construction/x3-live-report.json'));
  assert.equal(j.stages.X.liveVerification.mainStreetRouteCheck, x3.mainStreetRouteCheck.pass,
    'the value is READ from the live report, not hand-written');
});

test('the report keeps its other facts: budget overage, protections, notDone', async () => {
  const j = JSON.parse(await read('artifacts/lanes-construction/RESULT.json'));
  assert.equal(j.ownerAdopted, false);
  assert.equal(j.status, 'delivered_for_lead_review');
  assert.equal(j.budgets.fullSceneCandidate.pass, false, 'the 0.44% overage record survives');
  assert.equal(j.budgets.fullSceneCandidate.overBy, 3049);
  assert.ok(j.notDone.some((s) => s.includes('700k')));
  assert.ok(Array.isArray(j.protections.frozenUntouched) && j.protections.frozenUntouched.length > 0);
  assert.equal(j.entry.v5Candidate, 'fangbang.html?ds=fangbang-temple-v5');
});
