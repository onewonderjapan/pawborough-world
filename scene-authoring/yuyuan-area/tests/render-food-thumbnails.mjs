// Render original-food atlas thumbnails from actual unchanged models.
// Verified on installed Google Chrome with actual hardware GPU (NVIDIA GB10).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..', '..');

const base = process.env.BASE ?? 'http://127.0.0.1:5613/';
const outDir = process.env.OUT_DIR ?? '/home/baibai/outbox/pawborough-national-snacks-20261002/legacy-thumbnails';
await fs.mkdir(outDir, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
};

const fixtureHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: transparent; overflow: hidden; width: 256px; height: 256px; }
#c { display: block; width: 256px; height: 256px; }
</style>
<script type="importmap">
{
  "imports": {
    "/src/world/": "/vendor-src/world/",
    "three": "/node_modules/three/build/three.module.js",
    "three/addons/": "/node_modules/three/examples/jsm/",
    "@dimforge/rapier3d-compat": "/vendor/@dimforge/rapier3d-compat/rapier.mjs"
  }
}
</script>
</head>
<body>
<canvas id="c" width="256" height="256"></canvas>
</body>
</html>`;

const playFoodsRaw = await fs.readFile(path.join(ROOT, 'inputs/play-foods.json'), 'utf8');
const playFoods = JSON.parse(playFoodsRaw);

const targetFoodIds = ['xiaolongbao', 'congyoubing', 'youdunzi'];
const targetDefs = targetFoodIds.map(id => {
  const def = playFoods.foods.find(f => f.id === id);
  assert.ok(def, `inputs/play-foods.json missing food definition for ${id}`);
  return def;
});

// Verify input source GLBs on disk before browser execution
for (const def of targetDefs) {
  const diskBuf = await fs.readFile(path.join(ROOT, def.path));
  const diskSha = crypto.createHash('sha256').update(diskBuf).digest('hex');
  assert.equal(diskSha, def.sha256, `${def.id}: input GLB sha256 mismatch against inputs/play-foods.json`);
  assert.equal(diskBuf.length, def.bytes, `${def.id}: input GLB byte size mismatch`);
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--use-gl=angle',
    '--use-angle=gl',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
  await page.bringToFront();

  // In-process fixture routing to avoid full world load and bypass external server dependencies
  await page.route('**/*', async route => {
    const reqUrl = route.request().url();
    const url = new URL(reqUrl);
    const p = url.pathname;

    if (p === '/tests/thumbnail-fixture.html') {
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fixtureHtml,
      });
    }

    let filePath;
    if (p.startsWith('/vendor/')) {
      filePath = path.join(REPO, 'node_modules', p.slice('/vendor/'.length));
    } else if (p.startsWith('/vendor-src/')) {
      filePath = path.join(REPO, 'src', p.slice('/vendor-src/'.length));
    } else if (p.startsWith('/node_modules/')) {
      filePath = path.join(REPO, 'node_modules', p.slice('/node_modules/'.length));
    } else {
      filePath = path.join(ROOT, p.startsWith('/') ? p.slice(1) : p);
    }

    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';
      return route.fulfill({ status: 200, contentType, body: data });
    } catch {
      return route.fulfill({ status: 404, body: 'Not found: ' + p });
    }
  });

  const fixtureUrl = new URL('/tests/thumbnail-fixture.html', base).href;
  await page.goto(fixtureUrl);
  await page.waitForSelector('#c');

  // Verify GPU renderer hardware string
  const detectedRenderer = await page.evaluate(() => {
    const canvas = document.getElementById('c');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  });
  assert.ok(detectedRenderer, 'UNMASKED_RENDERER_WEBGL unavailable');
  assert.match(detectedRenderer, /NVIDIA.*GB10/, `Expected NVIDIA GB10 renderer, got: ${detectedRenderer}`);

  const manifest = {
    schemaVersion: 1,
    milestone: 'legacy-thumbnails',
    generatedAt: new Date().toISOString(),
    renderer: detectedRenderer,
    frame: {
      width: 256,
      height: 256,
      devicePixelRatio: 1,
      occupancyTarget: 0.75,
      camera: 'OrthographicCamera_3/4_view',
      toneMapping: 'NeutralToneMapping',
      outputColorSpace: 'SRGBColorSpace',
      clearColor: '0x000000_alpha_0',
    },
    foods: {},
    limits: [
      'Pure 3D render art for legacy atlas thumbnails; original GLB models and photos unchanged.',
      'Rendered using headless Google Chrome with hardware GPU (NVIDIA GB10 ANGLE/OpenGL 4.5).',
      'No gameplay route claimed; root updates manifest after view and adoption.',
    ],
  };

  for (const def of targetDefs) {
    const foodId = def.id;
    const renderResult = await page.evaluate(async ({ id, glbPath, expectedSha }) => {
      const [THREE, { GLTFLoader }, { makeFoodEntry, FoodCatalog }] = await Promise.all([
        import('three'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('/web/play/foods.js'),
      ]);

      const canvas = document.getElementById('c');
      const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, alpha: true }) ||
                 canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: true });

      const renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
      });
      renderer.setSize(256, 256, false);
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x000000, 0); // transparent clear alpha 0
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1.0;

      const scene = new THREE.Scene();

      // Lighting: softcreamhemi + keylight + warmfill
      const hemi = new THREE.HemisphereLight(0xfff8ee, 0x6e6255, 1.25);
      hemi.position.set(0, 5, 0);
      scene.add(hemi);

      const keyLight = new THREE.DirectionalLight(0xfffaea, 2.2);
      keyLight.position.set(2.5, 4.0, 3.5);
      scene.add(keyLight);

      const warmFill = new THREE.DirectionalLight(0xffe2bf, 1.2);
      warmFill.position.set(-3.0, 2.0, 2.0);
      scene.add(warmFill);

      const rimLight = new THREE.DirectionalLight(0xfffaed, 0.7);
      rimLight.position.set(-0.5, 3.0, -3.0);
      scene.add(rimLight);

      // Load actual GLB and verify runtime SHA
      const res = await fetch(glbPath);
      if (!res.ok) throw new Error(`Fetch ${glbPath} returned ${res.status}`);
      const buf = await res.arrayBuffer();
      if (crypto?.subtle) {
        const digest = await crypto.subtle.digest('SHA-256', buf);
        const sha = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
        if (sha !== expectedSha) throw new Error(`${id}: runtime SHA mismatch`);
      }

      const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));

      // makeFoodEntry hides _LOD1 and _LOD2, retains LOD0 and computes cupScale
      const entry = makeFoodEntry({ id, poseProfile: 'cupped' }, gltf.scene);
      const catalog = new FoodCatalog(new Map([[id, entry]]));
      const display = catalog.makeDisplay(id);
      scene.add(display);
      display.updateMatrixWorld(true);

      // Real Box3 bounding box
      const box = new THREE.Box3().setFromObject(display);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);

      // Camera 3/4 view: (x front diagonal, y above, z +front)
      const camDir = new THREE.Vector3(1.0, 0.85, 1.2).normalize();
      const dist = 5.0;

      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
      camera.position.copy(center).addScaledVector(camDir, dist);
      camera.lookAt(center);
      camera.updateMatrixWorld(true);

      // Project the 8 bounding box corners into camera coordinate space
      const corners = [
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.min.x, box.min.y, box.max.z),
        new THREE.Vector3(box.min.x, box.max.y, box.min.z),
        new THREE.Vector3(box.min.x, box.max.y, box.max.z),
        new THREE.Vector3(box.max.x, box.min.y, box.min.z),
        new THREE.Vector3(box.max.x, box.min.y, box.max.z),
        new THREE.Vector3(box.max.x, box.max.y, box.min.z),
        new THREE.Vector3(box.max.x, box.max.y, box.max.z),
      ];

      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (const c of corners) {
        c.applyMatrix4(camera.matrixWorldInverse);
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
      }

      const spanX = maxX - minX;
      const spanY = maxY - minY;
      // Frame so meal occupies exactly 75% of the viewport; lowest point not cut
      const maxSpan = Math.max(spanX, spanY);
      const viewSize = maxSpan / 0.75;
      const halfView = viewSize / 2;
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;

      camera.left = midX - halfView;
      camera.right = midX + halfView;
      camera.bottom = midY - halfView;
      camera.top = midY + halfView;
      camera.near = 0.1;
      camera.far = dist * 2;
      camera.updateProjectionMatrix();

      // Render
      renderer.render(scene, camera);

      // Read pixels to assert nonempty alpha
      const pixels = new Uint8Array(256 * 256 * 4);
      gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let nonEmptyPixels = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] > 0) nonEmptyPixels++;
      }

      const dataUrl = canvas.toDataURL('image/png');

      // Dispose only owned resources
      scene.remove(display);
      catalog.dispose();
      display.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
            if (m[k]?.isTexture) m[k].dispose();
          }
          m.dispose();
        }
      });
      hemi.dispose?.();
      keyLight.dispose?.();
      warmFill.dispose?.();
      rimLight.dispose?.();
      renderer.dispose();

      return {
        id,
        nonEmptyPixels,
        cupScale: entry.cupScale,
        modelDims: {
          min: [Number(box.min.x.toFixed(4)), Number(box.min.y.toFixed(4)), Number(box.min.z.toFixed(4))],
          max: [Number(box.max.x.toFixed(4)), Number(box.max.y.toFixed(4)), Number(box.max.z.toFixed(4))],
          size: [Number(size.x.toFixed(4)), Number(size.y.toFixed(4)), Number(size.z.toFixed(4))],
        },
        dataUrl,
      };
    }, { id: foodId, glbPath: '/' + def.path, expectedSha: def.sha256 });

    assert.ok(renderResult.nonEmptyPixels > 1000, `${foodId} rendered empty pixels: ${renderResult.nonEmptyPixels}`);

    const base64Data = renderResult.dataUrl.replace(/^data:image\/png;base64,/, '');
    const pngBuf = Buffer.from(base64Data, 'base64');
    assert.ok(pngBuf.length < 60 * 1024, `${foodId} PNG exceeds 60KiB: ${pngBuf.length} bytes`);

    const pngSha = crypto.createHash('sha256').update(pngBuf).digest('hex');
    const pngFilename = `${foodId}.png`;
    const targetPngPath = path.join(outDir, pngFilename);
    await fs.writeFile(targetPngPath, pngBuf);

    manifest.foods[foodId] = {
      id: foodId,
      relativePng: pngFilename,
      pngBytes: pngBuf.length,
      pngSha256: pngSha,
      sourceGlbPath: def.path,
      sourceGlbBytes: def.bytes,
      sourceGlbSha256: def.sha256,
      cupScale: Number(renderResult.cupScale.toFixed(4)),
      modelDims: renderResult.modelDims,
      nonEmptyPixels: renderResult.nonEmptyPixels,
    };

    console.log(`Rendered ${foodId}: ${pngBuf.length} bytes, SHA: ${pngSha.slice(0, 16)}..., pixels: ${renderResult.nonEmptyPixels}`);
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Wrote manifest: ${manifestPath}`);
  console.log('RENDER_FOOD_THUMBNAILS PASS');

  await page.close();
} finally {
  await browser.close();
}
