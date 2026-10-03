// Independent verification for Pawborough coverage batch B (8 foods).
// Reads the exported GLBs with the project's three.js GLTFLoader (bpy export alone is
// not validation), checks required named nodes, anchors, finite transforms/bounds,
// absence of lights/cameras, byte limits, SHA-256 and PNG 256x256, then writes manifest.json.
// Project-relative imports retain reproducibility after worktree archival.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as THREE from '../../../node_modules/three/build/three.module.js';
import { GLTFLoader } from '../../../node_modules/three/examples/jsm/loaders/GLTFLoader.js';

const OUT_DIR = '/home/baibai/outbox/pawborough-food-coverage-20261003/assets-b';
const SOURCE_SCRIPT = 'asset-authoring/snacks/national/build_coverage_b.py';
const GLB_MAX_BYTES = 524288;
const PNG_MAX_BYTES = 28672;
const ANCHOR_TOL = 0.003;

const BOWL_ANCHORS = {
  leftSupport: [0.070, 0.0, -0.030],
  content: [0.0, 0.030, 0.0],
  bite: [0.0, 0.030, 0.0],
  rightSupport: [-0.050, 0.0, 0.0],
  toolGrip: [0.0, 0.0, 0.0],
  toolBite: [0.0, 0.0, 0.110],
  socket_grip: [0.0, 0.0, 0.0],
  socket_rest: [0.0, -0.025, 0.0],
};

const SPECS = [
  {
    id: 'shachamian', name: '沙茶面', poseProfile: 'bowl', utensilKind: 'chopsticks',
    requiredParts: ['container', 'edible', 'utensil'], anchors: BOWL_ANCHORS,
  },
  {
    id: 'waguan-tang', name: '瓦罐汤', poseProfile: 'bowl', utensilKind: 'spoon',
    requiredParts: ['container', 'edible', 'utensil'], anchors: BOWL_ANCHORS,
  },
  {
    id: 'luosifen', name: '螺蛳粉', poseProfile: 'bowl', utensilKind: 'chopsticks',
    requiredParts: ['container', 'edible', 'utensil'], anchors: BOWL_ANCHORS,
  },
  {
    id: 'siwawa', name: '丝娃娃', poseProfile: 'wrapped', utensilKind: null,
    requiredParts: ['wrapper', 'edible'],
    anchors: {
      leftSupport: [0.06, -0.025, 0.0],
      rightSupport: [-0.06, -0.025, 0.0],
      bite: [0.0, 0.06, 0.035],
      socket_grip: [0.0, 0.0, 0.0],
      socket_rest: [0.0, 0.0, 0.0],
    },
  },
  {
    id: 'suanlafen', name: '酸辣粉', poseProfile: 'bowl', utensilKind: 'chopsticks',
    requiredParts: ['container', 'edible', 'utensil'], anchors: BOWL_ANCHORS,
  },
  {
    id: 'niangpi', name: '酿皮', poseProfile: 'bowl', utensilKind: 'chopsticks',
    requiredParts: ['container', 'edible', 'utensil'], anchors: BOWL_ANCHORS,
  },
  {
    id: 'qinghai-yogurt', name: '青海酸奶', poseProfile: 'bowl', utensilKind: 'spoon',
    requiredParts: ['container', 'edible', 'utensil'], anchors: BOWL_ANCHORS,
  },
  {
    id: 'sanzi', name: '馓子', poseProfile: 'cupped', utensilKind: null,
    requiredParts: ['edible'],
    anchors: {
      leftSupport: [0.065, 0.0, 0.0],
      rightSupport: [-0.065, 0.0, 0.0],
      bite: [0.0, 0.05, 0.02],
      socket_grip: [0.0, 0.0, 0.0],
      socket_rest: [0.0, -0.025, 0.0],
    },
  },
];

const sha256File = (filepath) => {
  const buf = fs.readFileSync(filepath);
  return crypto.createHash('sha256').update(buf).digest('hex');
};

const pngDimensions = (filepath) => {
  const buf = fs.readFileSync(filepath);
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) {
    throw new Error(`${filepath}: not a PNG (missing IHDR)`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

const parseGlb = (filepath) => {
  const buf = fs.readFileSync(filepath);
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject);
  });
};

const assertFiniteNode = (node, id) => {
  const t = node.position, q = node.quaternion, s = node.scale;
  for (const v of [t.x, t.y, t.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]) {
    if (!Number.isFinite(v)) throw new Error(`${id}: non-finite transform on node ${node.name}`);
  }
};

const assertFiniteGeometry = (root, id) => {
  root.traverse((node) => {
    if (node.isMesh && node.geometry) {
      const pos = node.geometry.attributes.position;
      if (!pos) throw new Error(`${id}: mesh ${node.name} has no position attribute`);
      for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 512))) {
        if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) {
          throw new Error(`${id}: non-finite vertex in mesh ${node.name}`);
        }
      }
    }
  });
};

const checkAnchor = (holder, anchorName, expected, id, anchorsOut) => {
  const obj = holder.getObjectByName(anchorName);
  if (!obj) throw new Error(`${id}: missing anchor ${anchorName}`);
  const actual = obj.position.toArray().map((v) => Math.round(v * 10000) / 10000);
  anchorsOut[anchorName] = actual;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(actual[i] - expected[i]) > ANCHOR_TOL) {
      throw new Error(`${id}: anchor ${anchorName}[${i}] expected ${expected[i]}, got ${actual[i]}`);
    }
  }
};

