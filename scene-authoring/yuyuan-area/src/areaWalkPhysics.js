// Shared browser/node zone activation. Add real GLB ground and OBB walls to the
// existing world; never replace the walking capsule or write its position.
import { readGlb } from '../../../src/world/glbReader.js';
import { collectGroundTriangles } from '../../../src/world/groundExtractor.js';
import { buildPhysicsWorld, addWallCollider, addGroundCollider } from '../../../src/world/physics.js';
import { selectAreaGroundMeshes } from './walkGround.js';

export class AreaWalkPhysics {
  constructor({ RAPIER, manifest, readJson, readBytes }) {
    Object.assign(this, { RAPIER, manifest, readJson, readBytes });
    this.physics = null;
    this.groundColliders = [];
    this.zones = new Map();
    this.pending = new Map();
    this.events = [];
    this.anchors = {};
  }
  loadZone(zone) {
    if (this.zones.has(zone)) return Promise.resolve(this.zones.get(zone));
    if (this.pending.has(zone)) return this.pending.get(zone);
    const job = this.prepareZone(zone).then(payload => {
      const { file, groundTriangles } = payload;
      // All reads/parsing finish before modifying the active physics world.
      if (!this.physics) {
        this.physics = buildPhysicsWorld(this.RAPIER, { collision: file, groundTriangles });
        this.groundColliders.push(this.physics.groundCollider);
      }
      else {
        for (const record of file.colliders) this.physics.colliders.push(addWallCollider(this.RAPIER, this.physics.world, record));
        if (groundTriangles) this.groundColliders.push(addGroundCollider(this.RAPIER, this.physics.world, groundTriangles).collider);
        this.physics.wallCount += file.colliders.length;
        this.physics.groundTriangleCount += groundTriangles ? groundTriangles.indices.length / 3 : 0;
        this.physics.world.step();
      }
      Object.assign(this.anchors, file.spawns || {});
      this.zones.set(zone, payload);
      this.events.push({ zone, state: 'active', walls: file.colliders.length, triangles: groundTriangles?.indices.length / 3 || 0 });
      return payload;
    }).catch(error => {
      this.events.push({ zone, state: 'failed', error: error.message });
      throw error;
    }).finally(() => this.pending.delete(zone));
    this.pending.set(zone, job);
    return job;
  }
  async prepareZone(zone) {
    this.events.push({ zone, state: 'requested' });
    const file = await this.readJson(`collision-${zone}.json`);
    if (file.zone !== zone || !Array.isArray(file.colliders)) throw new Error(`collision-${zone}: invalid zone/colliders`);
    const parts = this.manifest.zones.filter(e => e.id === zone && e.file);
    if (!parts.length) throw new Error(`walk: no GLB parts for ${zone}`);
    const meshes = [];
    if (file.groundNodeRe) for (const part of parts) {
      const glb = readGlb(await this.readBytes(part.file));
      meshes.push(...selectAreaGroundMeshes(glb.meshes, file));
    }
    if (file.groundNodeRe && !meshes.length) throw new Error(`walk: no ground meshes matched in ${zone}`);
    const groundTriangles = meshes.length ? collectGroundTriangles(meshes) : null;
    if (!this.physics && !groundTriangles) throw new Error(`walk: first zone ${zone} has no ground`);
    return { file, groundTriangles, files: parts.map(e => e.file) };
  }
  async loadZones(zones) { for (const zone of zones) await this.loadZone(zone); return this.physics; }
  status() { return { zones: [...this.zones.keys()], pending: [...this.pending.keys()], wallCount: this.physics?.wallCount || 0, groundTriangleCount: this.physics?.groundTriangleCount || 0 }; }
}
