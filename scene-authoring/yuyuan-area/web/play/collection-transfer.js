// 纯逻辑小吃图鉴收藏导出与导入 (M07: Collection transfer)
// 无 DOM / Three / Rapier 依赖，不直接使用存储，仅处理纯数据集合。

export class CollectionImportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CollectionImportError';
  }
}

const MAX_BYTES = 64 * 1024; // 64 KiB
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

function validateIdList(list, listName) {
  if (!Array.isArray(list)) {
    throw new CollectionImportError(`图鉴数据列表不正确：${listName} 必须是数组`);
  }
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (typeof item !== 'string' || !item || !SAFE_ID_RE.test(item)) {
      throw new CollectionImportError(`小吃或里程碑标识符格式不合法: ${String(item)}`);
    }
  }
}

/**
 * 导出收藏数据为 JSON 字符串
 * 仅导出指定收藏字段，严禁包含 feet/vehicle/actor/eating 等仿真与位姿状态。
 */
export function exportCollection(snapshot = {}) {
  const catalogEdition =
    typeof snapshot?.catalogEdition === 'string'
      ? snapshot.catalogEdition
      : 'pawborough-snack-atlas-v1-shanghai';

  const discovered = Array.from(new Set(snapshot?.discovered || []))
    .filter((id) => typeof id === 'string')
    .sort();

  const tasted = Array.from(new Set(snapshot?.tasted || []))
    .filter((id) => typeof id === 'string')
    .sort();

  const milestones = Array.from(new Set(snapshot?.milestones || []))
    .filter((id) => typeof id === 'string')
    .sort();

  const orphanDiscovered = Array.from(new Set(snapshot?.orphanedProgress?.discovered || []))
    .filter((id) => typeof id === 'string')
    .sort();

  const orphanTasted = Array.from(new Set(snapshot?.orphanedProgress?.tasted || []))
    .filter((id) => typeof id === 'string')
    .sort();

  const data = {
    schemaVersion: 1,
    type: 'pawborough-food-collection',
    catalogEdition,
    discovered,
    tasted,
    milestones,
    orphanedProgress: {
      discovered: orphanDiscovered,
      tasted: orphanTasted,
    },
  };

  return JSON.stringify(data, null, 2);
}

/**
 * 导入收藏数据并与当前状态合并
 * @param {string} text - JSON 文本内容
 * @param {object} options - { registry, current }
 * @returns {{ collection: object, warnings: string[] }}
 */
export function importCollection(text, { registry = null, current = null } = {}) {
  if (typeof text !== 'string') {
    throw new CollectionImportError('导入内容必须为文本');
  }

  // 1. 严格 64 KiB 字节上限校验 (UTF-8)
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > MAX_BYTES) {
    throw new CollectionImportError(`导入文件大小超过限制（最大 64 KiB，当前 ${byteLength} 字节）`);
  }

  // 2. 解析 JSON
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_err) {
    throw new CollectionImportError('无法解析文件内容，请确保为合法的 JSON 格式');
  }

  // 3. 结构基本校验
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CollectionImportError('导入数据格式不正确');
  }

  if (parsed.type !== 'pawborough-food-collection') {
    throw new CollectionImportError('不是有效的寻味图鉴收藏文件');
  }

  if (parsed.schemaVersion !== 1) {
    throw new CollectionImportError(`不支持的图鉴数据版本: ${parsed.schemaVersion}`);
  }

  // 校验必须字段是否为数组
  validateIdList(parsed.discovered, 'discovered');
  validateIdList(parsed.tasted, 'tasted');
  validateIdList(parsed.milestones, 'milestones');

  if (parsed.orphanedProgress !== undefined) {
    if (!parsed.orphanedProgress || typeof parsed.orphanedProgress !== 'object' || Array.isArray(parsed.orphanedProgress)) {
      throw new CollectionImportError('图鉴孤立记录格式不正确');
    }
    if (parsed.orphanedProgress.discovered !== undefined) {
      validateIdList(parsed.orphanedProgress.discovered, 'orphanedProgress.discovered');
    }
    if (parsed.orphanedProgress.tasted !== undefined) {
      validateIdList(parsed.orphanedProgress.tasted, 'orphanedProgress.tasted');
    }
  }

  const warnings = [];

  if (parsed.catalogEdition && current?.catalogEdition && parsed.catalogEdition !== current.catalogEdition) {
    warnings.push(`导入目录版本 (${parsed.catalogEdition}) 与当前版本 (${current.catalogEdition}) 不一致`);
  }

  // 4. 汇总所有 candidate IDs（不破坏 current 原对象）
  // 规则：tasted 蕴含 discovered
  const candidateTasted = new Set();
  const candidateDiscovered = new Set();
  const candidateMilestones = new Set();

  // 从当前状态累加
  if (current) {
    for (const id of current.tasted || []) {
      candidateTasted.add(id);
      candidateDiscovered.add(id);
    }
    for (const id of current.discovered || []) {
      candidateDiscovered.add(id);
    }
    for (const id of current.orphanedProgress?.tasted || []) {
      candidateTasted.add(id);
      candidateDiscovered.add(id);
    }
    for (const id of current.orphanedProgress?.discovered || []) {
      candidateDiscovered.add(id);
    }
    for (const m of current.milestones || []) {
      candidateMilestones.add(m);
    }
  }

  // 从导入文件累加
  for (const id of parsed.tasted || []) {
    candidateTasted.add(id);
    candidateDiscovered.add(id);
  }
  for (const id of parsed.discovered || []) {
    candidateDiscovered.add(id);
  }
  for (const id of parsed.orphanedProgress?.tasted || []) {
    candidateTasted.add(id);
    candidateDiscovered.add(id);
  }
  for (const id of parsed.orphanedProgress?.discovered || []) {
    candidateDiscovered.add(id);
  }
  for (const m of parsed.milestones || []) {
    candidateMilestones.add(m);
  }

  // 5. 根据 registry 进行合法/孤立归类与重归类 (reclassify if present)
  const activeDiscovered = new Set();
  const activeTasted = new Set();
  const orphanDiscovered = new Set();
  const orphanTasted = new Set();

  const isKnownAndEnabled = (id) => {
    if (!registry?.foodsById) return true; // 未提供注册表时不区分
    const food = registry.foodsById.get ? registry.foodsById.get(id) : registry.foodsById[id];
    return Boolean(food && food.enabled !== false);
  };

  for (const id of candidateDiscovered) {
    const isTasted = candidateTasted.has(id);
    if (isKnownAndEnabled(id)) {
      activeDiscovered.add(id);
      if (isTasted) activeTasted.add(id);
    } else {
      orphanDiscovered.add(id);
      if (isTasted) orphanTasted.add(id);
      if (parsed.discovered.includes(id) || parsed.tasted.includes(id)) {
        warnings.push(`小吃 "${id}" 当前未上线或已禁用，保留在暂存进度中`);
      }
    }
  }

  const catalogEdition =
    current?.catalogEdition ?? parsed.catalogEdition ?? 'pawborough-snack-atlas-v1-shanghai';

  return {
    collection: {
      catalogEdition,
      discovered: Array.from(activeDiscovered).sort(),
      tasted: Array.from(activeTasted).sort(),
      milestones: Array.from(candidateMilestones).sort(),
      orphanedProgress: {
        discovered: Array.from(orphanDiscovered).sort(),
        tasted: Array.from(orphanTasted).sort(),
      },
    },
    warnings,
  };
}