async function verifyFood(spec) {
  const glbPath = path.join(OUT_DIR, `${spec.id}.glb`);
  const pngPath = path.join(OUT_DIR, `${spec.id}.png`);
  if (!fs.existsSync(glbPath)) throw new Error(`Missing ${glbPath}`);
  if (!fs.existsSync(pngPath)) throw new Error(`Missing ${pngPath}`);

  const glbBytes = fs.statSync(glbPath).size;
  const pngBytes = fs.statSync(pngPath).size;
  if (glbBytes > GLB_MAX_BYTES) throw new Error(`${spec.id}.glb exceeds ${GLB_MAX_BYTES}: ${glbBytes}`);
  if (pngBytes > PNG_MAX_BYTES) throw new Error(`${spec.id}.png exceeds ${PNG_MAX_BYTES}: ${pngBytes}`);

  const png = pngDimensions(pngPath);
  if (png.width !== 256 || png.height !== 256) {
    throw new Error(`${spec.id}.png must be 256x256, got ${png.width}x${png.height}`);
  }

  const gltf = await parseGlb(glbPath);
  const root = gltf.scene.getObjectByName(spec.id);
  if (!root) throw new Error(`${spec.id}: missing root node named ${spec.id}`);

  let lightsOrCameras = 0;
  gltf.scene.traverse((node) => {
    if (node.isLight || node.isCamera) lightsOrCameras += 1;
    assertFiniteNode(node, spec.id);
  });
  if (lightsOrCameras > 0) throw new Error(`${spec.id}: exported scene contains ${lightsOrCameras} light/camera nodes`);

  for (const partName of spec.requiredParts) {
    if (!root.getObjectByName(partName)) throw new Error(`${spec.id}: missing required part ${partName}`);
  }

  if (spec.utensilKind) {
    const utensil = root.getObjectByName('utensil');
    if (!utensil) throw new Error(`${spec.id}: missing utensil`);
    for (const tool of ['toolGrip', 'toolBite', 'toolFood']) {
      if (!utensil.getObjectByName(tool)) throw new Error(`${spec.id}: utensil missing ${tool}`);
    }
  } else if (root.getObjectByName('utensil')) {
    throw new Error(`${spec.id}: utensilKind is null but an utensil node exists`);
  }
  if (spec.poseProfile === 'wrapped' && root.getObjectByName('wrapper') === root.getObjectByName('edible')) {
    throw new Error(`${spec.id}: wrapper must be a separate node from edible`);
  }

  assertFiniteGeometry(root, spec.id);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  for (const v of [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]) {
    if (!Number.isFinite(v)) throw new Error(`${spec.id}: non-finite bounds`);
  }
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.x > 0.24 + 1e-6) throw new Error(`${spec.id}: meal width ${size.x.toFixed(3)} exceeds 0.24m`);
  if (size.y > 0.30 + 1e-6) throw new Error(`${spec.id}: meal height ${size.y.toFixed(3)} exceeds 0.30m`);

  const anchors = {};
  for (const [anchorName, expected] of Object.entries(spec.anchors)) {
    if (anchorName === 'toolGrip' || anchorName === 'toolBite') {
      const utensil = root.getObjectByName('utensil');
      checkAnchor(utensil, anchorName, expected, spec.id, anchors);
    } else {
      checkAnchor(root, anchorName, expected, spec.id, anchors);
    }
  }

  const round4 = (v) => Math.round(v * 10000) / 10000;
  console.log(`[VERIFIED] ${spec.id}: glb=${glbBytes}B png=${pngBytes}B ${png.width}x${png.height} ` +
    `sizeM=[${round4(size.x)},${round4(size.y)},${round4(size.z)}] parts=${spec.requiredParts.join(',')}`);

  return {
    id: spec.id,
    name: spec.name,
    poseProfile: spec.poseProfile,
    utensilKind: spec.utensilKind,
    path: `${spec.id}.glb`,
    bytes: glbBytes,
    sha256: sha256File(glbPath),
    thumbnail: {
      path: `${spec.id}.png`,
      bytes: pngBytes,
      sha256: sha256File(pngPath),
    },
    dimensionsM: {
      min: [round4(box.min.x), round4(box.min.y), round4(box.min.z)],
      max: [round4(box.max.x), round4(box.max.y), round4(box.max.z)],
      size: [round4(size.x), round4(size.y), round4(size.z)],
    },
    anchors,
    requiredParts: spec.requiredParts,
    sourceScript: SOURCE_SCRIPT,
  };
}

async function main() {
  const foods = [];
  for (const spec of SPECS) {
    foods.push(await verifyFood(spec));
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceScript: SOURCE_SCRIPT,
    renderStatus: 'rendered_cycles_cpu_threads4_samples16_256x256_transparent',
    verificationStatus: 'verified_node_gltf_loader_coverage_b',
    foods,
  };
  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`MANIFEST_WRITTEN ${manifestPath} (${foods.length} foods)`);
}

main().catch((err) => {
  console.error('VERIFICATION_FAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
