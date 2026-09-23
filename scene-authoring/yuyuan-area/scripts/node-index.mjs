// G2 交付：七节点对照索引（证据来源/形制特征/朝向/重归类记录）。
// 从 OUT_DIR/layout.json 的 gardenNodes 块导出，附真实渲染图对照位。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'out');
const layout = JSON.parse(fs.readFileSync(path.join(OUT, 'layout.json'), 'utf8'));

const nodes = layout.gardenNodes.map(n => ({
  name: n.name,
  objectId: n.id,
  kind: n.kind,
  present: n.present,
  facade: n.facade,
  evidence: n.evidence,
  distinguishingFeature: n.evidence?.feature || null,
  reclassifiedFrom: n.reclassifiedFrom || null,
  reclassReason: n.reclassReason || null,
  endPavilion: n.endPavilion || null,
  renderShots: {
    '三穗堂': 'renders-goal-02/21-node-sansuitang.png',
    '点春堂': 'renders-goal-02/22-node-dianchuntang.png',
    '会景楼': 'renders-goal-02/23-node-huijinglou.png',
    '玉华堂': 'renders-goal-02/24-node-yuhuatang-moongate.png',
    '打唱台': 'renders-goal-02/25-node-dachangtai.png',
    '听涛阁': 'renders-goal-02/26-node-tingtaoge-gallery.png',
    '得月楼': 'renders-goal-02/27-node-deyuelou.png',
  }[n.name] || null,
}));

const wall = layout.objects.find(o => o.id === 'garden-wall');
const report = {
  task: 'G2 豫园设施类别完整并提升七处主要节点',
  sourceLibrary: 'references/INDEX.json -> pawborough-shanghai-reference-library-20260913 (PARTS.md 豫园表; generated 构图非史料; originals 实拍)',
  evidencePolicy: '图库已覆盖的特征才做形；覆盖不足的节点只做标注推断的类别样板；未发明确切历史屋式',
  categoryTemplates: {
    hall: '实墙+主朝向柱廊+门洞+格扇带+双坡顶; doubleEave 变体(三穗堂): 腰檐环+五开间',
    tower: '底层柱廊+门+收分上层+环窗带+平座栏; wrapBalcony 变体(得月楼): 全周边栏',
    pavilion: '角柱+半墙坐凳(开敞)+攒顶+檐角块',
    xuan: '实墙+主朝向柱廊+四坡顶',
    waterside: '临水面全开柱廊+坐凳栏+格扇带',
    stage: '高台基+角柱+敞演面+背墙+全周边栏+陡四坡顶',
    watersideGallery: '有顶游廊(柱列+窄双坡)+端头两层阁楼(听涛阁显式重归类)',
  },
  wallUpgrades: layout.counts.gardenWallUpgrades,
  moonGate: layout.gardenMoonGate,
  nodes,
};
fs.writeFileSync(path.join(OUT, 'garden-node-index.json'), JSON.stringify(report, null, 1));
console.log('garden-node-index.json:', nodes.length, 'nodes,', nodes.filter(n => n.present).length, 'present; wall lattice', report.wallUpgrades.latticeWindows, '| dragonHead', report.wallUpgrades.dragonHead, '| moonGate', report.moonGate.placed);
