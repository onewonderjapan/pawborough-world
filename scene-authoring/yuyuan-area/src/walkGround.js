// WP4 全域候选地面三角形收集层 —— DOM-free，浏览器（web/walk.js）与节点测试
// （tests/zone-walk-check.mjs）共用，保证「玩到的地面 = 测到的地面」。
//
// 按各分区 collision-<zone>.json 的 groundNodeRe + extraGroundNodes 选出地面网格后，
// 统一改名为仓库根 src/world/collisionAdapter.js GROUND_NODE_RE 认可的别名
// （sctail__worn-stone），再交给共享 collectGroundTriangles() —— 可复用件本身零改动。
//
// meshes 元素与 glbReader / THREE 抽取约定一致：{ name, positions, indices, matrix }。

// 惟一别名：GROUND_NODE_RE 白名单里的既有地面名，仅为复用 collectGroundTriangles 的通道名。
export const AREA_GROUND_ALIAS = 'sctail__worn-stone';

// 简易通配：* 匹配任意字符（含空），其余字符按字面。'jiuqu-bridge*'、'pavilion-*/floor*'
export function globToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$');
}

// 返回 [{ source, name(别名), positions, indices, matrix }]；source 是原始网格引用（调用方如需跨分区去重可用）。
// 一个网格都不命中返回空数组 —— 调用方交由 collectGroundTriangles 报「no qualifying ground」。
// 注意：调用方必须按分区各自调用（每个分区套用自己的 groundNodeRe/extraGroundNodes），
// 再把结果 concat，避免一个分区的通配把别的分区的网格吸进来。
export function selectAreaGroundMeshes(meshes, { groundNodeRe, extraGroundNodes = [] }) {
  if (!groundNodeRe) throw new Error('selectAreaGroundMeshes: groundNodeRe missing');
  const re = new RegExp(groundNodeRe);
  const globs = extraGroundNodes.map(globToRegExp);
  const out = [];
  for (const mesh of meshes) {
    const name = String(mesh.name || '');
    if (!re.test(name) && !globs.some(g => g.test(name))) continue;
    out.push({
      source: mesh,
      name: AREA_GROUND_ALIAS,
      positions: mesh.positions,
      indices: mesh.indices,
      matrix: mesh.matrix,
    });
  }
  return out;
}
