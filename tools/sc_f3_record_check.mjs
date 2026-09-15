// SC-F3 runtime record check — the same surface the lead inspected at :5285:
// the live #record JSON from the real client. Candidate and assets=off are
// both loaded; actual resources must equal the inventory-derived expectation,
// and the surface must be present in bytes, version and fingerprint.
//
// Run: node tools/sc_f3_record_check.mjs [baseUrl]   (default the 5285 preview)
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5285';
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

async function record(url) {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#notice')?.textContent?.includes('完整世界已载入'), null, { timeout: 90000 });
    await page.waitForTimeout(400);
    return JSON.parse(await page.textContent('#record'));
  } finally {
    await browser.close();
  }
}

const on = await record(`${BASE}/?world=street-completion`);
const surfaceSha = on.assets?.streetCompletion?.surface?.sha256;
check('candidate: live triangles == trianglesExpected.total (surface counted, 214360)',
  on.resources.triangles === on.trianglesExpected.total && on.trianglesExpected.total === 214360,
  `${on.resources.triangles} vs ${on.trianglesExpected.total}`);
check('candidate: datasetSurface part present', on.trianglesExpected.datasetSurface === 1468);
check('candidate: parts include one surface entry with id dataset-surface',
  on.trianglesExpected.parts?.some(p => p.kind === 'surface' && p.id === 'dataset-surface' && p.triangles === 1468),
  JSON.stringify(on.trianglesExpected.parts?.slice(-1)));
check('candidate: load.bytesTotal includes surface (32049956)',
  on.load.bytesTotal === 32049956 && on.load.bytesSurface === 985560,
  `${on.load.bytesTotal} (+${on.load.bytesSurface} surface)`);
check('candidate: version.additionalAssets has 7 entries incl. the surface',
  on.version.additionalAssets.length === 7 && on.version.additionalAssets.some(a => a.kind === 'surface' && a.id === 'dataset-surface' && a.sha256 === surfaceSha),
  JSON.stringify(on.version.additionalAssets.map(a => a.id)));
check('candidate: fingerprint carries the surface sha', on.version.fingerprint.includes(surfaceSha), on.version.fingerprint.split('+').pop());

const off = await record(`${BASE}/?world=street-completion&assets=off`);
check('assets=off: live triangles == expected (172932 = base + surface)',
  off.resources.triangles === off.trianglesExpected.total && off.trianglesExpected.total === 172932,
  `${off.resources.triangles} vs ${off.trianglesExpected.total}`);
check('assets=off: bytesTotal = base + surface (21557180)',
  off.load.bytesTotal === 21557180 && off.load.bytesAdditional === 0 && off.load.bytesSurface === 985560,
  String(off.load.bytesTotal));
check('assets=off: fingerprint marks held-back shopfronts AND keeps the surface',
  off.version.fingerprint.includes('assets-off') && off.version.fingerprint.includes(surfaceSha), off.version.fingerprint);
check('assets=off: excludedAdditionalAssetIds lists the six shops',
  off.trianglesExpected.excludedAdditionalAssetIds?.length === 6, JSON.stringify(off.trianglesExpected.excludedAdditionalAssetIds));
check('assets=off: record states the scope (shopfront comparison, ground stays)',
  /店屋|shopfront/i.test(off.trianglesExpected.assetsOffScope ?? ''), off.trianglesExpected.assetsOffScope);
check('fingerprints differ between candidate and comparison', on.version.fingerprint !== off.version.fingerprint);

console.log(failures === 0 ? 'SC_F3_RECORD_PASS' : `SC_F3_RECORD_FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
