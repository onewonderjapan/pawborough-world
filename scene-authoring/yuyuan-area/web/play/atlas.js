// 全国寻味 · 毛绒上海小城图鉴组件 (M07: Food atlas component)
// 纯状态快照消费端，无集合权威性，不直接操作存储。
import { exportCollection as fallbackExport, importCollection as fallbackImport } from './collection-transfer.js';

/**
 * 纯逻辑映射函数：根据当前注册表与快照投影出图鉴条目
 * 支持三态数据模型、未发现隐藏、动态食物注入、计数统计与筛选器
 * @param {object} registry - 食品注册表 (foodsById, chaptersById, vendorsById, requiredFoodIds, vendorsFor, thumbnailFor)
 * @param {object} snapshot - 收藏快照 (discovered, tasted, trackedFoodId, trackedVendorId, milestones, orphanedProgress)
 * @returns {Array<object>} entries 包含 counts, chapters, filterBy
 */
export function atlasEntries(registry, snapshot) {
  const discoveredSet = new Set(snapshot?.discovered || []);
  const tastedSet = new Set(snapshot?.tasted || []);
  const trackedFoodId = snapshot?.trackedFoodId ?? null;
  const trackedVendorId = snapshot?.trackedVendorId ?? null;

  const reqSet = registry?.requiredFoodIds
    ? (registry.requiredFoodIds instanceof Set
        ? registry.requiredFoodIds
        : new Set(registry.requiredFoodIds))
    : new Set();

  const foods = [];
  if (registry?.foodsById) {
    const rawFoods = typeof registry.foodsById.values === 'function'
      ? [...registry.foodsById.values()]
      : Object.values(registry.foodsById);
    for (const food of rawFoods) {
      if (food.enabled === false) continue;
      foods.push(food);
    }
  }

  const entries = [];
  let discoveredCount = 0;
  let tastedCount = 0;

  for (const food of foods) {
    const isTasted = tastedSet.has(food.id);
    const isDiscovered = isTasted || discoveredSet.has(food.id);
    const status = isTasted ? 'tasted' : isDiscovered ? 'discovered' : 'unseen';

    if (isDiscovered) discoveredCount += 1;
    if (isTasted) tastedCount += 1;

    const isRequired = reqSet.has(food.id);
    const isTracked = trackedFoodId === food.id;

    const chapter = registry?.chaptersById?.get
      ? registry.chaptersById.get(food.chapterId)
      : registry?.chaptersById?.[food.chapterId];
    const chapterTitle = chapter?.name ?? chapter?.titleZh ?? food.chapterId;

    const vendors = typeof registry?.vendorsFor === 'function'
      ? registry.vendorsFor(food.id)
      : [];
    const defaultVendor = vendors[0] || null;
    const defaultVendorId = defaultVendor?.vendorId ?? defaultVendor?.id ?? null;

    let thumbPath = null;
    if (typeof registry?.thumbnailFor === 'function') {
      const t = registry.thumbnailFor(food.id);
      thumbPath = t?.path ?? null;
    } else if (food.thumbId) {
      thumbPath = food.thumbId;
    }

    entries.push({
      id: food.id,
      chapterId: food.chapterId,
      chapterTitle,
      status, // 'unseen' | 'discovered' | 'tasted'
      isDiscovered,
      isTasted,
      isRequired,
      isTracked,
      trackedVendorId: isTracked ? trackedVendorId : null,
      defaultVendorId: isDiscovered ? defaultVendorId : null,
      poseProfile: food.poseProfile ?? 'cupped',
      // 未发现状态下严格隐藏名称、具体地点、地区与描述
      name: isDiscovered ? (food.name ?? food.labelZh) : null,
      displayName: isDiscovered ? (food.labelZh ?? food.name) : '???',
      regionLabel: isDiscovered ? (food.regionLabel ?? '上海风味') : null,
      locationHint: isDiscovered ? (food.locationHint ?? '商业街某摊位') : null,
      description: isDiscovered
        ? (food.description ?? '')
        : '在上海小城漫步探访，发现摊位即可解锁这道美味。',
      thumbnail: isDiscovered ? thumbPath : null,
    });
  }

  const total = entries.length;
  const incompleteCount = total - tastedCount;
  const requiredCount = reqSet.size > 0 ? reqSet.size : total;

  entries.counts = {
    total,
    discovered: discoveredCount,
    tasted: tastedCount,
    incomplete: incompleteCount,
    required: requiredCount,
  };

  entries.totalCount = total;
  entries.discoveredCount = discoveredCount;
  entries.tastedCount = tastedCount;
  entries.incompleteCount = incompleteCount;
  entries.requiredCount = requiredCount;

  // 章节统计统计汇总
  const chaptersMap = new Map();
  if (registry?.chaptersById) {
    const rawChapters = typeof registry.chaptersById.values === 'function'
      ? [...registry.chaptersById.values()]
      : Object.values(registry.chaptersById);
    for (const ch of rawChapters) {
      chaptersMap.set(ch.id, {
        id: ch.id,
        name: ch.name ?? ch.titleZh ?? ch.id,
        total: 0,
        discovered: 0,
        tasted: 0,
      });
    }
  }

  for (const entry of entries) {
    let stat = chaptersMap.get(entry.chapterId);
    if (!stat) {
      stat = { id: entry.chapterId, name: entry.chapterTitle, total: 0, discovered: 0, tasted: 0 };
      chaptersMap.set(entry.chapterId, stat);
    }
    stat.total += 1;
    if (entry.isDiscovered) stat.discovered += 1;
    if (entry.isTasted) stat.tasted += 1;
  }
  entries.chapters = Array.from(chaptersMap.values());

  // 筛选器辅助函数
  entries.filterBy = (filterKey) => {
    switch (filterKey) {
      case 'discovered':
      case '已发现':
        return entries.filter((e) => e.isDiscovered);
      case 'tasted':
      case '已品尝':
        return entries.filter((e) => e.isTasted);
      case 'incomplete':
      case '未完成':
        return entries.filter((e) => !e.isTasted);
      case 'all':
      case '全部':
      default:
        return [...entries];
    }
  };

  return entries;
}

