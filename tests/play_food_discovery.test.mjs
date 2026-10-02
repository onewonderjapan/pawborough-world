// 小吃发现逻辑测试契约 (M06: Food discovery probes & rules)
// Run: node tests/play_food_discovery.test.mjs
import { findDiscoveries } from '../scene-authoring/yuyuan-area/web/play/discovery.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -- ' + detail : ''}`);
  if (!cond) failures += 1;
};

// 构造基础模拟物理世界
function createMockWorld({
  supportY = 0,
  supportMap = new Map(),
  blockedSet = new Set(),
  losPass = true,
} = {}) {
  return {
    supportAt(x, z) {
      const key = `${Math.round(x * 100) / 100},${Math.round(z * 100) / 100}`;
      if (supportMap.has(key)) return supportMap.get(key);
      return supportY;
    },
    isBlocked(x, y, z) {
      const key = `${Math.round(x * 100) / 100},${Math.round(z * 100) / 100}`;
      return blockedSet.has(key);
    },
    hasLineOfSight(from, to) {
      if (typeof losPass === 'function') return losPass(from, to);
      return Boolean(losPass);
    },
  };
}

// 1. 距离边界测试: 7.99m (通过) vs 8.01m (拒绝)
{
  const world = createMockWorld();
  const v799 = {
    vendorId: 'v-near',
    foodId: 'food-near',
    groundY: 0,
    customerPoint: { x: 7.99, z: 0 },
    enabled: true,
  };
  const v801 = {
    vendorId: 'v-far',
    foodId: 'food-far',
    groundY: 0,
    customerPoint: { x: 8.01, z: 0 },
    enabled: true,
  };

  const res799 = findDiscoveries({
    feet: [0, 0, 0],
    world,
    vendors: [v799],
  });
  check('7.99m 在 8m 发现范围内', res799.includes('food-near'), JSON.stringify(res799));

  const res801 = findDiscoveries({
    feet: [0, 0, 0],
    world,
    vendors: [v801],
  });
  check('8.01m 超出 8m 发现范围', res801.length === 0, JSON.stringify(res801));
}

// 2. 高差边界测试: 1.99m (通过) vs 2.01m (拒绝)
{
  // 平缓斜坡：每 1m 降约 0.5m (<0.6m 连续性门槛)，整体落差 1.99m
  const world = createMockWorld({
    supportMap: new Map([
      ['0,0', 1.99],
      ['1,0', 1.5],
      ['2,0', 1.0],
      ['3,0', 0.5],
      ['4,0', 0.0],
    ]),
  });
  const vendor = {
    vendorId: 'v-elevated',
    foodId: 'food-elevated',
    groundY: 0,
    customerPoint: { x: 4.0, z: 0 },
    enabled: true,
  };

  const res199 = findDiscoveries({
    feet: [0, 1.99, 0],
    world,
    vendors: [vendor],
  });
  check('1.99m 高差在 2m 门限内可发现', res199.includes('food-elevated'), JSON.stringify(res199));

  const world201 = createMockWorld({
    supportMap: new Map([
      ['0,0', 2.01],
      ['1,0', 1.5],
      ['2,0', 1.0],
      ['3,0', 0.5],
      ['4,0', 0.0],
    ]),
  });
  const res201 = findDiscoveries({
    feet: [0, 2.01, 0],
    world: world201,
    vendors: [vendor],
  });
  check('2.01m 高差超出 2m 门限不可发现', res201.length === 0, JSON.stringify(res201));
}

// 3. 视线阻挡 (Wall / LOS)
{
  const blockedWorld = createMockWorld({ losPass: false });
  const clearWorld = createMockWorld({ losPass: true });
  const vendor = {
    vendorId: 'v-wall',
    foodId: 'food-wall',
    groundY: 0,
    customerPoint: { x: 3.0, z: 0 },
    enabled: true,
  };

  const resBlocked = findDiscoveries({
    feet: [0, 0, 0],
    world: blockedWorld,
    vendors: [vendor],
  });
  check('视线受阻 (wall) 不产生发现', resBlocked.length === 0);

  const resClear = findDiscoveries({
    feet: [0, 0, 0],
    world: clearWorld,
    vendors: [vendor],
  });
  check('视线清晰时正常发现', resClear.includes('food-wall'));
}

// 4. 屋顶与脚下悬空 (Roof / Source unsupported)
{
  const vendor = {
    vendorId: 'v-roof',
    foodId: 'food-roof',
    groundY: 0,
    customerPoint: { x: 3.0, z: 0 },
    enabled: true,
  };

  // 脚下无地面 (supportAt 为 null)
  const noGroundWorld = createMockWorld({
    supportMap: new Map([['0,0', null]]),
  });
  const resNoGround = findDiscoveries({
    feet: [0, 0, 0],
    world: noGroundWorld,
    vendors: [vendor],
  });
  check('脚下无地面支撑时拒绝发现', resNoGround.length === 0);

  // 站立在屋顶/空中 (脚点 Y=5.0，而地面 supportAt=0.0，高差 5.0m > 0.35m)
  const roofWorld = createMockWorld({ supportY: 0 });
  const resRoof = findDiscoveries({
    feet: [0, 5.0, 0],
    world: roofWorld,
    vendors: [vendor],
  });
  check('空中/屋顶源点 (高差>0.35m) 拒绝发现', resRoof.length === 0);
}

// 5. 跨水断层与目标无支撑 (Watergap / Target unsupported)
{
  const vendor = {
    vendorId: 'v-water',
    foodId: 'food-water',
    groundY: 0,
    customerPoint: { x: 4.0, z: 0 },
    enabled: true,
  };

  // 中间有水池（2.0m 处 supportAt 为 null）
  const waterWorld = createMockWorld({
    supportMap: new Map([
      ['2,0', null],
    ]),
  });
  const resWater = findDiscoveries({
    feet: [0, 0, 0],
    world: waterWorld,
    vendors: [vendor],
  });
  check('路径跨水 (中间地面缺失) 拒绝发现', resWater.length === 0);

  // 中间有大台阶/断层 (地面突变 > 0.6m)
  const cliffWorld = createMockWorld({
    supportMap: new Map([
      ['2,0', 0.75],
    ]),
  });
  const resCliff = findDiscoveries({
    feet: [0, 0, 0],
    world: cliffWorld,
    vendors: [vendor],
  });
  check('地面断层突变 > 0.6m 拒绝发现', resCliff.length === 0);

  // 目标点无支撑 (target unsupported: null)
  const unsuppTargetWorld = createMockWorld({
    supportMap: new Map([
      ['4,0', null],
    ]),
  });
  const resTargetUnsupp = findDiscoveries({
    feet: [0, 0, 0],
    world: unsuppTargetWorld,
    vendors: [vendor],
  });
  check('目标点无地面支撑拒绝发现', resTargetUnsupp.length === 0);

  // 目标点支撑面高差超限 (与 vendor.groundY 差值 > 0.2m)
  const targetMismatchWorld = createMockWorld({
    supportMap: new Map([
      ['4,0', 0.3], // vendor groundY 是 0，差值 0.3 > 0.2
    ]),
  });
  const resTargetMismatch = findDiscoveries({
    feet: [0, 0, 0],
    world: targetMismatchWorld,
    vendors: [vendor],
  });
  check('目标点支撑面高差超限 (>0.2m) 拒绝发现', resTargetMismatch.length === 0);
}

// 6. 禁用状态 (Disabled)
{
  const world = createMockWorld();
  const vDisabled = {
    vendorId: 'v-dis',
    foodId: 'food-dis',
    groundY: 0,
    customerPoint: { x: 2.0, z: 0 },
    enabled: false,
  };
  const vFoodDisabled = {
    vendorId: 'v-fdis',
    foodId: 'food-fdis',
    groundY: 0,
    customerPoint: { x: 2.0, z: 0 },
    enabled: true,
    food: { enabled: false },
  };

  const resDis = findDiscoveries({
    feet: [0, 0, 0],
    world,
    vendors: [vDisabled, vFoodDisabled],
  });
  check('vendor.enabled=false 与 food.enabled=false 均不产生发现', resDis.length === 0);
}

// 7. 一味多摊 (One food many vendors)
{
  const world = createMockWorld({
    supportMap: new Map([
      ['2,0', 0],
      ['4,0', 0],
    ]),
  });
  const v1 = {
    vendorId: 'v-xlb-1',
    foodId: 'xiaolongbao',
    groundY: 0,
    customerPoint: { x: 2.0, z: 0 },
    enabled: true,
  };
  const v2 = {
    vendorId: 'v-xlb-2',
    foodId: 'xiaolongbao',
    groundY: 0,
    customerPoint: { x: 4.0, z: 0 },
    enabled: true,
  };

  const resMany = findDiscoveries({
    feet: [0, 0, 0],
    world,
    vendors: [v1, v2],
  });
  check('多个有效摊位同属一味食物时返回唯一 foodId',
    resMany.length === 1 && resMany[0] === 'xiaolongbao',
    JSON.stringify(resMany)
  );

  // 其中一摊被挡，另一摊可达，仍能发现该食物
  const blockedWorld = createMockWorld({
    supportMap: new Map([['2,0', 0], ['4,0', 0]]),
    losPass: (from, to) => to[0] > 3.0, // 仅允许远处的 v2
  });
  const resOneValid = findDiscoveries({
    feet: [0, 0, 0],
    world: blockedWorld,
    vendors: [v1, v2],
  });
  check('多摊位中一摊被挡另一摊可达时成功发现',
    resOneValid.length === 1 && resOneValid[0] === 'xiaolongbao'
  );
}

// 8. 模式验证: ride vs orbit (以及 walk / play)
{
  const world = createMockWorld();
  const vendor = {
    vendorId: 'v-mode',
    foodId: 'food-mode',
    groundY: 0,
    customerPoint: { x: 2.0, z: 0 },
    enabled: true,
  };

  const resRide = findDiscoveries({
    feet: [0, 0, 0],
    mode: 'ride',
    world,
    vendors: [vendor],
  });
  check('ride 骑乘模式可以正常发现', resRide.includes('food-mode'));

  const resOrbit = findDiscoveries({
    feet: [0, 0, 0],
    mode: 'orbit',
    world,
    vendors: [vendor],
  });
  check('orbit 环绕/漫游模式禁止发现 (返回空数组)', resOrbit.length === 0);

  const resWalk = findDiscoveries({
    feet: [0, 0, 0],
    mode: 'walk',
    world,
    vendors: [vendor],
  });
  check('walk 模式可以正常发现', resWalk.includes('food-mode'));

  const resPlay = findDiscoveries({
    feet: [0, 0, 0],
    mode: 'play',
    world,
    vendors: [vendor],
  });
  check('play 模式可以正常发现', resPlay.includes('food-mode'));
}

// 9. 已发现跳过 (knownIds skip)
{
  const world = createMockWorld();
  const vendor = {
    vendorId: 'v-known',
    foodId: 'already-known',
    groundY: 0,
    customerPoint: { x: 2.0, z: 0 },
    enabled: true,
  };

  const resKnown = findDiscoveries({
    feet: [0, 0, 0],
    world,
    vendors: [vendor],
    knownIds: new Set(['already-known']),
  });
  check('已存在于 knownIds 的食物跳过发现', resKnown.length === 0);
}

// 10. 缺失探针 / 无效数据边界处理
{
  const vendor = {
    vendorId: 'v-test',
    foodId: 'food-test',
    groundY: 0,
    customerPoint: { x: 2.0, z: 0 },
    enabled: true,
  };

  check('缺少 world 探针返回空数组', findDiscoveries({ feet: [0, 0, 0], vendors: [vendor] }).length === 0);
  check('world 缺少 supportAt 探针返回空数组', findDiscoveries({ feet: [0, 0, 0], world: { isBlocked: () => false, hasLineOfSight: () => true }, vendors: [vendor] }).length === 0);
  check('feet 包含 NaN 返回空数组', findDiscoveries({ feet: [NaN, 0, 0], world: createMockWorld(), vendors: [vendor] }).length === 0);
  check('feet 为 null 返回空数组', findDiscoveries({ feet: null, world: createMockWorld(), vendors: [vendor] }).length === 0);

  // 胶囊中心受阻 (isBlocked at customerx, groundY + 0.48, z)
  const blockedCenterWorld = createMockWorld({
    blockedSet: new Set(['2,0']),
  });
  const resBlockedCenter = findDiscoveries({
    feet: [0, 0, 0],
    world: blockedCenterWorld,
    vendors: [vendor],
  });
  check('顾客点胶囊中心受阻拒不发现', resBlockedCenter.length === 0);
}

console.log(failures === 0 ? 'PLAY_FOOD_DISCOVERY PASS' : `PLAY_FOOD_DISCOVERY FAIL (${failures})`);
if (failures > 0) process.exit(1);
