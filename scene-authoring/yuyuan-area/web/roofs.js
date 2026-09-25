// wave5-rooftoggle：屋面节点判定 —— 命名规则唯一正本（web 端按名识别，不改任何模块 GLB）。
//
// 背景（wave4-drawcalls 报告）：旧的「屋顶」按钮只认 `zone|id|kind|lod|roofpart` 管道名或
// userData.roof；现行默认构建里厅堂/湖心亭/三穗堂/庙区/商城全部由站点模块承担，程序化屋面
// 一个都不剩，所以按钮点了没有任何节点可关。
//
// 注意名字落点（three 0.180 GLTFLoader）：
//   - glTF 节点名在包装 Object3D 上，Mesh 本体一律 `mesh_N`，所以「某个 Mesh 是不是屋面」要沿父链找名字；
//   - node.name 是 PropertyBinding.sanitizeNodeName 清洗后的（Blender 重名后缀 `.001` 的点被剥成 `001`），
//     原始名保留在 node.userData.name —— 两个候选名都要过规则，否则 `__gray-pan-tile.001` 这类会漏。
//
// 命名规则（小写比较；先剥 assemble.py 加的 `mesh-` 前缀和 Blender 重名后缀 `.NNN`）：
//   R1 程序化屋面（src/build-scene.mjs buildGardenBuilding，模块全关时出现）：
//        `zone|id|kind|lod|roofpart`（管道名第 5 段），userData.roof 同源
//   R2 厅堂套件 hall-kit 与三穗堂 sansuitang（build_hall.py / build.py 的 GROUP='hall-roof'）：
//        `hall-roof__*`
//   R3 商城大楼套件 bazaar-tower-kit（build_tower.py 的 PART='roof-main' / 'pav-roof'；
//      本单不改 kit、kit 未入默认构建，web 端先按名识别）：
//        `roof-main__*`、`pav-roof__*`
//   R4 湖心亭 huxinting（build.py；assemble.py 给节点加 `mesh-` 前缀，剥掉后判）：
//        `huxin-ting__{mainroof,porchroof,towerroof,towerskirt,finial}*`
//        （主/抱厦/宝顶屋面全套 + 串 skirt 腰檐 + 宝顶饰件）
//   R5 瓦面节点（庙区模块 resources/temple-v3 屋面瓦并入 body、复廊 fulang、店铺屋面与山墙瓦皮）：
//        `*__gray-pan-tile` / `*__grey-pan-tile`
//   R6 亭套件 pavilion-kit（`roof`、`roof__pav-*`）、店铺脊饰 `roof__deep-door-lacquer`、
//      店铺屋架 `roof-structure__*`、门楼顶 `gate-roof__*`：
//        `__` 前段 part == 'roof' 或以 `roof-` 开头或以 `-roof` 结尾
//   不算屋面（勿误伤）：墙顶瓦帽 `garden-wall/moon-gate/temple-wall__garden-tile-cap`、
//   门楼檐下墙带 `gate-eave__*`（砖/石/抹灰）、九曲桥（`bridge` 含 'ridge' 子串，R6 按 part 精确匹配不吃它）、
//   园廊 corridor-kit（整廊单 mesh 屋面熔在体内，按名不可分，本单不改 GLB）。

export function isRoofName(raw) {
  const n = String(raw).toLowerCase().replace(/^mesh-/, '').replace(/\.\d{1,3}$/, '');
  const pipe = n.split('|');
  if (pipe.length >= 5 && pipe[4] === 'roofpart') return true;              // R1
  const us = n.indexOf('__');
  const part = us >= 0 ? n.slice(0, us) : n;
  const rest = us >= 0 ? n.slice(us + 2) : '';
  if (part === 'hall-roof' || part === 'roof-main' || part === 'pav-roof') return true;   // R2 R3
  if (part === 'huxin-ting' && /^(mainroof|porchroof|towerroof|towerskirt|finial)/.test(rest)) return true; // R4
  if (/(gray|grey)-pan-tile$/.test(n)) return true;                         // R5
  return part === 'roof' || part.startsWith('roof-') || (us >= 0 && part.endsWith('-roof')); // R6
}

// 该节点自身命名带屋面标记（不看父链）——「屋顶」开关用它逐节点置 visible
export function isRoofNodeSelf(o) {
  if (o.userData && o.userData.roof) return true;
  if (o.name && isRoofName(o.name)) return true;
  if (o.userData && o.userData.name && isRoofName(o.userData.name)) return true;
  return false;
}

// 该对象（或其任一祖先）是否屋面命名 —— 用于 Mesh（mesh_N 本名无信息，名字在父链包装节点上）。
// 每个节点拿 name 和 userData.name（GLTFLoader 保留的原始名）两个候选都试。
export function isRoofObject(o) {
  for (let n = o; n; n = n.parent) if (isRoofNodeSelf(n)) return true;
  return false;
}
