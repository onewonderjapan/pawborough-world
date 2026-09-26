// wave9-sharedtex：validate_all.cjs 外置纹理 URI 回调的最小契约测试（工单：验证回调能正确读取本地资源，
// 同时拒绝逃逸路径含符号链接逃逸；验证器通过必须来自真实文件，不许忽略 IO 错误）。
// 用真实产物 zone-<X>.cm.glb + 它引用的 tex/ 文件搭沙盒，逐例改一种条件跑 validate_all.cjs：
//   T1 原样 → EXIT 0（外置图真实被读取并校验）
//   T2 缺一张外置图 → EXIT 1 IO_ERROR（不许忽略 IO 错误）
//   T3 外置图字节损坏 → 出现 IMAGE_UNRECOGNIZED_FORMAT 警告（Khronos validator 对坏图内容定级为 warning；
//      该断言证明读到的字节真的进了图片解码，不是摆设。IO/逃逸才是 error，见 T2/T4–T7）
//   T4 uri ../ 逃逸 → EXIT 1 IO_ERROR
//   T5 uri 百分号编码 ../ 逃逸 → EXIT 1 IO_ERROR
//   T6 符号链接逃逸（指向根外的有效图片）→ EXIT 1 IO_ERROR（修复前：词法路径在根内，逃逸被静默放行 → EXIT 0，
//      实测记录见工单包 artifacts/logs/validate-escape-before.log）
//   T7 符号链接逃逸（指向根外垃圾字节）→ EXIT 1 IO_ERROR
// 用法：OUT_DIR=out-zone node tests/validate-external-uri-test.mjs
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AREA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');      // scene-authoring/yuyuan-area
const WS = path.resolve(AREA, '..', '..');                                          // 仓库根
const VALIDATE = path.join(WS, 'scripts', 'validate_all.cjs');
const OUT = path.resolve(AREA, process.env.OUT_DIR || 'out-zone');
const ZONE = process.env.VALIDATE_TEST_ZONE || 'zone-pond.cm.glb';

let pass = 0, fail = 0;
const ok = (m, c) => { if (c) pass++; else { fail++; console.error('FAIL', m); } if (c && process.env.VERBOSE) console.log('PASS', m); return c; };

function readGlbJson(file) {
  const buf = fs.readFileSync(file);
  const jl = buf.readUInt32LE(12);
  return { buf, json: JSON.parse(buf.subarray(20, 20 + jl).toString('utf8')), jl };
}
// 重写 GLB 的 JSON chunk（BIN chunk 原样搬移，JSON chunk 4 字节对齐；header = magic + version 2 + 总长）
function writeGlbJson(file, j) {
  const { buf, jl } = readGlbJson(file);
  const bin = buf.subarray(20 + jl + 8);
  const js = Buffer.from(JSON.stringify(j), 'utf8');
  const pad = (4 - (js.length % 4)) % 4;
  const jsChunk = Buffer.concat([js, Buffer.alloc(pad, 0x20)]);
  const total = 12 + 8 + jsChunk.length + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'ascii'); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jsonChunkHead = Buffer.alloc(8); jsonChunkHead.writeUInt32LE(jsChunk.length, 0); jsonChunkHead.writeUInt32LE(0x4e4f534a, 4);
  const binChunkHead = Buffer.alloc(8); binChunkHead.writeUInt32LE(bin.length, 0); binChunkHead.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jsonChunkHead, jsChunk, binChunkHead, bin]));
}
function run(rootDir) {
  const r = spawnSync(process.execPath, [VALIDATE, '--files', ZONE, '--root', rootDir, '--report', path.join(rootDir, '..', 'report.json')], { encoding: 'utf8' });
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(rootDir, '..', 'report.json'), 'utf8')); } catch {}
  return { exit: r.status, out: r.stdout + r.stderr, report };
}
// 沙盒：源件 + 它引用的全部外置 tex 文件
function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-uri-'));
  fs.mkdirSync(path.join(dir, 'root', 'tex'), { recursive: true });
  fs.copyFileSync(path.join(OUT, ZONE), path.join(dir, 'root', ZONE));
  const { json } = readGlbJson(path.join(OUT, ZONE));
  for (const im of json.images || []) {
    if (im.uri) fs.copyFileSync(path.join(OUT, decodeURIComponent(im.uri)), path.join(dir, 'root', decodeURIComponent(im.uri)));
  }
  return dir;
}
const firstExtUri = () => {
  const { json } = readGlbJson(path.join(OUT, ZONE));
  const im = (json.images || []).find(i => i.uri);
  if (!im) throw new Error(`${ZONE} 没有外置图，本测试不适用`);
  return im.uri;
};

