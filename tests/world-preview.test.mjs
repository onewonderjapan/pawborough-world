// world-playable-night 20260920 — homepage / entry-mapping contract tests.
// These pin the PREVIEW data layer to the real delivered route.json and to the
// game's own anchor derivation (src/player/entryAnchors.js), plus the shared
// load-error wording and the URL contract with the game page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATASET_ID, GAME_URL_BASE, derivePreviewAnchors, gameUrl } from '../src/worldPreview/entryData.js';
import { deriveEntryAnchors } from '../src/player/entryAnchors.js';
import { resourceKind, describeLoadError } from '../src/worldPreview/loadErrorText.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const route = JSON.parse(await readFile(resolve(root, `world/${DATASET_ID}/route.json`), 'utf8'));

test('homepage start points match the game anchor derivation on the real route', () => {
  const preview = derivePreviewAnchors(route);
  const game = deriveEntryAnchors({ route });
  // same ID SET (display order on the homepage is the plan's 主街、A弄、B弄、庙前)
  assert.deepEqual([...preview.map((a) => a.id)].sort(), [...game.map((a) => a.id)].sort());
  for (const g of game) {
    const p = preview.find((a) => a.id === g.id);
    assert.ok(p, `preview missing ${g.id}`);
    assert.deepEqual(p.position, g.position, `${g.id} position`);
    assert.ok(Math.abs(p.yaw - (g.yaw ?? 0)) < 1e-12, `${g.id} yaw`);
  }
});

test('start point order and ids are the four real anchors (no invented ones)', () => {
  const ids = derivePreviewAnchors(route).map((a) => a.id);
  assert.deepEqual(ids, ['mainStreet', 'laneA', 'laneB', 'templeFront']);
});

test('anchor positions come from route data verbatim', () => {
  const [mainStreet, laneA, laneB, templeFront] = derivePreviewAnchors(route);
  assert.deepEqual(mainStreet.position, route.entries.bridgeStart.slice());
  assert.deepEqual(templeFront.position, route.entries.shanmenThreshold.slice());
  assert.deepEqual(laneA.position, route.laneAExcursion[0].slice());
  assert.deepEqual(laneB.position, route.laneBExcursion[0].slice());
});

test('degraded routes drop their anchor instead of guessing coordinates', () => {
  const partial = { entries: { bridgeStart: route.entries.bridgeStart }, mainStreet: route.mainStreet };
  const ids = derivePreviewAnchors(partial).map((a) => a.id);
  assert.deepEqual(ids, ['mainStreet']);
  assert.deepEqual(derivePreviewAnchors({}).map((a) => a.id), []);
});

test('game URL: relative, dataset pinned, default config carries no skins/props', () => {
  const u = gameUrl('mainStreet');
  assert.ok(!u.startsWith('/'), 'must be relative');
  assert.ok(u.startsWith('fangbang.html?'), 'must target the game page');
  assert.ok(u.includes('ds=fangbang-temple-v7'), 'must pin the v7 dataset');
  assert.ok(u.includes('entry=mainStreet'), 'must carry the entry');
  assert.ok(!/skins|props/.test(u), 'default config must stay plain');
  const all = new URLSearchParams(gameUrl('laneB', 'allOn').split('?')[1]);
  assert.equal(all.get('skins'), '1');
  assert.equal(all.get('props'), '1');
  assert.equal(all.get('entry'), 'laneB');
  const plain = new URLSearchParams(gameUrl('').split('?')[1]);
  assert.ok(!plain.has('entry'), 'empty entry falls back to the game default, not an empty param');
});

test('every homepage entry id is accepted by the game page contract', () => {
  // the game accepts exactly ids that deriveEntryAnchors emits (then re-validates
  // against physics); the homepage must only ever link those
  const accepted = new Set(deriveEntryAnchors({ route }).map((a) => a.id));
  for (const id of derivePreviewAnchors(route).map((a) => a.id))
    assert.ok(accepted.has(id), `${id} must be a real derived anchor`);
});

test('load errors name the resource type and path', () => {
  assert.equal(resourceKind('a/b.glb'), '三维模型');
  assert.equal(resourceKind('world/x/route.json'), '数据清单');
  assert.equal(resourceKind('tex/albedo.png'), '纹理图片');
  assert.equal(resourceKind('rapier.wasm'), '物理引擎');
  assert.equal(resourceKind('misc.bin'), '资源');
  assert.equal(
    describeLoadError(new Error('./world/fangbang-temple-v7/route.json HTTP 404')),
    '加载数据清单失败（404）：./world/fangbang-temple-v7/route.json');
  assert.equal(describeLoadError(new Error('boom')), 'boom');
});

test('dataset id used by homepage and game page stays fangbang-temple-v7', async () => {
  assert.equal(DATASET_ID, 'fangbang-temple-v7');
  assert.equal(GAME_URL_BASE, 'fangbang.html?ds=fangbang-temple-v7');
  const main = await readFile(resolve(root, 'src/fangbangMain.js'), 'utf8');
  assert.ok(main.includes("PARAMS.get('entry')"), 'game page must read the entry param');
});
