// 玩法食品原型有界资源库与加载队列 (M05: Bounded model cache & loader queue)
// 纯逻辑模块，无 DOM / Three 依赖

export class FoodLibrary {
  /**
   * @param {Object} options
   * @param {Object} options.registry 食品注册表 (需具备 foodsById Map)
   * @param {Function} options.loader 异步加载函数 (foodId, foodMeta) => Promise<model>
   * @param {number} [options.maxResident=8] 最大常驻模型数
   * @param {number} [options.maxConcurrent=2] 最大并发下载数
   * @param {Function} [options.disposeModel] 单个模型释放回调，默认调用 model.dispose?.()
   */
  constructor({
    registry,
    loader,
    maxResident = 8,
    maxConcurrent = 2,
    disposeModel = (m) => m?.dispose?.(),
  } = {}) {
    if (!registry || !registry.foodsById) {
      throw new Error('FoodLibrary requires a valid registry with foodsById');
    }
    if (typeof loader !== 'function') {
      throw new Error('FoodLibrary requires an async loader function');
    }

    this.registry = registry;
    this.loader = loader;
    this.maxResident = Math.max(1, maxResident);
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.disposeModel = disposeModel;

    // 所有已知/请求过的条目 foodId -> entry
    this.entries = new Map();
    // LRU 常驻集合 foodId -> entry (按使用顺序，最旧在前，最新在后)
    this.residentMap = new Map();
    // 待加载队列 foodId[]
    this.queue = [];
    // 当前正在进行的 loader 数量
    this.activeLoaders = 0;
    // 销毁标志
    this.disposed = false;
    // 防止重复 dispose 同一模型引用
    this.disposedModels = new WeakSet();
  }

  /**
   * 申请食品模型原型，并由 ownerToken 锁定
   * @param {string} foodId
   * @param {any} ownerToken
   * @returns {Promise<any>}
   */
  acquire(foodId, ownerToken) {
    if (this.disposed) {
      return Promise.reject(new Error('FoodLibrary is disposed'));
    }

    if (!this.registry.foodsById.has(foodId)) {
      return Promise.reject(new Error(`Unknown food ID: ${foodId}`));
    }

    const token = ownerToken ?? Symbol(`owner-${foodId}`);

    let entry = this.entries.get(foodId);
    if (!entry) {
      entry = {
        foodId,
        phase: 'idle',
        owners: new Set(),
        model: null,
        error: null,
        resident: false,
        generation: 0,
        promise: null,
        resolvePromise: null,
        rejectPromise: null,
      };
      this.entries.set(foodId, entry);
    }

    // Ownership begins synchronously; a release before promise delivery must
    // remain released rather than becoming a pin in the completion microtask.
    entry.owners.add(token);
    // 1. 已驻留完成
    if (entry.resident && entry.model && entry.phase === 'resident') {
      const cachedModel = entry.model;
      const cachedGen = entry.generation;
      return Promise.resolve().then(() => {
        if (
          !this.disposed &&
          entry.generation === cachedGen &&
          entry.model === cachedModel &&
          entry.resident
        ) {
          // 刷新 LRU 顺序
          this.residentMap.delete(foodId);
          this.residentMap.set(foodId, entry);
          return cachedModel;
        }
        throw new Error('FoodLibrary is disposed');
      });
    }

    // 2. 正在加载中
    if (entry.phase === 'loading' && entry.promise) {
      return entry.promise;
    }

    // 3. 已在排队中
    if (entry.phase === 'queued' && entry.promise) {
      return entry.promise;
    }

    // 4. 空闲或上一轮失败重试
    entry.error = null;
    entry.generation++;
    entry.promise = new Promise((resolve, reject) => {
      entry.resolvePromise = resolve;
      entry.rejectPromise = reject;
    });

    entry.phase = 'queued';
    this.queue.push(foodId);

    this._processQueue();

    return entry.promise;
  }

  /**
   * 释放特定 ownerToken 对食品模型的锁定
   * @param {string} foodId
   * @param {any} ownerToken
   * @returns {boolean} 是否成功释放
   */
  release(foodId, ownerToken) {
    if (this.disposed) return false;

    const entry = this.entries.get(foodId);
    if (!entry || !entry.owners.has(ownerToken)) {
      return false;
    }

    entry.owners.delete(ownerToken);

    // 若当前已无任何 owner 锁定
    if (entry.owners.size === 0) {
      this._processQueue();
    }

    return true;
  }

  /**
   * 查询特定食品的当前状态
   * @param {string} foodId
   */
  getStatus(foodId) {
    const inRegistry = Boolean(this.registry?.foodsById?.has(foodId));
    const entry = this.entries.get(foodId);

    if (!entry) {
      return {
        foodId,
        phase: inRegistry ? 'idle' : 'unknown',
        loading: false,
        error: null,
        owners: 0,
        ownerTokens: [],
        pinned: false,
        resident: false,
      };
    }

    return {
      foodId,
      phase: entry.phase,
      loading: entry.phase === 'loading',
      error: entry.error ?? null,
      owners: entry.owners.size,
      ownerTokens: Array.from(entry.owners),
      pinned: entry.owners.size > 0,
      resident: entry.resident && Boolean(entry.model),
    };
  }

