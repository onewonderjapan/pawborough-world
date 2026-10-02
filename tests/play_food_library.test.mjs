// 玩法食品原型资源库契约测试 (M05: Bounded model cache & loader queue)
// Run: node tests/play_food_library.test.mjs
import assert from 'node:assert';
import { FoodLibrary } from '../scene-authoring/yuyuan-area/web/play/food-library.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

function createMockRegistry(foodIds = []) {
  const foodsById = new Map();
  for (const id of foodIds) {
    foodsById.set(id, { id, name: `Mock ${id}`, assetPath: `assets/${id}.glb` });
  }
  return { foodsById };
}

function defer() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function runTests() {
  console.log('--- cached acquire respects same-turn release ---');
  {
    const library=new FoodLibrary({registry:createMockRegistry(['a','b']),maxResident:1,loader:async id=>({id})});
    await library.acquire('a','seed');library.release('a','seed');
    const pending=library.acquire('a','departing');
    assert.equal(library.release('a','departing'),true,'cached owner must be registered synchronously');
    await pending;assert.equal(library.getStatus('a').owners,0,'released cached owner must not reappear');
    assert.equal((await library.acquire('b','next')).id,'b','no ghost owner can strand the next model');
    library.dispose();
  }
  console.log('--- TEST 1: concurrent ids max2 ---');
  {
    const reg = createMockRegistry(['f1', 'f2', 'f3', 'f4']);
    let currentConcurrent = 0;
    let maxObservedConcurrent = 0;
    const defers = {
      f1: defer(),
      f2: defer(),
      f3: defer(),
    };

    const loader = async (foodId) => {
      currentConcurrent++;
      if (currentConcurrent > maxObservedConcurrent) {
        maxObservedConcurrent = currentConcurrent;
      }
      if (defers[foodId]) {
        await defers[foodId].promise;
      }
      currentConcurrent--;
      return { id: foodId, disposed: false };
    };

    const lib = new FoodLibrary({
      registry: reg,
      loader,
      maxResident: 8,
      maxConcurrent: 2,
    });

    const p1 = lib.acquire('f1', 'tok1');
    const p2 = lib.acquire('f2', 'tok2');
    const p3 = lib.acquire('f3', 'tok3');

    // Yield tick so loaders start
    await new Promise((r) => setTimeout(r, 10));

    check('并发初始不超过2', maxObservedConcurrent === 2);
    check('f3 处于排队中', lib.getStatus('f3').phase === 'queued');
    check('status loadingCount 为 2', lib.status().loadingCount === 2);
    check('status queuedCount 为 1', lib.status().queuedCount === 1);

    // Resolve f1
    defers.f1.resolve();
    await p1;
    await new Promise((r) => setTimeout(r, 10));

    check('f1 完成后 f3 开始加载', lib.getStatus('f3').phase === 'loading');
    check('并发从未超过2', maxObservedConcurrent <= 2);

    // Resolve remaining
    defers.f2.resolve();
    defers.f3.resolve();
    await Promise.all([p2, p3]);

    check('全部完成后 loadingCount 为 0', lib.status().loadingCount === 0);
    check('全部完成后 residentCount 为 3', lib.status().residentCount === 3);
    lib.dispose();
  }

  console.log('--- TEST 2: samefood downloadedonce & deduplicates promise ---');
  {
    const reg = createMockRegistry(['xiaolongbao']);
    let downloadCount = 0;
    const loader = async (id) => {
      downloadCount++;
      await new Promise((r) => setTimeout(r, 10));
      return { id, tag: 'xlb-prototype' };
    };

    const lib = new FoodLibrary({ registry: reg, loader });

    const [m1, m2] = await Promise.all([
      lib.acquire('xiaolongbao', 'tokenA'),
      lib.acquire('xiaolongbao', 'tokenB'),
    ]);

    check('同食物仅下载一次', downloadCount === 1);
    check('不同 token 获得同一模型引用', m1 === m2);
    check('拥有两个 owner', lib.getStatus('xiaolongbao').owners === 2);
    check('foodId 状态为 pinned', lib.getStatus('xiaolongbao').pinned === true);
    lib.dispose();
  }

  console.log('--- TEST 3: duplicateownerreleasecountstable ---');
  {
    const reg = createMockRegistry(['congyoubing']);
    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => ({ id }),
    });

    await lib.acquire('congyoubing', 'handToken');
    await lib.acquire('congyoubing', 'handToken'); // duplicate acquire with same token

    check('重复 token 申请去重，owner 为 1', lib.getStatus('congyoubing').owners === 1);

    const rel1 = lib.release('congyoubing', 'handToken');
    check('首次释放返回 true', rel1 === true);
    check('释放后 owner 计数为 0', lib.getStatus('congyoubing').owners === 0);
    check('释放后 unpinned 仍驻留 LRU', lib.getStatus('congyoubing').resident === true);

    const rel2 = lib.release('congyoubing', 'handToken');
    check('再次释放幂等返回 false', rel2 === false);
    check('owner 计数保持稳定为 0', lib.getStatus('congyoubing').owners === 0);
    lib.dispose();
  }

  console.log('--- TEST 4: failurethenretry (no global failure) ---');
  {
    const reg = createMockRegistry(['bad_snack', 'good_snack']);
    let failAttempt = true;

    const loader = async (id) => {
      if (id === 'bad_snack' && failAttempt) {
        throw new Error('Network 500 error');
      }
      return { id };
    };

    const lib = new FoodLibrary({ registry: reg, loader });

    let errCaught = null;
    try {
      await lib.acquire('bad_snack', 't1');
    } catch (e) {
      errCaught = e;
    }
    check('加载失败抛出异常', errCaught !== null);
    check('失败食品 status 记录 error', lib.getStatus('bad_snack').error !== null);
    check('失败食品 phase 为 error', lib.getStatus('bad_snack').phase === 'error');

    // Other snack unaffected
    const good = await lib.acquire('good_snack', 't2');
    check('其他食物不受影响正常加载', good && good.id === 'good_snack');

    // Retry bad_snack after network recovery
    failAttempt = false;
    const retryModel = await lib.acquire('bad_snack', 't1');
    check('重新尝试成功获取模型', retryModel && retryModel.id === 'bad_snack');
    check('重试成功后 phase 为 resident', lib.getStatus('bad_snack').phase === 'resident');
    check('重试成功后 error 清空', lib.getStatus('bad_snack').error === null);
    lib.dispose();
  }

  console.log('--- TEST 5: pin retained while others LRU evict ---');
  {
    const reg = createMockRegistry([
      'pinned_0',
      'item_1', 'item_2', 'item_3', 'item_4',
      'item_5', 'item_6', 'item_7', 'item_8', 'item_9'
    ]);

    const disposedIds = [];
    const disposeModel = (m) => {
      m.disposed = true;
      disposedIds.push(m.id);
    };

    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => ({ id, disposed: false }),
      maxResident: 8,
      maxConcurrent: 2,
      disposeModel,
    });

    // Pin pinned_0
    await lib.acquire('pinned_0', 'pinnedToken');

    // Load and immediately release items 1 to 7 -> total 8 resident (1 pinned, 7 unpinned)
    for (let i = 1; i <= 7; i++) {
      const id = `item_${i}`;
      await lib.acquire(id, `temp_${i}`);
      lib.release(id, `temp_${i}`);
    }

    check('8个就绪时 residentCount 为 8', lib.status().residentCount === 8);
    check('其中 1 个 pinned, 7 个 unpinned', lib.status().pinnedCount === 1 && lib.status().unpinnedCount === 7);

    // Now load item_8 and item_9
    await lib.acquire('item_8', 'temp_8');
    lib.release('item_8', 'temp_8');

    await lib.acquire('item_9', 'temp_9');
    lib.release('item_9', 'temp_9');

    check('常驻模型数量始终 <= 8', lib.status().residentCount <= 8);
    check('pinned_0 绝对不被淘汰', lib.getStatus('pinned_0').resident === true);
    check('pinned_0 未被 dispose', !disposedIds.includes('pinned_0'));
    check('最先 unpinned 的 item_1 被淘汰并 dispose', disposedIds.includes('item_1'));
    lib.dispose();
  }

  console.log('--- TEST 6: allpinnedqueues/releaseunblocks ---');
  {
    const reg = createMockRegistry([
      'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'
    ]);
    const disposedIds = [];
    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => ({ id }),
      maxResident: 8,
      maxConcurrent: 2,
      disposeModel: (m) => disposedIds.push(m.id),
    });

    // Pin all 8
    for (let i = 1; i <= 8; i++) {
      await lib.acquire(`p${i}`, `pin_tok_${i}`);
    }
    check('8个全部 pinned 且 resident', lib.status().pinnedCount === 8 && lib.status().residentCount === 8);

    // Request 9th
    let p9Resolved = false;
    const p9Promise = lib.acquire('p9', 'tok_9').then((m) => {
      p9Resolved = true;
      return m;
    });

    await new Promise((r) => setTimeout(r, 10));
    check('全 pin 情况下第 9 个必须排队', lib.getStatus('p9').phase === 'queued');
    check('p9 尚未 resolve', p9Resolved === false);
    check('loadingCount 仍为 0', lib.status().loadingCount === 0);

    // Release p1
    lib.release('p1', 'pin_tok_1');
    const m9 = await p9Promise;

    check('释放 p1 后 p9 解锁并成功获取', m9 && m9.id === 'p9');
    check('p1 被淘汰并释放', disposedIds.includes('p1'));
    check('residentCount 维持 <= 8', lib.status().residentCount <= 8);
    lib.dispose();
  }

  console.log('--- TEST 7: latearrival afterdispose freedexactlyonce and callers reject ---');
  {
    const reg = createMockRegistry(['slow_food']);
    const d = defer();
    let disposeCount = 0;

    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => {
        await d.promise;
        return { id, val: 'slow' };
      },
      disposeModel: (m) => {
        disposeCount++;
      },
    });

    let callerRejected = false;
    const p = lib.acquire('slow_food', 't1').catch((err) => {
      callerRejected = true;
    });

    await new Promise((r) => setTimeout(r, 10));
    check('开始加载中', lib.getStatus('slow_food').phase === 'loading');

    // Teardown during loading
    lib.dispose();
    await p;
    check('销毁时等待中的 acquire reject', callerRejected === true);

    // Late arrival resolves after dispose
    d.resolve();
    await new Promise((r) => setTimeout(r, 10));

    check('晚到的模型被正好释放一次', disposeCount === 1);
    check('销毁后 resident 清空', lib.status().residentCount === 0);

    // Repeated dispose is idempotent
    lib.dispose();
    check('重复 dispose 不会再次触发释放', disposeCount === 1);
  }

  console.log('--- TEST 8: release-before-loaded does not resurrect pin ---');
  {
    const reg = createMockRegistry(['pre_release']);
    const d = defer();
    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => {
        await d.promise;
        return { id };
      },
    });

    const p = lib.acquire('pre_release', 'cancelToken');
    check('加载中拥有 owner', lib.getStatus('pre_release').owners === 1);

    // Release before loader completes
    const rel = lib.release('pre_release', 'cancelToken');
    check('加载中释放成功返回 true', rel === true);
    check('加载中释放后 owners 为 0', lib.getStatus('pre_release').owners === 0);

    // Now resolve loader
    d.resolve();
    await p;

    check('完成加载后不会复活 pin', lib.getStatus('pre_release').owners === 0);
    check('完成加载后 pinned 为 false', lib.getStatus('pre_release').pinned === false);
    check('完成加载后仍驻留 LRU 供复用', lib.getStatus('pre_release').resident === true);
    lib.dispose();
  }

  console.log('--- TEST 9: unknowniderror ---');
  {
    const reg = createMockRegistry(['valid_one']);
    let loaderCalled = false;
    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => {
        loaderCalled = true;
        return { id };
      },
    });

    let errCaught = null;
    try {
      await lib.acquire('unknown_xyz', 't1');
    } catch (e) {
      errCaught = e;
    }

    check('未知 foodId 拒绝 acquire', errCaught !== null);
    check('未知 foodId 不会触发 loader', loaderCalled === false);
    check('未知 foodId getStatus phase 为 unknown', lib.getStatus('unknown_xyz').phase === 'unknown');
    lib.dispose();
  }

  console.log('--- TEST 10: shared token pinning safety ---');
  {
    const reg = createMockRegistry(['shared_food']);
    let disposed = false;
    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => ({ id }),
      disposeModel: () => { disposed = true; },
    });

    await lib.acquire('shared_food', 'user1');
    await lib.acquire('shared_food', 'user2');

    check('两个用户 pin 同一模型', lib.getStatus('shared_food').owners === 2);

    // user1 releases
    const r1 = lib.release('shared_food', 'user1');
    check('user1 释放成功', r1 === true);
    check('user2 依然持有，处于 pinned 状态', lib.getStatus('shared_food').pinned === true);
    check('user2 依然持有，不可被 dispose', disposed === false);

    // user2 releases
    const r2 = lib.release('shared_food', 'user2');
    check('user2 释放成功', r2 === true);
    check('全部释放后 pinned 为 false', lib.getStatus('shared_food').pinned === false);
    check('仍在 LRU 缓存未被淘汰时不销毁', disposed === false);

    lib.dispose();
    check('dispose 后正式销毁', disposed === true);
  }

  console.log('--- TEST 11: admission budget reserves active loads (bug 1) ---');
  {
    const reg = createMockRegistry(['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9']);
    const defers = {
      f8: defer(),
      f9: defer(),
    };
    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => {
        if (defers[id]) {
          await defers[id].promise;
        }
        return { id };
      },
      maxResident: 8,
      maxConcurrent: 2,
    });

    // 1. Start 7 pinned resident
    for (let i = 1; i <= 7; i++) {
      await lib.acquire(`f${i}`, `pin_${i}`);
    }
    check('初始7个全部 pinned 且 resident', lib.status().residentCount === 7 && lib.status().pinnedCount === 7);

    // 2. Request f8 and f9
    let f8Done = false;
    let f9Done = false;
    const p8 = lib.acquire('f8', 'pin_8').then((m) => { f8Done = true; return m; });
    const p9 = lib.acquire('f9', 'pin_9').then((m) => { f9Done = true; return m; });

    await new Promise((r) => setTimeout(r, 10));

    // expect only f8 start, f9 queued
    check('仅有 f8 开始加载', lib.getStatus('f8').phase === 'loading');
    check('f9 处于排队中', lib.getStatus('f9').phase === 'queued');
    check('activeLoaders 为 1', lib.status().loadingCount === 1);

    // 3. After f8 completes
    defers.f8.resolve();
    await p8;
    check('f8 完成加载', f8Done === true);

    await new Promise((r) => setTimeout(r, 10));

    // after 8 complete still f9 queued until release
    check('f8 完成后 f9 仍处于排队中', lib.getStatus('f9').phase === 'queued');
    check('f9 尚未完成加载', f9Done === false);
    check('当前常驻数为 8', lib.status().residentCount === 8);

    // 4. Release f1
    lib.release('f1', 'pin_1');
    defers.f9.resolve();
    await p9;

    check('释放 pin 后 f9 成功完成加载', f9Done === true);
    check('最终常驻数量 <= 8', lib.status().residentCount <= 8);

    lib.dispose();
  }

  console.log('--- TEST 12: resident cache hit guarded against same-turn dispose (bug 2) ---');
  {
    const reg = createMockRegistry(['food_cache']);
    let modelInstance = { id: 'food_cache', disposed: false };
    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => modelInstance,
      disposeModel: (m) => { m.disposed = true; },
    });

    // await firstload
    const first = await lib.acquire('food_cache', 'owner1');
    check('首次加载成功且常驻', first && lib.getStatus('food_cache').resident === true);

    // cached = acquire(food, owner2); dispose();
    let deliveredModel = null;
    const cached = lib.acquire('food_cache', 'owner2');
    cached.then((m) => { deliveredModel = m; }).catch(() => {});

    lib.dispose();

    // assert.rejects(cached)
    let rejected = false;
    try {
      await assert.rejects(cached);
      rejected = true;
    } catch {
      rejected = false;
    }
    check('assert.rejects(cached) 成功拒绝', rejected);
    check('未交付已销毁的模型原型', deliveredModel === null);
    check('销毁后条目未新增 owner2', !lib.getStatus('food_cache').ownerTokens.includes('owner2'));
    check('销毁后 owners 为 0', lib.getStatus('food_cache').owners === 0);
  }

  console.log('--- TEST 13: dispose with in-flight worker tracks activeLoaders safely (bug 3) ---');
  {
    const reg = createMockRegistry(['inflight_food']);
    const d = defer();
    let disposedCount = 0;
    const lib = new FoodLibrary({
      registry: reg,
      loader: async (id) => {
        await d.promise;
        return { id };
      },
      disposeModel: () => { disposedCount++; },
    });

    const p = lib.acquire('inflight_food', 'owner_inf').catch((e) => e);
    check('开始加载中 loadingCount 为 1', lib.status().loadingCount === 1);

    // dispose while in-flight
    lib.dispose();
    const stMid = lib.status();
    check('dispose 后在途作业 loadingCount >= 0', stMid.loadingCount >= 0);
    check('dispose 后在途作业 transientCount >= 0', stMid.transientCount >= 0);
    check('dispose 后在途作业 loadingCount 为 1', stMid.loadingCount === 1);

    // Resolve in-flight loader
    d.resolve();
    await p;
    await new Promise((r) => setTimeout(r, 10));

    const stAfter = lib.status();
    check('在途作业完成后 loadingCount 为 0', stAfter.loadingCount === 0);
    check('在途作业完成后 transientCount 为 0', stAfter.transientCount === 0);
    check('晚到模型被释放', disposedCount === 1);
  }

  console.log('\n==================================');
  if (failures > 0) {
    console.log(`TEST FAILED: ${failures} failure(s)`);
    process.exit(1);
  } else {
    console.log('ALL TESTS PASSED: PLAY_FOOD_LIBRARY GREEN');
  }
}

runTests().catch((err) => {
  console.error('Unhandled test harness error:', err);
  process.exit(1);
});