// 占位线框 SVG (受控盘子 / 问号线条图，绝非破损图片)
const SVG_NS = 'http://www.w3.org/2000/svg';
function createPlatePlaceholder(isUnseen = false) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'pb-atlas-placeholder-icon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  if (isUnseen) {
    // 盘子轮廓 + 问号
    const ellipse = document.createElementNS(SVG_NS, 'ellipse');
    ellipse.setAttribute('cx', '24');
    ellipse.setAttribute('cy', '36');
    ellipse.setAttribute('rx', '18');
    ellipse.setAttribute('ry', '6');
    svg.appendChild(ellipse);

    const question = document.createElementNS(SVG_NS, 'path');
    question.setAttribute('d', 'M18 16c0-3.3 2.7-6 6-6s6 2.7 6 6c0 3-4 5-4 8m0 4h.01');
    svg.appendChild(question);
  } else {
    // 盘子轮廓 + 盖子/蒸汽线条
    const base = document.createElementNS(SVG_NS, 'ellipse');
    base.setAttribute('cx', '24');
    base.setAttribute('cy', '34');
    base.setAttribute('rx', '19');
    base.setAttribute('ry', '7');
    svg.appendChild(base);

    const dome = document.createElementNS(SVG_NS, 'path');
    dome.setAttribute('d', 'M8 32c0-8.8 7.2-16 16-16s16 7.2 16 16');
    svg.appendChild(dome);

    const steam = document.createElementNS(SVG_NS, 'path');
    steam.setAttribute('d', 'M21 8c-1 2 1 3 0 5m6-5c-1 2 1 3 0 5');
    svg.appendChild(steam);
  }
  return svg;
}

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

function isVisibleFocusable(el) {
  if (!el || el.hidden) return false;
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    const style = window.getComputedStyle(el);
    if (style && (style.visibility === 'hidden' || style.display === 'none')) return false;
  }
  return true;
}

/**
 * 挂载小吃图鉴组件
 * @param {object} params
 * @param {HTMLElement} params.root - 挂载根节点
 * @param {object} params.registry - 食品注册表
 * @param {function(): object} params.getSnapshot - 状态快照获取器
 * @param {object} params.actions - { track, exportCollection, importCollection, resetCollection }
 * @param {object} params.overlay - 模态控制器
 * @returns {{ open: function, close: function, render: function, dispose: function }}
 */