  /**
   * 查询资源库全局运行统计
   */
  status() {
    let pinnedCount = 0;
    let unpinnedCount = 0;

    for (const entry of this.residentMap.values()) {
      if (entry.owners.size > 0) {
        pinnedCount++;
      } else {
        unpinnedCount++;
      }
    }

    const safeLoading = Math.max(0, this.activeLoaders);
    return {
      residentCount: this.residentMap.size,
      pinnedCount,
      unpinnedCount,
      loadingCount: safeLoading,
      queuedCount: this.queue.length,
      transientCount: Math.max(0, this.residentMap.size + safeLoading),
      maxResident: this.maxResident,
      maxConcurrent: this.maxConcurrent,
      disposed: this.disposed,
    };
  }

  /**
   * 销毁资源库，清空队列与缓存并释放所有模型
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    // 1. 失效所有条目并在途 reject
    for (const entry of this.entries.values()) {
      entry.generation++;
      if (entry.rejectPromise && (entry.phase === 'queued' || entry.phase === 'loading')) {
        entry.rejectPromise(new Error('FoodLibrary disposed'));
      }
      this._cleanupPromises(entry);
      entry.owners.clear();
      entry.phase = 'idle';
      entry.resident = false;
    }

    // 2. 清空待处理队列
    this.queue.length = 0;

    // 3. 释放并清空所有常驻原型
    for (const [foodId, entry] of this.residentMap) {
      if (entry.model) {
        this._safeDisposeModel(entry.model);
        entry.model = null;
      }
      entry.resident = false;
    }
    this.residentMap.clear();
  }

  // ================= 内部调度私有方法 =================

  _processQueue() {
    if (this.disposed) return;

    while (this.queue.length > 0 && this.activeLoaders < this.maxConcurrent) {
      const nextId = this.queue[0];
      const entry = this.entries.get(nextId);
      if (!entry || entry.phase !== 'queued') {
        this.queue.shift();
        continue;
      }

      // 检查常驻预算：常驻数 + 在途加载数必须保持 <= maxResident
      if (this.residentMap.size + this.activeLoaders >= this.maxResident) {
        const oldestUnpinnedId = this._getOldestUnpinnedId();
        if (!oldestUnpinnedId) {
          // 全部常驻项均被锁定，不可淘汰，挂起等待释放
          break;
        }
        this._evict(oldestUnpinnedId);
      }

      this.queue.shift();
      this._startLoading(entry);
    }
  }

  async _startLoading(entry) {
    const foodId = entry.foodId;
    const currentGen = entry.generation;

    this.activeLoaders++;
    entry.phase = 'loading';

    try {
      const meta = this.registry.foodsById.get(foodId);
      const model = await this.loader(foodId, meta);

      this.activeLoaders = Math.max(0, this.activeLoaders - 1);

      // 若在此期间资源库已销毁或代际失效（teardown / cancel）
      if (this.disposed || entry.generation !== currentGen) {
        this._safeDisposeModel(model);
        if (entry.rejectPromise) {
          entry.rejectPromise(new Error('FoodLibrary disposed'));
        }
        this._cleanupPromises(entry);
        return;
      }

      // 如果常驻缓存已满，淘汰最旧未锁定的条目
      if (this.residentMap.size >= this.maxResident && !this.residentMap.has(foodId)) {
        const oldestUnpinnedId = this._getOldestUnpinnedId();
        if (oldestUnpinnedId) {
          this._evict(oldestUnpinnedId);
        }
      }

      entry.model = model;
      entry.resident = true;
      entry.phase = 'resident';
      entry.error = null;
      this.residentMap.set(foodId, entry);

      if (entry.resolvePromise) {
        entry.resolvePromise(model);
      }
      this._cleanupPromises(entry);

      this._processQueue();
    } catch (err) {
      this.activeLoaders = Math.max(0, this.activeLoaders - 1);

      if (this.disposed || entry.generation !== currentGen) {
        if (entry.rejectPromise) {
          entry.rejectPromise(new Error('FoodLibrary disposed'));
        }
        this._cleanupPromises(entry);
        return;
      }

      entry.phase = 'error';
      entry.error = err;
      entry.resident = false;
      entry.model = null;

      if (entry.rejectPromise) {
        entry.rejectPromise(err);
      }
      this._cleanupPromises(entry);

      this._processQueue();
    }
  }

  _getOldestUnpinnedId() {
    for (const [id, entry] of this.residentMap) {
      if (entry.owners.size === 0) {
        return id;
      }
    }
    return null;
  }

  _evict(foodId) {
    const entry = this.residentMap.get(foodId);
    if (!entry) return;

    this.residentMap.delete(foodId);
    if (entry.model) {
      this._safeDisposeModel(entry.model);
      entry.model = null;
    }
    entry.resident = false;
    entry.phase = 'idle';
  }

  _safeDisposeModel(model) {
    if (!model) return;
    if (this.disposedModels.has(model)) return;
    this.disposedModels.add(model);
    try {
      this.disposeModel(model);
    } catch (err) {
      console.error('Error during disposeModel callback:', err);
    }
  }

  _cleanupPromises(entry) {
    entry.promise = null;
    entry.resolvePromise = null;
    entry.rejectPromise = null;
  }
}
