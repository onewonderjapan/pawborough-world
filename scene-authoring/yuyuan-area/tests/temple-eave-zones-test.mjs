// 庙区分区件/压缩件 pv05 射线交付守卫（wave13-templefix R3 必修5，审查必修5）。
// 从默认 npm test 拆出（npm run test:temple-eave-zones，不入默认链）：npm run build
// 不产生分区件，rebuild-review.sh 的分区/压缩也是可选步骤——默认链里它就是未声明的
// 生成物前置依赖（R2 审查实测：仅缺两份分区件时默认测试 22 PASS / 2 FAIL 误红）。
// 本脚本应在明确做过分区的交付流程（export-zones.py + compress-zones.mjs）之后运行；
// 届时分区块缺失必须 FAIL（不静默跳过），ZONE_CM=0 跳过压缩件、只查原件。
// 口径与 temple-eave-leak-test.mjs（模块回归）一致：固定 pv05 fmid 相机 + 审查三漏点
// 像素（temple-eave-pv05.mjs 共享），FrontSide 命中必须落在封板特征域（陡坡法线
// ny∈[-0.3,-0.01] + 高度窗 capY±0.35 再放量化裕量）；分区件世界坐标直读，
// 压缩件走浏览器同款 meshopt 字节解压。
// 用法：OUT_DIR=out-zone node tests/temple-eave-zones-test.mjs   [ZONE_CM=0 只查 raw]
import fs from 'node:fs';
import path from 'node:path';
import * as Q from './templeqa-lib.mjs';
import { PV05_CAM, PV05_PIXELS, DD, pv05Dir, pv05PixelErrors, readSceneWorldTris, rayFrontFull } from './temple-eave-pv05.mjs';

const OUTD = process.env.OUT_DIR || 'out-zone';
let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('ok  ', name); }
  else { fail++; failures.push(name); console.log('FAIL', name, extra); }
};

// N0 相机口径自证（与模块回归同一条断言，保证本脚本的像素口径同样成立）
{
  const errs = await pv05PixelErrors(30);
  const maxE = Math.max(...errs.map((e) => e.errPx));
  ok(`pv05 口径: 像素射线反投影误差 <0.5px（N0, max=${maxE.toFixed(4)}px）`, maxE < 0.5,
    errs.map((e) => `(${e.px},${e.py})→参考(${e.ref[0].toFixed(2)},${e.ref[1].toFixed(2)}) err=${e.errPx.toFixed(3)}px`).join('; '));
}

// 查看器（web/main.js loadZoneFiles）默认吃清单里的 zone-*.cm.glb（?raw=1 才吃原件），
// 模块 GLB 绿不等于交付绿——R1 的教训：模块/单文件总装已修复而 out-zone/zone-temple-2.glb
// 仍是 R0 反向面。
const zoneFiles = ['zone-temple-2.glb'];
if (process.env.ZONE_CM !== '0') zoneFiles.push('zone-temple-2.cm.glb');
else console.log('# ZONE_CM=0：跳过压缩件，只查原件');
for (const f of zoneFiles) {
  const file = path.join(Q.ROOT, OUTD, f);
  if (!fs.existsSync(file)) {
    ok(`zone 资产 ${f}: 存在（浏览器实际资产）`, false,
      `${OUTD}/${f} 缺失——分区件未随模块重建（export-zones.py + compress-zones.mjs），交付守卫不静默跳过`);
    continue;
  }
  try {
    const ztris = await readSceneWorldTris(file);
    const miss = [];
    let n = 0;
    for (const [px, py] of PV05_PIXELS) {
      n++;
      const d = pv05Dir(PV05_CAM.eye, PV05_CAM.tgt, px, py);
      const h = rayFrontFull(ztris, PV05_CAM.eye, d);
      const nl = h ? Math.hypot(...h.n) : 0;
      const ny = h ? h.n[1] / nl : 0;
      // 封板特征：陡坡朝外（修复后压低面 ny≈-0.11；R0 反向面 ny≈+0.11 打背面，
      // 被剔除后透天）+ 压低段高度窗（capY±0.35 再放 ±0.05 给 cm 量化）
      const capLike = h && ny >= -0.3 && ny <= -0.01 && h.p[1] > DD.capY - 0.20 && h.p[1] < DD.capY + 0.40;
      if (!h || !capLike) miss.push(`px(${px},${py})${h ? ` 命中(${h.p.map((v) => v.toFixed(2))} ny=${ny.toFixed(3)}) 非封板` : ' 无正面命中（R0 反向面/穿缝出天）'}`);
    }
    ok(`zone 资产 ${f}: pv05 漏点像素封板命中（${n} 像素, ${ztris.length} tris）`, miss.length === 0,
      miss.length ? `\n  ${miss.join('\n  ')}` : '');
  } catch (e) {
    ok(`zone 资产 ${f}: 可解析`, false, String(e && e.message || e));
  }
}

console.log(`\ntemple-eave-zones: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
