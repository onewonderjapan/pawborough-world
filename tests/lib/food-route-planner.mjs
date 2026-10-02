import RAPIER from '@dimforge/rapier3d-compat';

class MinHeap {
  constructor() { this.items = []; }
  push(item, priority) {
    this.items.push({ item, priority });
    this._bubbleUp(this.items.length - 1);
  }
  pop() {
    if (!this.items.length) return null;
    const top = this.items[0];
    const bottom = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = bottom;
      this._bubbleDown(0);
    }
    return top.item;
  }
  size() { return this.items.length; }
  _bubbleUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[i].priority < this.items[p].priority) {
        [this.items[i], this.items[p]] = [this.items[p], this.items[i]];
        i = p;
      } else break;
    }
  }
  _bubbleDown(i) {
    const len = this.items.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < len && this.items[l].priority < this.items[smallest].priority) smallest = l;
      if (r < len && this.items[r].priority < this.items[smallest].priority) smallest = r;
      if (smallest !== i) {
        [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
        i = smallest;
      } else break;
    }
  }
}

export class FoodRoutePlanner {
  constructor({ physics, groundColliders, RAPIER: rapier = RAPIER }) {
    this.physics = physics;
    this.groundColliders = groundColliders;
    this.RAPIER = rapier;
    this.capsuleShape = new this.RAPIER.Capsule(0.2, 0.28);
    this.probeCache = new Map();
  }

  getGroundHandles() {
    const colliders = typeof this.groundColliders === 'function'
      ? this.groundColliders()
      : this.groundColliders;
    return new Set(colliders.map(c => c.handle));
  }

  supportAt(x, z, fromY = 8, maxToi = 12) {
    const gh = this.getGroundHandles();
    if (!gh.size) return null;
    const ray = new this.RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.physics.world.castRay(
      ray, maxToi, true, undefined, undefined, undefined, undefined,
      c => gh.has(c.handle)
    );
    const y = hit ? fromY - hit.timeOfImpact : null;
    return y !== null && y >= -0.1 ? y : null;
  }