const extUri = firstExtUri();
const extPath = decodeURIComponent(extUri);

// T1 原样
{
  const dir = makeSandbox();
  const r = run(path.join(dir, 'root'));
  ok(`T1 原样 ${ZONE}：EXIT 0 且 verdict PASS（外置图被真实读取）`, r.exit === 0 && r.report && r.report.verdict === 'PASS');
  ok(`T1 报告里 0 error`, r.report && r.report.results[0] && r.report.results[0].errors === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}
// T2 缺图
{
  const dir = makeSandbox();
  fs.rmSync(path.join(dir, 'root', extPath));
  const r = run(path.join(dir, 'root'));
  const codes = (r.report && r.report.results[0] && r.report.results[0].errorCodes) || [];
  ok(`T2 缺外置图 ${extPath}：EXIT 1 且 IO_ERROR（不忽略 IO 错误）`, r.exit === 1 && codes.some(c => c.startsWith('IO_ERROR')));
  fs.rmSync(dir, { recursive: true, force: true });
}
// T3 字节损坏
{
  const dir = makeSandbox();
  fs.writeFileSync(path.join(dir, 'root', extPath), Buffer.from('this is not an image at all'));
  const r = run(path.join(dir, 'root'));
  const warns = (r.report && r.report.results[0] && r.report.results[0].warningCodes) || [];
  ok(`T3 外置图字节损坏：出现 IMAGE_UNRECOGNIZED_FORMAT 警告（字节真的进了解码）`, warns.some(c => c.startsWith('IMAGE_UNRECOGNIZED_FORMAT')));
  fs.rmSync(dir, { recursive: true, force: true });
}
// T4 ../ 逃逸 + T5 百分号编码逃逸
for (const [tag, uri, label] of [
  ['T4', '../escape.png', 'uri ../ 逃逸'],
  ['T5', 'tex/%2e%2e/escape.png', 'uri 百分号编码 ../ 逃逸'],
]) {
  const dir = makeSandbox();
  fs.writeFileSync(path.join(dir, 'escape.png'), Buffer.from('OUTSIDE'));
  const { json } = readGlbJson(path.join(dir, 'root', ZONE));
  json.images.find(i => i.uri).uri = uri;
  writeGlbJson(path.join(dir, 'root', ZONE), json);
  const r = run(path.join(dir, 'root'));
  const codes = (r.report && r.report.results[0] && r.report.results[0].errorCodes) || [];
  ok(`${tag} ${label}：EXIT 1 且 IO_ERROR`, r.exit === 1 && codes.some(c => c.startsWith('IO_ERROR')));
  fs.rmSync(dir, { recursive: true, force: true });
}
// T6 / T7 符号链接逃逸
for (const [tag, payload, label] of [
  ['T6', fs.readFileSync(path.join(OUT, extPath)), '符号链接逃逸（指向根外有效图片）'],
  ['T7', Buffer.from('OUTSIDE-GARBAGE'), '符号链接逃逸（指向根外垃圾字节）'],
]) {
  const dir = makeSandbox();
  fs.writeFileSync(path.join(dir, 'outside.bin'), payload);
  const target = path.join(dir, 'root', extPath);
  fs.rmSync(target);
  fs.symlinkSync(path.relative(path.dirname(target), path.join(dir, 'outside.bin')), target);
  const r = run(path.join(dir, 'root'));
  const codes = (r.report && r.report.results[0] && r.report.results[0].errorCodes) || [];
  ok(`${tag} ${label}：EXIT 1 且 IO_ERROR（修复前 EXIT 0 静默放行）`, r.exit === 1 && codes.some(c => c.startsWith('IO_ERROR')));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`validate-external-uri-test (${ZONE}, ${extPath}): ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
