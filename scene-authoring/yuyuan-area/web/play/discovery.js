// 玩家与小吃摊发现逻辑 (M06: Reachable vendors / food discovery)
// 纯几何与物理探针判定，无 DOM 依赖

/**
 * 检查世界指定高度是否受阻
 */
function isWorldBlocked(world, x, y, z) {
  if (!world || typeof world.isBlocked !== 'function') return false;
  // 若探针只接收 (x, z)，以两参数调用；否则传入 (x, y, z)
  if (world.isBlocked.length === 2) {
    return Boolean(world.isBlocked(x, z));
  }
  return Boolean(world.isBlocked(x, y, z));
}

/**
 * 探查当前位置是否可以发现未收集的小吃
 * 
 * @param {Object} options
 * @param {[number, number, number]|{x:number, y:number, z:number}} options.feet 玩家脚点
 * @param {string} [options.mode='walk'] 玩家移动模式 ('walk'|'play'|'ride' 可发现，'orbit' 排除)
 * @param {Object} options.world 物理环境探针 { supportAt(x, z), isBlocked(x, y, z), hasLineOfSight(fromArray, toArray) }
 * @param {Array|Map|Object} options.vendors 候选摊位列表
 * @param {Set<string>|Array<string>} [options.knownIds=new Set()] 已知/已发现的 foodId
 * @returns {string[]} 发现的唯一 foodId 数组
 */
export function findDiscoveries({
  feet,
  mode = 'walk',
  world,
  vendors,
  knownIds = new Set(),
} = {}) {
  // 1. 探针与输入完整性校验：缺少必要探针或数据无效则直接返回空
  if (
    !world ||
    typeof world.supportAt !== 'function' ||
    typeof world.isBlocked !== 'function' ||
    typeof world.hasLineOfSight !== 'function'
  ) {
    return [];
  }

  // 2. 模式排他性判定：'orbit' 模式禁止发现，'walk'/'play'/'ride' 均可正常发现
  if (mode === 'orbit') {
    return [];
  }
  const allowedModes = new Set(['walk', 'play', 'ride']);
  if (!allowedModes.has(mode)) {
    return [];
  }

  // 3. 玩家脚点解析与支撑面探查
  if (!feet) return [];
  const fx = Array.isArray(feet) ? feet[0] : feet?.x;
  const fy = Array.isArray(feet) ? feet[1] : feet?.y;
  const fz = Array.isArray(feet) ? feet[2] : feet?.z;
  if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) {
    return [];
  }

  // sourcefeet support within .35m: 脚点必须踩在已登记支撑面上，防空中/屋顶/掉出世界
  const feetSupport = world.supportAt(fx, fz);
  if (feetSupport === null || feetSupport === undefined || !Number.isFinite(feetSupport)) {
    return [];
  }
  if (Math.abs(feetSupport - fy) > 0.35) {
    return [];
  }

  // 4. 摊位列表规范化
  if (!vendors) return [];
  const vendorList = Array.isArray(vendors)
    ? vendors
    : (vendors instanceof Map
        ? Array.from(vendors.values())
        : (typeof vendors === 'object' ? Object.values(vendors) : []));

  const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
  const discovered = [];
  const discoveredFoodIds = new Set();

  for (const v of vendorList) {
    if (!v || typeof v !== 'object') continue;

    // 禁用态校验：摊位或食品为 disabled 时永不发现
    if (v.enabled === false) continue;
    if (v.food?.enabled === false) continue;

    const vendorId = v.vendorId ?? v.id;
    const foodId = v.foodId;
    if (!vendorId || !foodId) continue;

    // 已知或本轮已发现的小吃跳过（去重）
    if (known.has(foodId) || discoveredFoodIds.has(foodId)) continue;

    // 摊位地面高程与顾客点几何
    const groundY = v.groundY;
    if (groundY === null || groundY === undefined || !Number.isFinite(groundY)) continue;

    const cp = v.customerPoint;
    if (!cp) continue;
    let cx, cz;
    if (Array.isArray(cp)) {
      cx = cp[0];
      cz = cp.length === 2 ? cp[1] : cp[2];
    } else if (typeof cp === 'object') {
      cx = cp.x;
      cz = cp.z;
    }
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;

    // 5. 距离与高差硬门槛：XZ radius <= 8m, |feetY - groundY| <= 2m
    const dx = cx - fx;
    const dz = cz - fz;
    const distXZ = Math.hypot(dx, dz);
    if (distXZ > 8.0) continue;
    if (Math.abs(fy - groundY) > 2.0) continue;

    // 6. 目标点支撑面校验：customer point has supported ground within .2m
    const custSupport = world.supportAt(cx, cz);
    if (custSupport === null || custSupport === undefined || !Number.isFinite(custSupport)) continue;
    if (Math.abs(custSupport - groundY) > 0.2) continue;

    // 7. 目标点胶囊中心无阻挡：!world.isBlocked(customerx, groundY + .48, z)
    if (isWorldBlocked(world, cx, groundY + 0.48, cz)) continue;

    // 8. 视线畅通（LOS）：line-of-sight from feet + .55 to customerGround + .8
    const fromEye = [fx, fy + 0.55, fz];
    const toTarget = [cx, groundY + 0.8, cz];
    if (!world.hasLineOfSight(fromEye, toTarget)) continue;

    // 9. 连续地面通行探查：沿脚点到目标点每 1m 采样地面支撑面，不得缺失或断层 > 0.6m（防隔水/隔空发现）
    let pathContinuous = true;
    let prevSampleY = feetSupport;
    if (distXZ > 0) {
      for (let d = 1.0; d < distXZ; d += 1.0) {
        const t = d / distXZ;
        const sx = fx + dx * t;
        const sz = fz + dz * t;
        const sY = world.supportAt(sx, sz);
        if (sY === null || sY === undefined || !Number.isFinite(sY)) {
          pathContinuous = false;
          break;
        }
        if (Math.abs(sY - prevSampleY) > 0.6) {
          pathContinuous = false;
          break;
        }
        prevSampleY = sY;
      }
    }
    if (!pathContinuous) continue;
    // 最终采样点与顾客点地面衔接高差断层 <= 0.6m
    if (Math.abs(custSupport - prevSampleY) > 0.6) continue;

    // 全部通过，成功发现
    discoveredFoodIds.add(foodId);
    discovered.push(foodId);
  }

  return discovered;
}