export function mountAtlas({ root, registry, getSnapshot, actions = {}, overlay } = {}) {
  if (typeof document === 'undefined' || !root) {
    // 纯 Node 环境保护
    return {
      open: () => {},
      close: () => {},
      render: () => {},
      dispose: () => {},
    };
  }

  // UI 内部交互状态（render 跨调用保持）
  let currentChapterId = 'all';
  let currentFilter = 'all'; // 'all' | 'discovered' | 'tasted' | 'incomplete'
  let selectedFoodId = null;
  let isOpenState = false;
  let isDisposed = false;
  let lastFocusedElement = null;

  // 1. 构建主 DOM 结构
  const modalEl = document.createElement('div');
  modalEl.className = 'pb-atlas';
  modalEl.hidden = true;

  const backdropEl = document.createElement('div');
  backdropEl.className = 'pb-atlas-backdrop';
  modalEl.appendChild(backdropEl);

  const dialogEl = document.createElement('div');
  dialogEl.className = 'pb-atlas-dialog';
  dialogEl.setAttribute('role', 'dialog');
  dialogEl.setAttribute('aria-modal', 'true');
  dialogEl.setAttribute('aria-labelledby', 'pb-atlas-title');
  dialogEl.setAttribute('tabindex', '-1');
  modalEl.appendChild(dialogEl);

  // 顶部 Header
  const headerEl = document.createElement('header');
  headerEl.className = 'pb-atlas-header';

  const headerLeftEl = document.createElement('div');
  headerLeftEl.className = 'pb-atlas-header-left';
  const titleEl = document.createElement('h2');
  titleEl.id = 'pb-atlas-title';
  titleEl.className = 'pb-atlas-title';
  titleEl.textContent = '全国寻味';
  const subtitleEl = document.createElement('span');
  subtitleEl.className = 'pb-atlas-subtitle';
  subtitleEl.textContent = '毛绒上海小城 · 寻味手账';
  headerLeftEl.appendChild(titleEl);
  headerLeftEl.appendChild(subtitleEl);

  const headerRightEl = document.createElement('div');
  headerRightEl.className = 'pb-atlas-header-right';
  const progressBadgeEl = document.createElement('span');
  progressBadgeEl.className = 'pb-atlas-progress-badge';
  const closeBtnEl = document.createElement('button');
  closeBtnEl.className = 'pb-atlas-close-btn';
  closeBtnEl.setAttribute('aria-label', '关闭图鉴');
  closeBtnEl.textContent = '✕';
  headerRightEl.appendChild(progressBadgeEl);
  headerRightEl.appendChild(closeBtnEl);

  headerEl.appendChild(headerLeftEl);
  headerEl.appendChild(headerRightEl);
  dialogEl.appendChild(headerEl);

  // 主体 Body
  const bodyEl = document.createElement('div');
  bodyEl.className = 'pb-atlas-body';

  const railEl = document.createElement('nav');
  railEl.className = 'pb-atlas-chapter-rail';
  railEl.setAttribute('aria-label', '章节导轨');
  bodyEl.appendChild(railEl);

  const contentEl = document.createElement('section');
  contentEl.className = 'pb-atlas-content';

  // 筛选标签栏
  const filtersEl = document.createElement('div');
  filtersEl.className = 'pb-atlas-filters';
  filtersEl.setAttribute('role', 'tablist');

  const filterDefs = [
    { key: 'all', label: '全部' },
    { key: 'discovered', label: '已发现' },
    { key: 'tasted', label: '已品尝' },
    { key: 'incomplete', label: '未完成' },
  ];

  const filterBtnMap = new Map();
  for (const f of filterDefs) {
    const btn = document.createElement('button');
    btn.className = `pb-atlas-filter-btn ${f.key === currentFilter ? 'is-active' : ''}`;
    btn.textContent = f.label;
    btn.setAttribute('role', 'tab');
    btn.addEventListener('click', () => {
      currentFilter = f.key;
      render();
    });
    filtersEl.appendChild(btn);
    filterBtnMap.set(f.key, btn);
  }
  contentEl.appendChild(filtersEl);

  // 中间区域：卡片列表 + 详情阅读区
  const mainSplitEl = document.createElement('div');
  mainSplitEl.className = 'pb-atlas-main-split';

  const cardsEl = document.createElement('div');
  cardsEl.className = 'pb-atlas-cards';
  cardsEl.setAttribute('role', 'list');
  mainSplitEl.appendChild(cardsEl);

  const detailEl = document.createElement('article');
  detailEl.className = 'pb-atlas-detail';
  mainSplitEl.appendChild(detailEl);

  contentEl.appendChild(mainSplitEl);
  bodyEl.appendChild(contentEl);
  dialogEl.appendChild(bodyEl);

  // 底部 Footer
  const footerEl = document.createElement('footer');
  footerEl.className = 'pb-atlas-footer';

  const transferBarEl = document.createElement('div');
  transferBarEl.className = 'pb-atlas-transfer-bar';

  const exportBtnEl = document.createElement('button');
  exportBtnEl.className = 'pb-atlas-transfer-btn pb-atlas-export-btn';
  exportBtnEl.textContent = '导出收藏';

  const importBtnEl = document.createElement('button');
  importBtnEl.className = 'pb-atlas-transfer-btn pb-atlas-import-btn';
  importBtnEl.textContent = '导入收藏';

  const fileInputEl = document.createElement('input');
  fileInputEl.type = 'file';
  fileInputEl.accept = '.json,application/json';
  fileInputEl.hidden = true;

  const resetBtnEl = document.createElement('button');
  resetBtnEl.className = 'pb-atlas-transfer-btn pb-atlas-reset-btn';
  resetBtnEl.textContent = '清空图鉴';

  transferBarEl.appendChild(exportBtnEl);
  transferBarEl.appendChild(importBtnEl);
  transferBarEl.appendChild(fileInputEl);
  transferBarEl.appendChild(resetBtnEl);

  const messageEl = document.createElement('div');
  messageEl.className = 'pb-atlas-message';
  messageEl.setAttribute('role', 'status');
  messageEl.setAttribute('aria-live', 'polite');

  footerEl.appendChild(transferBarEl);
  footerEl.appendChild(messageEl);
  dialogEl.appendChild(footerEl);

  // 二次确认对话框 (Clear collection needs explicit second confirmation with cancel)
  const confirmModalEl = document.createElement('div');
  confirmModalEl.className = 'pb-atlas-confirm-modal';
  confirmModalEl.hidden = true;

  const confirmBoxEl = document.createElement('div');
  confirmBoxEl.className = 'pb-atlas-confirm-box';

  const confirmTextEl = document.createElement('p');
  confirmTextEl.className = 'pb-atlas-confirm-text';
  confirmTextEl.textContent = '确定要清空全部图鉴收藏记录吗？此操作不可逆。';

  const confirmActionsEl = document.createElement('div');
  confirmActionsEl.className = 'pb-atlas-confirm-actions';

  const confirmOkBtn = document.createElement('button');
  confirmOkBtn.className = 'pb-atlas-confirm-ok';
  confirmOkBtn.textContent = '确定清空';

  const confirmCancelBtn = document.createElement('button');
  confirmCancelBtn.className = 'pb-atlas-confirm-cancel';
  confirmCancelBtn.textContent = '取消';

  confirmActionsEl.appendChild(confirmOkBtn);
  confirmActionsEl.appendChild(confirmCancelBtn);
  confirmBoxEl.appendChild(confirmTextEl);
  confirmBoxEl.appendChild(confirmActionsEl);
  confirmModalEl.appendChild(confirmBoxEl);
  dialogEl.appendChild(confirmModalEl);

  root.appendChild(modalEl);

  // 2. 核心渲染与状态同步
  function render() {
    if (isDisposed) return;
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    const entries = atlasEntries(registry, snapshot);

    // 更新顶部总进度徽章
    progressBadgeEl.textContent = `已品尝 ${entries.counts.tasted} / ${entries.counts.required}`;

    // 更新章节导轨按钮
    railEl.textContent = ''; // 清空导轨按钮
    const allRailBtn = document.createElement('button');
    allRailBtn.className = `pb-atlas-chapter-btn ${currentChapterId === 'all' ? 'is-active' : ''}`;
    const allRailName = document.createElement('span');
    allRailName.textContent = '全部章节';
    const allRailCount = document.createElement('span');
    allRailCount.className = 'pb-atlas-chapter-count';
    allRailCount.textContent = `${entries.counts.tasted}/${entries.counts.total}`;
    allRailBtn.appendChild(allRailName);
    allRailBtn.appendChild(allRailCount);
    allRailBtn.addEventListener('click', () => {
      currentChapterId = 'all';
      render();
    });
    railEl.appendChild(allRailBtn);

    for (const ch of entries.chapters) {
      const chBtn = document.createElement('button');
      chBtn.className = `pb-atlas-chapter-btn ${currentChapterId === ch.id ? 'is-active' : ''}`;
      const chName = document.createElement('span');
      chName.textContent = ch.name;
      const chCount = document.createElement('span');
      chCount.className = 'pb-atlas-chapter-count';
      chCount.textContent = `${ch.tasted}/${ch.total}`;
      chBtn.appendChild(chName);
      chBtn.appendChild(chCount);
      chBtn.addEventListener('click', () => {
        currentChapterId = ch.id;
        render();
      });
      railEl.appendChild(chBtn);
    }

    // 更新筛选按钮选中状态
    for (const [key, btn] of filterBtnMap.entries()) {
      if (key === currentFilter) {
        btn.classList.add('is-active');
      } else {
        btn.classList.remove('is-active');
      }
    }

    // 过滤展示的条目
    let visibleEntries = entries.filterBy(currentFilter);
    if (currentChapterId !== 'all') {
      visibleEntries = visibleEntries.filter((e) => e.chapterId === currentChapterId);
    }

    // 确保 selectedFoodId 有效且稳定
    const hasCurrentSelected = visibleEntries.some((e) => e.id === selectedFoodId);
    if (!hasCurrentSelected && visibleEntries.length > 0) {
      selectedFoodId = visibleEntries[0].id;
    } else if (visibleEntries.length === 0) {
      selectedFoodId = null;
    }

    // 渲染卡片列表
    const focusedCardId = document.activeElement?.closest?.('.pb-atlas-card')?.dataset.foodId;
    cardsEl.textContent = '';
    for (const entry of visibleEntries) {
      const card = document.createElement('div');
      card.className = `pb-atlas-card is-${entry.status} ${entry.id === selectedFoodId ? 'is-selected' : ''}`;
      card.setAttribute('role', 'listitem');
      card.setAttribute('tabindex', '0');
      card.dataset.foodId = entry.id;

      // 缩略图 / 占位图
      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'pb-atlas-card-thumb-wrap';
      if (entry.isDiscovered && entry.thumbnail) {
        const img = document.createElement('img');
        img.className = 'pb-atlas-card-thumb';
        img.src = entry.thumbnail;
        img.alt = entry.displayName;
        img.loading = 'lazy';
        img.onerror = () => {
          img.remove();
          thumbWrap.appendChild(createPlatePlaceholder(entry.status === 'unseen'));
        };
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.appendChild(createPlatePlaceholder(entry.status === 'unseen'));
      }
      card.appendChild(thumbWrap);

      // 食物名称（未发现显示 ???）
      const nameEl = document.createElement('div');
      nameEl.className = 'pb-atlas-card-name';
      nameEl.textContent = entry.displayName;
      card.appendChild(nameEl);

      // 印章 / 状态标记
      const stampEl = document.createElement('span');
      stampEl.className = `pb-atlas-card-stamp is-${entry.status}`;
      if (entry.status === 'tasted') {
        stampEl.textContent = '已品尝';
      } else if (entry.status === 'discovered') {
        stampEl.textContent = '已发现';
      } else {
        stampEl.textContent = '未发现';
      }
      card.appendChild(stampEl);

      const onSelect = () => {
        selectedFoodId = entry.id;
        render();
      };
      card.addEventListener('click', onSelect);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      });

      cardsEl.appendChild(card);
      if (entry.id === focusedCardId) card.focus();
    }

    // 渲染右侧详情阅读区
    detailEl.textContent = '';
    const selectedEntry = entries.find((e) => e.id === selectedFoodId);
    if (selectedEntry) {
      const detailHeader = document.createElement('div');
      detailHeader.className = 'pb-atlas-detail-header';

      const detailThumbWrap = document.createElement('div');
      detailThumbWrap.className = 'pb-atlas-detail-thumb-wrap';
      if (selectedEntry.isDiscovered && selectedEntry.thumbnail) {
        const detailImg = document.createElement('img');
        detailImg.className = 'pb-atlas-card-thumb';
        detailImg.src = selectedEntry.thumbnail;
        detailImg.alt = selectedEntry.displayName;
        detailImg.onerror = () => {
          detailImg.remove();
          detailThumbWrap.appendChild(createPlatePlaceholder(selectedEntry.status === 'unseen'));
        };
        detailThumbWrap.appendChild(detailImg);
      } else {
        detailThumbWrap.appendChild(createPlatePlaceholder(selectedEntry.status === 'unseen'));
      }
      detailHeader.appendChild(detailThumbWrap);

      const titleGroup = document.createElement('div');
      titleGroup.className = 'pb-atlas-detail-title-group';

      const detailName = document.createElement('h3');
      detailName.className = 'pb-atlas-detail-name';
      detailName.textContent = selectedEntry.displayName;
      titleGroup.appendChild(detailName);

      const detailRegion = document.createElement('div');
      detailRegion.className = 'pb-atlas-detail-region';
      detailRegion.textContent = selectedEntry.regionLabel || '神秘小吃 · 尚未解锁';
      titleGroup.appendChild(detailRegion);

      detailHeader.appendChild(titleGroup);
      detailEl.appendChild(detailHeader);

      // 描述文案
      const descEl = document.createElement('p');
      descEl.className = 'pb-atlas-detail-desc';
      descEl.textContent = selectedEntry.description;
      detailEl.appendChild(descEl);

      // 地点提示
      if (selectedEntry.locationHint) {
        const hintBox = document.createElement('div');
        hintBox.className = 'pb-atlas-detail-hint-box';
        const hintLabel = document.createElement('span');
        hintLabel.className = 'pb-atlas-detail-hint-label';
        hintLabel.textContent = '发现位置：';
        hintBox.appendChild(hintLabel);
        hintBox.appendChild(document.createTextNode(selectedEntry.locationHint));
        detailEl.appendChild(hintBox);
      }

      // 设为目标按钮
      const trackBtn = document.createElement('button');
      trackBtn.className = `pb-atlas-track-btn ${selectedEntry.isTracked ? 'is-tracking' : ''}`;
      if (selectedEntry.isTracked) {
        trackBtn.textContent = '正在追踪目标';
      } else {
        trackBtn.textContent = '设为目标';
      }

      if (!selectedEntry.isDiscovered || !selectedEntry.defaultVendorId) {
        trackBtn.disabled = true;
        trackBtn.textContent = '探索发现后可设为目标';
      } else {
        trackBtn.disabled = false;
        trackBtn.addEventListener('click', () => {
          if (typeof actions.track === 'function') {
            actions.track(selectedEntry.id, selectedEntry.defaultVendorId);
            render();
          }
        });
      }
      detailEl.appendChild(trackBtn);
    } else {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'pb-atlas-detail-desc';
      emptyMsg.textContent = '请从左侧选择一道小吃查看手账记录。';
      detailEl.appendChild(emptyMsg);
    }
  }

  // 3. 事件路由与键盘捕获
  function open() {
    if (isDisposed || isOpenState) return;
    isOpenState = true;
    lastFocusedElement = document.activeElement;

    modalEl.hidden = false;
    render();

    if (overlay && typeof overlay.open === 'function') {
      overlay.open('atlas', { returnFocus: lastFocusedElement });
    }

    dialogEl.focus();
  }

  function close() {
    if (!isOpenState) return;
    isOpenState = false;
    modalEl.hidden = true;
    confirmModalEl.hidden = true;
    messageEl.textContent = '';

    if (overlay && typeof overlay.close === 'function') {
      overlay.close('atlas');
    }
    if (overlay?.isOpen() && lastFocusedElement?.isConnected) lastFocusedElement.focus();
  }

  // 导出收藏
  exportBtnEl.addEventListener('click', () => {
    try {
      const snap = typeof getSnapshot === 'function' ? getSnapshot() : null;
      const jsonText = typeof actions.exportCollection === 'function'
        ? actions.exportCollection()
        : fallbackExport(snap);

      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pawborough-snack-atlas-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      messageEl.textContent = '图鉴收藏已成功导出。';
    } catch (_err) {
      messageEl.textContent = '导出失败，请重试。';
    }
  });

  // 导入收藏
  importBtnEl.addEventListener('click', () => {
    fileInputEl.value = '';
    fileInputEl.click();
  });

  fileInputEl.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let res;
      if (typeof actions.importCollection === 'function') {
        res = actions.importCollection(text);
      } else {
        const snap = typeof getSnapshot === 'function' ? getSnapshot() : null;
        res = fallbackImport(text, { registry, current: snap });
      }

      if (res && res.ok !== false) {
        messageEl.textContent = res.message || '图鉴收藏导入成功！';
        render();
      } else {
        messageEl.textContent = res?.message || '导入格式不正确，请确保为有效的图鉴文件。';
      }
    } catch (err) {
      messageEl.textContent = err.message || '导入文件解析失败。';
    }
  });

  // 清空图鉴（二次确认）
  resetBtnEl.addEventListener('click', () => {
    confirmModalEl.hidden = false;
    confirmCancelBtn.focus();
  });

  confirmCancelBtn.addEventListener('click', () => {
    confirmModalEl.hidden = true;
    resetBtnEl.focus();
  });

  confirmOkBtn.addEventListener('click', () => {
    confirmModalEl.hidden = true;
    if (typeof actions.resetCollection === 'function') {
      actions.resetCollection();
      messageEl.textContent = '图鉴收藏已清空。';
      render();
    }
    resetBtnEl.focus();
  });

  closeBtnEl.addEventListener('click', () => {
    close();
  });

  backdropEl.addEventListener('click', () => {
    close();
  });

  // 全局键盘监听器（Capture 阶段注册，优先消费与隔离游戏全局按键）
  function onWindowKeyDown(e) {
    if (e.repeat && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); return; }
    if (!isOpenState) {
      if ((e.key === 'b' || e.key === 'B') && !isEditableTarget(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        open();
      }
      return;
    }

    // 模态打开期间，隔绝所有全局游戏按键广播
    e.stopImmediatePropagation();

    // Escape 优先关闭二次确认对话框或模态（即便在 editable 元素内也生效）
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!confirmModalEl.hidden) {
        confirmModalEl.hidden = true;
        resetBtnEl.focus();
      } else {
        close();
      }
      return;
    }

    // B 键切换仅在非可编辑元素中生效
    if (e.key === 'b' || e.key === 'B') {
      if (!isEditableTarget(e.target)) {
        e.preventDefault();
        close();
      }
      return;
    }

    // Tab 焦点循环陷入保护（排除隐藏的 file input 及隐藏的确认对话框按钮，editable 内亦生效）
    if (e.key === 'Tab') {
      const activeModal = !confirmModalEl.hidden ? confirmBoxEl : dialogEl;
      const focusables = Array.from(activeModal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(isVisibleFocusable);

      if (focusables.length === 0) {
        e.preventDefault();
        activeModal.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      const currentIndex = focusables.indexOf(current);

      // 从 dialog 自身焦点或外部非 focusables 焦点处直接陷入
      if (currentIndex === -1 || !activeModal.contains(current) || current === activeModal) {
        e.preventDefault();
        if (e.shiftKey) {
          last.focus();
        } else {
          first.focus();
        }
        return;
      }

      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    // 卡片 Enter / 空格支持激活选择；原生按钮/输入框保留默认 Enter/Space
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target?.closest?.('.pb-atlas-card');
      if (card && dialogEl.contains(card)) {
        e.preventDefault();
        card.click();
        return;
      }
      if (e.key === ' ' && !isEditableTarget(e.target) && e.target?.tagName !== 'BUTTON') {
        e.preventDefault();
      }
      return;
    }
  }

  window.addEventListener('keydown', onWindowKeyDown, true);

  function dispose() {
    if (isDisposed) return;
    isDisposed = true;
    close();
    window.removeEventListener('keydown', onWindowKeyDown, true);
    if (modalEl && modalEl.parentNode) {
      modalEl.parentNode.removeChild(modalEl);
    }
  }

  return {
    open,
    close,
    render,
    dispose,
  };
}
