// Load-failure message shaping shared by the game page's fatal panel and the
// batch tests. Pure string logic — no DOM, no three/rapier imports.
export function resourceKind(path) {
  if (/\.glb$/i.test(path)) return '三维模型';
  if (/\.json$/i.test(path)) return '数据清单';
  if (/\.(png|jpe?g|ktx2?|basis)$/i.test(path)) return '纹理图片';
  if (/\.wasm$/i.test(path)) return '物理引擎';
  return '资源';
}

// Turns a thrown load error into a player-readable sentence that names the
// resource TYPE and path when the error carries them (the fetch helper throws
// `${path} HTTP ${status}`).
export function describeLoadError(e) {
  const msg = String(e?.message ?? e);
  const m = msg.match(/(\S+?\.(?:glb|json|png|jpe?g|ktx2|basis|wasm))\s+HTTP\s+(\d+)/i);
  if (m) return `加载${resourceKind(m[1])}失败（${m[2]}）：${m[1]}`;
  return msg;
}