  wallOverlap(x, y, z, yaw = 0, excludeHandles = null) {
    const gh = this.getGroundHandles();
    return !!this.physics.world.intersectionWithShape(
      { x, y, z },
      { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
      this.capsuleShape,
      undefined, undefined, undefined, undefined,
      c => c.handle !== undefined && !gh.has(c.handle) && (!excludeHandles || !excludeHandles.has(c.handle))
    );
  }

  checkPoint(x, z, excludeHandles = null) {
    const k = `${Math.round(x * 100)},${Math.round(z * 100)}`;
    if (this.probeCache.has(k)) return this.probeCache.get(k);

    const gy = this.supportAt(x, z);
    if (gy === null || gy < -0.1) {
      this.probeCache.set(k, null);
      return null;
    }
    if (this.wallOverlap(x, gy + 0.48, z, 0, excludeHandles)) {
      this.probeCache.set(k, null);
      return null;
    }
    // A center ray alone admits paths hugging a pavement edge. Preserve a
    // small supported corridor so real steering can follow without corner cuts.
    for(const [dx,dz]of [[.2,0],[-.2,0],[0,.2],[0,-.2]]){
      const support=this.supportAt(x+dx,z+dz);
      if(support===null||Math.abs(support-gy)>.15){this.probeCache.set(k,null);return null;}
    }
    const pt = { x, z, y: gy };
    this.probeCache.set(k, pt);
    return pt;
  }

  checkEdge(p1, p2, excludeHandles = null) {
    const dist = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const samples = Math.max(1, Math.ceil(dist / 0.35));
    let lastY = p1.y;
    for (let s = 1; s <= samples; s++) {
      const frac = s / samples;
      const x = p1.x + (p2.x - p1.x) * frac;
      const z = p1.z + (p2.z - p1.z) * frac;
      const pt = this.checkPoint(x, z, excludeHandles);
      if (!pt) return false;
      if (Math.abs(pt.y - lastY) > 0.15) return false;
      lastY = pt.y;
    }
    return true;
  }

  /**
   * Bounded A* search on lattice anchored at centerSpawn
   */
  planAStar({
    startXZ,
    goalXZ,
    step = 1.0,
    maxExpanded = 60000,
    boundingMargin = 25,
    anchorXZ = startXZ,
    excludeHandles = null,
  }) {
    const t0 = performance.now();
    const startPt = this.checkPoint(startXZ[0], startXZ[1], excludeHandles);
    const goalPt = this.checkPoint(goalXZ[0], goalXZ[1], excludeHandles);
    if (!startPt) return { success: false, reason: 'start point unsupported or blocked', timeMs: performance.now() - t0 };
    if (!goalPt) return { success: false, reason: 'goal point unsupported or blocked', timeMs: performance.now() - t0 };

    // If start and goal are close and direct line is clear
    if (Math.hypot(goalPt.x - startPt.x, goalPt.z - startPt.z) <= 1.2 && this.checkEdge(startPt, goalPt, excludeHandles)) {
      return {
        success: true,
        path: [startPt, goalPt],
        expanded: 0,
        timeMs: performance.now() - t0,
        lengthM: Math.hypot(goalPt.x - startPt.x, goalPt.z - startPt.z)
      };
    }

    const minX = Math.min(startXZ[0], goalXZ[0]) - boundingMargin;
    const maxX = Math.max(startXZ[0], goalXZ[0]) + boundingMargin;
    const minZ = Math.min(startXZ[1], goalXZ[1]) - boundingMargin;
    const maxZ = Math.max(startXZ[1], goalXZ[1]) + boundingMargin;

    const keyOf = (i, j) => `${i}:${j}`;
    const coordOf = (i, j) => [anchorXZ[0] + i * step, anchorXZ[1] + j * step];

    // Find closest lattice nodes to startXZ <= 1.0m
    const startI = Math.round((startXZ[0] - anchorXZ[0]) / step);
    const startJ = Math.round((startXZ[1] - anchorXZ[1]) / step);

    const heap = new MinHeap();
    const gScore = new Map();
    const cameFrom = new Map();
    const nodePtCache = new Map();

    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];

    // Connect start to nearby valid lattice nodes
    let startConnected = 0;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const ni = startI + di, nj = startJ + dj;
        const [nx, nz] = coordOf(ni, nj);
        const dist = Math.hypot(nx - startXZ[0], nz - startXZ[1]);
        if (dist > 1.2) continue;
        const pt = this.checkPoint(nx, nz, excludeHandles);
        if (!pt) continue;
        if (this.checkEdge(startPt, pt, excludeHandles)) {
          const k = keyOf(ni, nj);
          nodePtCache.set(k, pt);
          gScore.set(k, dist);
          cameFrom.set(k, '__START__');
          const h = Math.hypot(goalXZ[0] - nx, goalXZ[1] - nz);
          heap.push(k, dist + h);
          startConnected++;
        }
      }
    }

    if (startConnected === 0) {
      return { success: false, reason: 'start cannot connect to nearby valid lattice nodes', timeMs: performance.now() - t0 };
    }

    let expanded = 0;
    let closestNodeKey = null;
    let closestDistToGoal = Infinity;

    while (heap.size() > 0 && expanded < maxExpanded) {
      const currentKey = heap.pop();
      if (!currentKey) break;
      expanded++;

      const currPt = nodePtCache.get(currentKey);
      const distToGoal = Math.hypot(currPt.x - goalXZ[0], currPt.z - goalXZ[1]);
      if (distToGoal < closestDistToGoal) {
        closestDistToGoal = distToGoal;
        closestNodeKey = currentKey;
      }

      // Goal within 1.0m (or tolerance 1.2m)
      if (distToGoal <= 1.2) {
        if (this.checkEdge(currPt, goalPt, excludeHandles)) {
          const path = [goalPt, currPt];
          let curr = currentKey;
          while (cameFrom.has(curr) && cameFrom.get(curr) !== '__START__') {
            curr = cameFrom.get(curr);
            path.push(nodePtCache.get(curr));
          }
          path.push(startPt);
          path.reverse();

          let totalLen = 0;
          for (let p = 1; p < path.length; p++) {
            totalLen += Math.hypot(path[p].x - path[p - 1].x, path[p].z - path[p - 1].z);
          }

          return {
            success: true,
            path,
            expanded,
            timeMs: performance.now() - t0,
            lengthM: totalLen,
            finalDistToGoal: Math.hypot(path[path.length - 1].x - goalXZ[0], path[path.length - 1].z - goalXZ[1])
          };
        }
      }

      const [ci, cj] = currentKey.split(':').map(Number);
      const currentG = gScore.get(currentKey);

      for (const [di, dj] of dirs) {
        const ni = ci + di, nj = cj + dj;
        const [nx, nz] = coordOf(ni, nj);
        if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
        const nextKey = keyOf(ni, nj);

        // Prevent corner cutting for diagonal
        if (di !== 0 && dj !== 0) {
          const orth1Key = keyOf(ci + di, cj);
          const orth2Key = keyOf(ci, cj + dj);
          if (!nodePtCache.has(orth1Key)) {
            const [ox, oz] = coordOf(ci + di, cj);
            nodePtCache.set(orth1Key, this.checkPoint(ox, oz, excludeHandles));
          }
          if (!nodePtCache.has(orth2Key)) {
            const [ox, oz] = coordOf(ci, cj + dj);
            nodePtCache.set(orth2Key, this.checkPoint(ox, oz, excludeHandles));
          }
          if (!nodePtCache.get(orth1Key) || !nodePtCache.get(orth2Key)) continue;
        }

        let nextPt = nodePtCache.get(nextKey);
        if (nextPt === undefined) {
          nextPt = this.checkPoint(nx, nz, excludeHandles);
          nodePtCache.set(nextKey, nextPt);
        }
        if (!nextPt) continue;

        if (!this.checkEdge(currPt, nextPt, excludeHandles)) continue;

        const edgeDist = Math.hypot(nextPt.x - currPt.x, nextPt.z - currPt.z);
        const tentativeG = currentG + edgeDist;
        if (tentativeG < (gScore.get(nextKey) ?? Infinity)) {
          cameFrom.set(nextKey, currentKey);
          gScore.set(nextKey, tentativeG);
          const h = Math.hypot(goalXZ[0] - nx, goalXZ[1] - nz);
          heap.push(nextKey, tentativeG + h);
        }
      }
    }

    return {
      success: false,
      reason: expanded >= maxExpanded ? `exceeded maxExpanded (${maxExpanded})` : 'open set exhausted (no connected path in lattice)',
      expanded,
      timeMs: performance.now() - t0,
      closestDistToGoal,
      closestNode: closestNodeKey ? nodePtCache.get(closestNodeKey) : null
    };
  }
}
