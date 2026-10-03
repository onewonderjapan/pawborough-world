import * as THREE from 'three';

let cachedGlassDepthTexture = null;
let glassDepthRefCount = 0;

let cachedLacquerTexture = null;
let lacquerRefCount = 0;

/**
 * Creates or returns the shared procedural glass depth canvas texture.
 * Gives the impression of a deep interior room behind frosted/tinted glass,
 * eliminating the flat pitch-black window look without adding geometric rooms.
 */
export function getSharedGlassDepthTexture() {
  if (cachedGlassDepthTexture) return cachedGlassDepthTexture;

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Soft dark cyan-grey gradient background
      const grad = ctx.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, '#516a70');
      grad.addColorStop(0.45, '#778b8b');
      grad.addColorStop(0.55, '#778b8b');
      grad.addColorStop(1, '#354b54');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 128);

      // Subtle warm interior curtain/screen depth in center
      const radGrad = ctx.createRadialGradient(64, 68, 8, 64, 68, 56);
      radGrad.addColorStop(0, 'rgba(156, 161, 151, 0.45)');
      radGrad.addColorStop(0.7, 'rgba(92, 117, 120, 0.25)');
      radGrad.addColorStop(1, 'rgba(25, 35, 38, 0)');
      ctx.fillStyle = radGrad;
      ctx.fillRect(0, 0, 128, 128);

      // Soft muntin bar shadow / horizontal division
      ctx.fillStyle = 'rgba(16, 22, 24, 0.38)';
      ctx.fillRect(0, 62, 128, 4);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    cachedGlassDepthTexture = tex;
    return tex;
  }

  // Fallback for headless environments without canvas
  const data = new Uint8Array([119, 139, 139, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cachedGlassDepthTexture = tex;
  return tex;
}

export function retainGlassDepthTexture() {
  const tex = getSharedGlassDepthTexture();
  glassDepthRefCount++;
  return tex;
}

export function releaseGlassDepthTexture() {
  if (glassDepthRefCount > 0) {
    glassDepthRefCount--;
    if (glassDepthRefCount === 0 && cachedGlassDepthTexture) {
      if (typeof cachedGlassDepthTexture.dispose === 'function') {
        cachedGlassDepthTexture.dispose();
      }
      cachedGlassDepthTexture = null;
    }
  }
}

/**
 * Creates or returns the shared procedural wood lacquer grain canvas texture.
 * Gives antique Chinese cinnabar/chestnut wood plank lines, clearly showing
 * a closed solid board door rather than an open entrance.
 */
export function getSharedLacquerTexture() {
  if (cachedLacquerTexture) return cachedLacquerTexture;

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Warm dark mahogany base
      ctx.fillStyle = '#3a241b';
      ctx.fillRect(0, 0, 128, 128);

      // Vertical board dividing lines
      ctx.fillStyle = 'rgba(22, 12, 8, 0.4)';
      ctx.fillRect(31, 0, 2, 128);
      ctx.fillRect(63, 0, 2, 128);
      ctx.fillRect(95, 0, 2, 128);

      // Subtle horizontal wood grain slats
      for (let y = 0; y < 128; y += 4) {
        ctx.fillStyle = (y % 8 === 0) ? 'rgba(68, 42, 32, 0.16)' : 'rgba(32, 18, 12, 0.14)';
        ctx.fillRect(0, y, 128, 2);
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    cachedLacquerTexture = tex;
    return tex;
  }

  // Fallback for headless
  const data = new Uint8Array([62, 40, 32, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cachedLacquerTexture = tex;
  return tex;
}

export function retainLacquerTexture() {
  const tex = getSharedLacquerTexture();
  lacquerRefCount++;
  return tex;
}

export function releaseLacquerTexture() {
  if (lacquerRefCount > 0) {
    lacquerRefCount--;
    if (lacquerRefCount === 0 && cachedLacquerTexture) {
      if (typeof cachedLacquerTexture.dispose === 'function') {
        cachedLacquerTexture.dispose();
      }
      cachedLacquerTexture = null;
    }
  }
}

/**
 * Returns diagnostic ref-counts of procedural textures.
 */
export function getProceduralTextureRefCounts() {
  return {
    glassDepth: glassDepthRefCount,
    lacquer: lacquerRefCount
  };
}

/**
 * Disposes cached procedural textures. Respects reference counts unless forced.
 */
export function disposeWorldArtPilotTextures({ force = false } = {}) {
  if (force || glassDepthRefCount <= 0) {
    if (cachedGlassDepthTexture) {
      if (typeof cachedGlassDepthTexture.dispose === 'function') cachedGlassDepthTexture.dispose();
      cachedGlassDepthTexture = null;
    }
    glassDepthRefCount = 0;
  }
  if (force || lacquerRefCount <= 0) {
    if (cachedLacquerTexture) {
      if (typeof cachedLacquerTexture.dispose === 'function') cachedLacquerTexture.dispose();
      cachedLacquerTexture = null;
    }
    lacquerRefCount = 0;
  }
}
