// Contract test for Pawborough static runtime export (current catalog)
// Run: node tests/play_static_export.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const sceneRoot = resolve(repoRoot, 'scene-authoring/yuyuan-area');

const targetTrialDir = mkdtempSync(join(tmpdir(), 'pawborough-export-test-'));
let testOutputDir = targetTrialDir;

// 1. Run actual export
try {
  execFileSync('python3', ['-X', 'utf8', 'tools/export_play_site.py', '--output', testOutputDir], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
} catch (err) {
  // If target directory is read-only in this sandbox environment, fallback to /tmp
  testOutputDir = mkdtempSync(join(tmpdir(), 'pawborough-export-fallback-'));
  execFileSync('python3', ['-X', 'utf8', 'tools/export_play_site.py', '--output', testOutputDir], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

function verifyExportDir(outDir) {
  const artifactsDir = join(outDir, 'artifacts');
  const siteDir = join(outDir, 'site');

  assert.ok(existsSync(join(artifactsDir, 'PUBLIC-MANIFEST.json')), 'PUBLIC-MANIFEST.json exists');
  assert.ok(existsSync(join(artifactsDir, 'HEADERS.json')), 'HEADERS.json exists');
  assert.ok(existsSync(join(artifactsDir, 'RESOURCE-BUDGETS.json')), 'RESOURCE-BUDGETS.json exists');

  const manifest = JSON.parse(readFileSync(join(artifactsDir, 'PUBLIC-MANIFEST.json'), 'utf8'));
  const headers = JSON.parse(readFileSync(join(artifactsDir, 'HEADERS.json'), 'utf8'));
  const budgets = JSON.parse(readFileSync(join(artifactsDir, 'RESOURCE-BUDGETS.json'), 'utf8'));

  assert.match(manifest.version, /^\d{8}-main-[0-9a-f]{8}$/, 'Version matches format YYYYMMDD-main-HEAD8');
  assert.equal(manifest.entry, '/', 'Manifest entry is /');
  assert.ok(Array.isArray(manifest.files), 'Manifest files is an array');

  const versionPrefix = `versions/${manifest.version}`;
  const versionDir = join(siteDir, versionPrefix);
  assert.ok(existsSync(versionDir), 'Version directory exists on disk');

  // 2. Validate manifest sha/bytes/content types/cache receipts against disk
  let totalBytes = 0;
  for (const file of manifest.files) {
    const fullPath = join(siteDir, file.path);
    assert.ok(existsSync(fullPath), `File referenced in manifest exists on disk: ${file.path}`);
    const stat = statSync(fullPath);
    assert.equal(file.bytes, stat.size, `File size matches for ${file.path}`);
    totalBytes += file.bytes;

    const content = readFileSync(fullPath);
    const sha = createHash('sha256').update(content).digest('hex');
    assert.equal(file.sha256, sha, `SHA256 matches for ${file.path}`);

    if (file.path.startsWith('versions/')) {
      assert.equal(file.cacheControl, 'public,max-age=31536000,immutable', `Cache control for versioned file ${file.path}`);
      assert.ok(file.path.startsWith(versionPrefix + '/'), `Versioned file belongs to current version: ${file.path}`);
    } else {
      assert.equal(file.cacheControl, 'no-cache,max-age=0,must-revalidate', `Cache control for root file ${file.path}`);
    }

    if (file.path.endsWith('.glb')) assert.equal(file.contentType, 'model/gltf-binary');
    if (file.path.endsWith('.json')) assert.equal(file.contentType, 'application/json');
    if (file.path.endsWith('.png')) assert.equal(file.contentType, 'image/png');
    if (file.path.endsWith('.js') || file.path.endsWith('.mjs')) assert.equal(file.contentType, 'text/javascript');
    if (file.path.endsWith('.html')) assert.equal(file.contentType, 'text/html');
  }
  assert.equal(manifest.bytes, totalBytes, 'Total manifest bytes equals sum of individual files');

  // 3. Every current model and thumbnail and 5 new JSONs included
  const foodsManifest = JSON.parse(readFileSync(join(sceneRoot, 'inputs/play-foods.json'), 'utf8'));
  const sourceCatalog = JSON.parse(readFileSync(join(sceneRoot, 'inputs/food-catalog.json'), 'utf8'));
  assert.ok(sourceCatalog.foods.every(f => foodsManifest.foods.some(a => a.id === f.assetId)), 'Every catalog food has a declared model');

  const manifestPathSet = new Set(manifest.files.map(f => f.path));

  for (const food of foodsManifest.foods) {
    const expectedModel = `${versionPrefix}/${food.path}`;
    assert.ok(manifestPathSet.has(expectedModel), `Manifest includes model: ${expectedModel}`);
    if (food.thumbnail) {
      const expectedThumb = `${versionPrefix}/${food.thumbnail.path}`;
      assert.ok(manifestPathSet.has(expectedThumb), `Manifest includes thumbnail: ${expectedThumb}`);
    }
  }

  const newJsonNames = [
    'food-catalog.json',
    'play-vendors.json',
    'food-pose-profiles.json',
    'world-art-style.json',
    'street-life.json',
  ];
  for (const name of newJsonNames) {
    const expectedJson = `${versionPrefix}/inputs/${name}`;
    assert.ok(manifestPathSet.has(expectedJson), `Manifest includes new JSON: ${expectedJson}`);
  }

  // 4. Validate exported JSON content & path prefix & stripped private fields
  const exportedFoods = JSON.parse(readFileSync(join(versionDir, 'inputs/play-foods.json'), 'utf8'));
  assert.equal(exportedFoods.foods.length, foodsManifest.foods.length, 'Every current declared food asset is exported');
  for (const f of exportedFoods.foods) {
    assert.ok(f.path.startsWith(`${versionPrefix}/`), `Food path prefixed: ${f.path}`);
    assert.ok(!f.path.startsWith('/'), `Food path has no leading slash: ${f.path}`);
    assert.ok(existsSync(join(siteDir, f.path)), `Food path resolves to actual file: ${f.path}`);
    assert.ok(!('source' in f), `Food has no source: ${f.id}`);
    assert.ok(!('note' in f), `Food has no note: ${f.id}`);
    assert.ok(!('sourcePath' in f), `Food has no sourcePath: ${f.id}`);
    assert.ok(!('originalPath' in f), `Food has no originalPath: ${f.id}`);
    if (f.thumbnail) {
      assert.ok(f.thumbnail.path.startsWith(`${versionPrefix}/`), `Thumbnail path prefixed: ${f.thumbnail.path}`);
      assert.ok(!f.thumbnail.path.startsWith('/'), `Thumbnail path has no leading slash: ${f.thumbnail.path}`);
      assert.ok(existsSync(join(siteDir, f.thumbnail.path)), `Thumbnail path resolves to actual file: ${f.thumbnail.path}`);
      assert.ok(!('note' in f.thumbnail), `Thumbnail has no note: ${f.id}`);
    }
  }

  const exportedCatalog = JSON.parse(readFileSync(join(versionDir, 'inputs/food-catalog.json'), 'utf8'));
  assert.equal(exportedCatalog.foods.length, sourceCatalog.foods.length, 'Exported catalog retains every current food');
  assert.deepEqual(exportedCatalog.regions, sourceCatalog.regions, 'Region metadata survives static export');
  for (const f of exportedCatalog.foods) {
    assert.ok(typeof f.assetId === 'string' && !f.assetId.includes('/'), `assetId is logical ID: ${f.assetId}`);
    assert.ok(typeof f.chapterId === 'string' && !f.chapterId.includes('/'), `chapterId is logical ID: ${f.chapterId}`);
    assert.ok(typeof f.poseProfile === 'string' && !f.poseProfile.includes('/'), `poseProfile is logical ID: ${f.poseProfile}`);
    assert.ok(!('note' in f), `Catalog food has no note: ${f.id}`);
    if (f.sourceUrls) {
      assert.ok(Array.isArray(f.sourceUrls), 'Official sourceUrls retained');
    }
  }

  const exportedCharacter = JSON.parse(readFileSync(join(versionDir, 'inputs/play-character.json'), 'utf8'));
  assert.ok(exportedCharacter.path.startsWith(`${versionPrefix}/`), 'Character path prefixed');
  assert.ok(existsSync(join(siteDir, exportedCharacter.path)), 'Character GLB exists');
  assert.ok(!('sourceRepository' in exportedCharacter), 'sourceRepository stripped');
  assert.ok(!('sourceHead' in exportedCharacter), 'sourceHead stripped');
  assert.ok(!('sourceArtifact' in exportedCharacter), 'sourceArtifact stripped');
  assert.ok(!('note' in exportedCharacter), 'note stripped');
  if (exportedCharacter.runtimeFoodRig) {
    assert.ok(!('method' in exportedCharacter.runtimeFoodRig), 'runtimeFoodRig.method private doc pointer stripped');
  }

  const exportedStyle = JSON.parse(readFileSync(join(versionDir, 'inputs/world-art-style.json'), 'utf8'));
  assert.ok(!('note' in exportedStyle), 'world-art-style note stripped');
  assert.ok(Array.isArray(exportedStyle.families), 'families preserved');

  const exportedStreetLife = JSON.parse(readFileSync(join(versionDir, 'inputs/street-life.json'), 'utf8'));
  assert.ok(!('placement' in exportedStreetLife), 'street-life placement technical note stripped');
  assert.ok(Array.isArray(exportedStreetLife.items), 'street-life items preserved');
  for (const item of exportedStreetLife.items) {
    if (item.sourceId) {
      assert.ok(typeof item.sourceId === 'string', 'sourceId logical asset ID preserved');
    }
  }

  const exportedVendors = JSON.parse(readFileSync(join(versionDir, 'inputs/play-vendors.json'), 'utf8'));
  assert.ok(Array.isArray(exportedVendors.vendors), 'vendors array preserved');
  for (const v of exportedVendors.vendors) {
    if (v.position) {
      assert.ok(v.position.every(Number.isFinite), 'vendor position is finite numbers');
    }
  }

  // 5. Assert no private paths, credentials, source archives, or tests in PUBLIC manifest
  for (const f of manifest.files) {
    assert.ok(!f.path.includes('.git'), `No .git in manifest: ${f.path}`);
    assert.ok(!f.path.includes('/test/') && !f.path.includes('.test.'), `No test in manifest: ${f.path}`);
    assert.ok(!f.path.includes('credentials'), `No credentials in manifest: ${f.path}`);
    assert.ok(!f.path.includes('/home/'), `No /home/ in manifest path: ${f.path}`);
  }

  // Also check no /home/ or credentials in any JSON file
  for (const f of manifest.files) {
    if (f.path.endsWith('.json')) {
      const txt = readFileSync(join(siteDir, f.path), 'utf8');
      assert.ok(!txt.includes('/home/'), `No /home/ in JSON content: ${f.path}`);
      assert.ok(!txt.includes('AWS_SECRET') && !txt.includes('aws_access_key_id'), `No AWS credentials in ${f.path}`);
    }
  }

  // 6. Original GLB bytes SHA unchanged
  for (const food of foodsManifest.foods) {
    const origBytes = readFileSync(join(sceneRoot, food.path));
    const expBytes = readFileSync(join(siteDir, versionPrefix, food.path));
    assert.equal(createHash('sha256').update(expBytes).digest('hex'), food.sha256, `Food GLB sha unchanged: ${food.id}`);
    assert.equal(expBytes.length, origBytes.length, `Food GLB bytes unchanged: ${food.id}`);
  }
  for (const f of ['resources/vehicles/play-bicycle.glb', 'resources/characters/gray-cat/character.glb', 'resources/play-facades/play-closed-facades.glb']) {
    const orig = readFileSync(join(sceneRoot, f));
    const exp = readFileSync(join(siteDir, versionPrefix, f));
    assert.equal(orig.compare(exp), 0, `Original GLB unchanged: ${f}`);
  }

  // 7. Root entry defaults play and not bare-root resource fetch; importmap alias preserved
  const html = readFileSync(join(siteDir, 'index.html'), 'utf8');
  assert.ok(html.includes("publicEntry.searchParams.set('play','1')"), 'index.html defaults play=1');
  assert.ok(html.includes(`"/src/world/":"/${versionPrefix}/vendor-src/world/"`) || html.includes(`"/src/world/": "/${versionPrefix}/vendor-src/world/"`), 'importmap resolves /src/world/ to versioned vendor-src');
  assert.ok(!html.includes('href="/web/'), 'No bare-root href');
  assert.ok(!html.includes('src="/web/'), 'No bare-root src');

  // 8. CSP script hashes match entry/importmap/inline
  const csp = headers['Content-Security-Policy'];
  assert.ok(csp, 'Content-Security-Policy header present');
  const scriptMatches = [...html.matchAll(/<script(?:\s[^>]*)?>(.*?)<\/script>/gs)];
  assert.ok(scriptMatches.length >= 2, 'Found at least 2 inline scripts in index.html');
  for (let i = 0; i < scriptMatches.length; i++) {
    const content = scriptMatches[i][1];
    const hash = "'sha256-" + createHash('sha256').update(content, 'utf8').digest('base64') + "'";
    assert.ok(csp.includes(hash), `CSP contains hash for script ${i}: ${hash}`);
  }

  // 9. Resource budgets reported in artifacts
  assert.ok(budgets.models, 'budgets.models present');
  assert.ok(budgets.thumbnails, 'budgets.thumbnails present');
  const additionalModels = foodsManifest.foods.filter(f => !['xiaolongbao','congyoubing','youdunzi'].includes(f.id));
  assert.equal(budgets.models.count, additionalModels.length, 'Budget includes every additional model');
  assert.equal(budgets.models.bytes, additionalModels.reduce((sum, f) => sum + f.bytes, 0), 'All additional model bytes accounted');
  const declaredThumbs=exportedFoods.foods.filter(f=>f.thumbnail);
  assert.equal(budgets.thumbnails.count,declaredThumbs.length,'Budget includes every current thumbnail');
  assert.equal(budgets.thumbnails.bytes,declaredThumbs.reduce((sum,f)=>sum+f.thumbnail.bytes,0),'All thumbnail bytes accounted');
  assert.ok(budgets.models.withinBudget, `Models within budget (${budgets.models.bytes} <= ${budgets.models.limitBytes})`);
  assert.ok(budgets.thumbnails.withinBudget, `Thumbnails within budget (${budgets.thumbnails.bytes} <= ${budgets.thumbnails.limitBytes})`);

  // 10. Old version tree not listed for new upload
  for (const file of manifest.files) {
    if (file.path.startsWith('versions/')) {
      assert.ok(file.path.startsWith(`${versionPrefix}/`), `Old version tree excluded from manifest: ${file.path}`);
    }
  }
}

// Run verification on testOutputDir
verifyExportDir(testOutputDir);

// Also verify targetTrialDir if it exists and differs
if (testOutputDir !== targetTrialDir && existsSync(join(targetTrialDir, 'artifacts/PUBLIC-MANIFEST.json'))) {
  verifyExportDir(targetTrialDir);
}

// Explicit test of old version exclusion in a dedicated temp location
{
  const tempDir = mkdtempSync(join(tmpdir(), 'pawborough-old-version-test-'));
  execFileSync('python3', ['-X', 'utf8', 'tools/export_play_site.py', '--output', tempDir], { cwd: repoRoot, stdio: 'pipe' });
  const dummyOldVer = 'versions/20261001-main-oldver00';
  const dummyFile = join(tempDir, 'site', dummyOldVer, 'old.json');
  mkdirSync(dirname(dummyFile), { recursive: true });
  writeFileSync(dummyFile, '{"old": true}', 'utf8');

  // Re-export
  execFileSync('python3', ['-X', 'utf8', 'tools/export_play_site.py', '--output', tempDir], { cwd: repoRoot, stdio: 'pipe' });
  const manifest = JSON.parse(readFileSync(join(tempDir, 'artifacts/PUBLIC-MANIFEST.json'), 'utf8'));
  assert.ok(!manifest.files.some(f => f.path.startsWith(dummyOldVer)), 'Old version directory is not listed in manifest after re-export');
  assert.ok(existsSync(dummyFile), 'Old version directory was not deleted');
}

console.log('PLAY_STATIC_EXPORT PASS: Manifest, SHAs, current foods/thumbnails, 5 new JSONs, importmap, CSP, budgets, and clean boundaries verified');
