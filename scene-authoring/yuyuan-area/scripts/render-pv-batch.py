#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave12-pvbatch P1：PV 正式帧批量渲染调度器（纯 python3，不依赖 bpy）。

按 wave11-pvboard 交接（AI-HANDOFF.md 第 1 节 3 条分组命令 + 第 5 节 16 条逐镜命令，共 19 条）
调度 scripts/render-control-passes.py 批量出 PV 四通道控制层 + Cycles beauty 参考帧。
命令构造直接 import scripts/pv-docs.py 的 export_command / light_groups（同一套规则，不复制拼命令逻辑）；
本单不改渲染器本身，机主拍板的采样类参数经 --extra 原样透传（如 --beauty-samples 128 --beauty-denoise）。

执行模型（两级）：
  A 组命令：光照组内镜头全部缺失时，一条组命令整组渲（省场景导入）；
  B 逐镜命令：对仍未齐全的镜头逐镜补渲。首跑全缺 → A 出 3 条组命令后 B 全跳过（实际 Blender 只起 3 次）；
  dry-run（假设磁盘现状、组命令全部成功）打印 A+B 会考虑的命令：全新 out-root 恰好 19 条，与 pv-docs 生成一致。

断点续跑（镜粒度）：每镜每通道按期望帧数检查已存在帧文件（数量 + 非空 + 可解码；cameras 侧车 JSON 同查数量与非空），
齐全即跳过；不齐整镜重跑（渲染器按镜覆写，逐帧确定性输出，不做帧级增量）。

质量守卫：每镜完成后抽 beauty 首/中/末帧，按 COMMON 空白帧判据（灰度 std < 2/255 或主灰阶 > 95% 像素）判空白；
beauty 全黑/全白即标记该镜失败并停止整批（不继续浪费时间）。进度 <out-root>/pv-batch-progress.json 每完成一镜更新；
日志 <out-root>/logs/；每镜首/中/末×四通道联系表 <out-root>/sheets/<id>.png（PIL）；结束写 <out-root>/RESULT.json。

资源：同一时刻最多 1 个 Blender 进程（GPU），-t 4 已由 pv-docs 命令固定；--nice 可降权；<out-root>/.pv-batch.lock 防双开。

用法（在 scene-authoring/yuyuan-area 下）：
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --group all            # 全量 16 镜
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --group day --dry-run  # 只打印命令与帧数
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --shots pv01,pv05      # 镜号前缀或完整 id
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/p3 --group day --shots pv01 --frames 2  # 冒烟：每镜前 2 帧
  python3 -X utf8 scripts/render-pv-batch.py --out-root <包>/artifacts/pv --extra "--beauty-samples 128 --beauty-denoise"

环境变量：
  PV_BATCH_BLENDER  渲染可执行文件（默认 ~/.local/bin/blender）。测试指向写占位 PNG 的 stub，不起 Blender。
"""
import argparse
import datetime
import importlib.util
import json
import os
import shlex
import subprocess
import sys
import time

AREA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PV_SHOTS = os.path.join(AREA, 'scripts', 'pv-shots.json')
PV_DOCS = os.path.join(AREA, 'scripts', 'pv-docs.py')
CANON_BLENDER = '~/.local/bin/blender'  # pv-docs 命令的规范前缀；执行时可被 PV_BATCH_BLENDER 替换
CHANNELS = ('beauty', 'depth', 'normal', 'segmentation')
GUARD_SAMPLE = 'fml'  # 首/中/末
# COMMON 空白帧判据（与 scripts/check-pv-frames.py 的 BLANK 同口径：灰度 std<2 灰阶、主灰阶>95% 像素）
BLANK_STD_MAX = 2.0
BLANK_DOMINANT_MAX = 0.95


def load_pv_docs():
    """加载 pv-docs.py 复用其命令构造（文件名带连字符，不能直接 import）。"""
    spec = importlib.util.spec_from_file_location('pv_docs_for_batch', PV_DOCS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_shots(path):
    doc = json.load(open(path, encoding='utf-8'))
    fps = doc.get('fps', 24)
    shots = []
    for s in doc['shots']:
        n = int(round(float(s['durationS']) * fps))
        if n <= 0:
            raise SystemExit('E: %s 时长 %.3fs × %dfps = %d 帧 ≤ 0' % (s['id'], s['durationS'], fps, n))
        shots.append({'id': s['id'], 'light': s['light'], 'frames': n})
    return shots, fps


def match_shots(shots, tokens):
    """--shots 既有完整 id 也接受镜号前缀（pv01 → pv01-aerial-reveal）；歧义/未命中即报错。"""
    out, errs = [], []
    for t in tokens:
        hit = [s for s in shots if s['id'] == t or s['id'].startswith(t + '-') or s['id'].startswith(t)]
        if not hit:
            errs.append('--shots %s 未命中任何镜头（16 镜见 scripts/pv-shots.json）' % t)
        elif len(hit) > 1 and not any(s['id'] == t for s in hit):
            errs.append('--shots %s 歧义：%s' % (t, ', '.join(s['id'] for s in hit)))
        else:
            out.extend(hit)
    if errs:
        raise SystemExit('E: ' + '; '.join(errs))
    seen, uniq = set(), []
    for s in out:
        if s['id'] not in seen:
            seen.add(s['id'])
            uniq.append(s)
    return uniq


def flatten(cmd):
    return ' '.join(cmd.replace(' \\\n', ' ').split())


def build_commands(pv_docs, groups, out_root, extra):
    """[(tag, 单行规范命令, [shot…])]：组命令在前、逐镜在后，全部来自 pv-docs.export_command。"""
    out = []
    for light, ids in groups:
        out.append(('group:%s' % light, flatten(pv_docs.export_command(ids, light, out_root)), ids))
    for light, ids in groups:
        for sid in ids:
            out.append(('shot:%s' % sid, flatten(pv_docs.export_command([sid], light, out_root)), [sid]))
    if extra:
        out = [(tag, cmd + ' ' + extra, ids) for tag, cmd, ids in out]
    return out


def exec_argv(cmd, blender_exec, nice, frames_first_n):
    """规范命令 → 实际 argv：替换渲染可执行文件（PV_BATCH_BLENDER 测试替换点）、可选 nice、附 --frames。"""
    toks = cmd.split()
    if toks[0] != CANON_BLENDER:
        raise SystemExit('E: 命令前缀不是 %s：%s' % (CANON_BLENDER, cmd))
    argv = [os.path.expanduser(blender_exec)] + toks[1:]
    if frames_first_n is not None:
        argv += ['--frames', ','.join(str(k) for k in range(frames_first_n))]
    if nice is not None:
        argv = ['nice', '-n', str(nice)] + argv
    return argv


# ---------------- 断点续跑：帧文件齐全性 ----------------

def frame_png_ok(path):
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        return False
    try:
        from PIL import Image
        with Image.open(path) as im:
            im.verify()
        return True
    except Exception:
        return False


def shot_state(out_root, light, sid, n):
    """镜粒度齐全性：四通道 frame-000..n-1 + cameras json 逐帧非空（图片再验可解码）。"""
    base = os.path.join(out_root, 'control-24fps-%s' % light, sid)
    per = {}
    ok = True
    for ch in CHANNELS:
        good = bad = 0
        for k in range(n):
            if frame_png_ok(os.path.join(base, ch, 'frame-%03d.png' % k)):
                good += 1
            else:
                bad += 1
        per[ch] = {'ok': good, 'missing': bad}
        ok = ok and bad == 0
    cam_missing = 0
    for k in range(n):
        p = os.path.join(base, 'cameras', 'frame-%03d.json' % k)
        if not os.path.isfile(p) or os.path.getsize(p) == 0:
            cam_missing += 1
    per['cameras'] = {'ok': n - cam_missing, 'missing': cam_missing}
    return ok, per


# ---------------- 空白帧守卫（COMMON 判据，灰度直方图实现，免 numpy） ----------------

def gray_stats(path):
    """返回 (std, dominant占比)；解码失败返回 None。"""
    try:
        from PIL import Image
        with Image.open(path) as im:
            hist = im.convert('L').histogram()
    except Exception:
        return None
    n = float(sum(hist))
    if n <= 0:
        return None
    mean = sum(i * c for i, c in enumerate(hist)) / n
    var = sum(c * (i - mean) ** 2 for i, c in enumerate(hist)) / n
    return var ** 0.5, max(hist) / n


def guard_shot(out_root, light, sid, n):
    """抽首/中/末帧 beauty 判空白。返回 (ok, 详情)。任一抽样帧空白即判失败（全黑/全白必中）。"""
    idx = sorted({0, (n - 1) // 2, n - 1})
    detail = []
    ok = True
    base = os.path.join(out_root, 'control-24fps-%s' % light, sid, 'beauty')
    for k in idx:
        st = gray_stats(os.path.join(base, 'frame-%03d.png' % k))
        if st is None:
            detail.append({'frame': k, 'error': 'decode-failed'})
            ok = False
            continue
        std, dom = st
        blank = std < BLANK_STD_MAX or dom > BLANK_DOMINANT_MAX
        detail.append({'frame': k, 'grayStd': round(std, 2), 'dominantFrac': round(dom, 4), 'blank': blank})
        if blank:
            ok = False
    return ok, {'sample': 'fml', 'frames': detail}


# ---------------- 联系表（PIL：首/中/末 × 四通道） ----------------

def make_sheet(out_root, light, sid, n, dst):
    from PIL import Image, ImageDraw, ImageFont

    def open_tile(path):
        """8-bit 通道直接转 RGB；16-bit depth（mode I，值 0..65535，背景 far 可略超）仿射压到 0-255 再钳位。"""
        src = Image.open(path)
        if src.mode in ('I', 'I;16', 'I;16L', 'I;16B'):
            src = src.point(lambda v: v * 255 / 65535)
        return src.convert('RGB').resize((tw, th))

    def font(sz):
        for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'):
            if os.path.exists(p):
                return ImageFont.truetype(p, sz)
        return ImageFont.load_default()

    idx = sorted({0, (n - 1) // 2, n - 1})
    tw, th, lab, pad = 320, 180, 22, 4
    W = pad + len(CHANNELS) * (tw + pad)
    H = pad + lab * 2 + len(idx) * (th + lab + pad)
    im = Image.new('RGB', (W, H), (24, 24, 24))
    dr = ImageDraw.Draw(im)
    dr.text((pad, 4), '%s  [%s]  %d frames  fml x %s' % (sid, light, n, '/'.join(CHANNELS)), fill=(240, 240, 240),
            font=font(16))
    y = lab + 8
    f8, f9 = font(14), font(15)
    for j, ch in enumerate(CHANNELS):
        dr.text((pad + j * (tw + pad), y), ch, fill=(160, 200, 255), font=f9)
    y += lab
    for r, k in enumerate(idx):
        for j, ch in enumerate(CHANNELS):
            dr.text((pad + j * (tw + pad), y), 'frame-%03d' % k, fill=(200, 200, 200), font=f8)
            x0 = pad + j * (tw + pad)
            tile = Image.new('RGB', (tw, th), (48, 16, 16))
            try:
                tile = open_tile(os.path.join(out_root, 'control-24fps-%s' % light, sid, ch, 'frame-%03d.png' % k))
            except Exception as e:
                dr.text((x0 + 8, y + th // 2), 'missing (%s)' % type(e).__name__, fill=(255, 120, 120), font=f8)
            im.paste(tile, (x0, y + lab))
        y += th + lab + pad
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst)


# ---------------- 进度 / 结果 ----------------

def now_iso():
    return datetime.datetime.now().isoformat(timespec='seconds')


def write_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser(description='PV 正式帧批量渲染调度器（wave12-pvbatch）')
    ap.add_argument('--out-root', required=True, help='批产物根目录：control-24fps-<light>/、logs/、sheets/、pv-batch-progress.json、RESULT.json')
    ap.add_argument('--group', default='all', choices=('day', 'dusk', 'night', 'all'), help='按光照组选镜（默认 all）')
    ap.add_argument('--shots', default='', help='逗号分隔镜头（完整 id 或 pv01 式前缀），与 --group 取交集')
    ap.add_argument('--extra', default='', help='原样透传给渲染器的额外参数（如 "--beauty-samples 128 --beauty-denoise"）')
    ap.add_argument('--frames', type=int, default=None, metavar='N', help='每镜只渲前 N 帧（冒烟用；期望帧数随之取 min(N, 镜帧数)）')
    ap.add_argument('--nice', type=int, nargs='?', const=10, default=None, metavar='N', help='渲染进程降权（nice -n N，缺省 10）')
    ap.add_argument('--dry-run', action='store_true', help='只打印将执行的命令与预计帧数，不渲染、不写任何文件')
    ap.add_argument('--pv', default=PV_SHOTS, help='分镜正本（默认 scripts/pv-shots.json）')
    a = ap.parse_args()

    if a.frames is not None and a.frames < 1:
        raise SystemExit('E: --frames 须 ≥ 1')
    extra = a.extra.strip()
    if extra:
        banned = ('--out', '--shots', '--scene', '--cameras', '--preset')
        hit = [t for t in shlex.split(extra) if t.split('=')[0] in banned]
        if hit:
            raise SystemExit('E: --extra 不许含调度器自管参数 %s（发现 %s）' % (banned, ' '.join(hit)))

    pv_docs = load_pv_docs()
    shots, fps = load_shots(a.pv)
    sel = shots
    if a.group != 'all':
        sel = [s for s in sel if s['light'] == a.group]
    if a.shots:
        keep = {s['id'] for s in match_shots(shots, [t for t in a.shots.split(',') if t])}
        sel = [s for s in sel if s['id'] in keep]
    if not sel:
        raise SystemExit('E: 选择为空（--group %s --shots %s）' % (a.group, a.shots))
    if a.frames is not None:
        for s in sel:
            s['framesFull'] = s['frames']
            s['frames'] = min(s['frames'], a.frames)
    for s in sel:
        s.setdefault('framesFull', s['frames'])

    # 与 pv-docs 同一套分组规则（连续同 light 归一组）构造 19 条规范命令
    groups = pv_docs.light_groups(sel)
    plan = build_commands(pv_docs, groups, a.out_root, extra)
    total_sel_frames = sum(s['frames'] for s in sel)

    if a.dry_run:
        print('# pv-batch dry-run  group=%s shots=%d/%d fps=%d planned-frames=%d out-root=%s' % (
            a.group, len(sel), len(shots), fps, total_sel_frames, a.out_root))
        if extra:
            print('# extra: %s' % extra)
        if os.environ.get('PV_BATCH_BLENDER'):
            print('# renderer override: PV_BATCH_BLENDER=%s' % os.environ['PV_BATCH_BLENDER'])
        if a.frames is not None:
            print('# frames: 每镜只渲前 %d 帧（--frames）' % a.frames)
        for tag, cmd, ids in plan:
            fr = sum(s['frames'] for s in sel if s['id'] in set(ids))
            kind = 'group' if tag.startswith('group:') else 'shot '
            print('[%s %s] shots=%d frames=%d' % (kind, tag, len(ids), fr))
            print(cmd)
        skipped = sum(1 for s in sel if shot_state(a.out_root, s['light'], s['id'], s['frames'])[0]) if os.path.isdir(a.out_root) else 0
        print('# commands=%d  selected-frames=%d  already-complete-shots=%d' % (len(plan), total_sel_frames, skipped))
        print('# 执行模型：A 组命令整组渲（全量新 out-root 实跑 3 次 Blender）；B 逐镜命令运行时按磁盘齐全性跳过')
        return 0

    # ---------------- 实跑 ----------------
    blender_exec = os.environ.get('PV_BATCH_BLENDER', CANON_BLENDER)
    os.makedirs(os.path.join(a.out_root, 'logs'), exist_ok=True)
    os.makedirs(os.path.join(a.out_root, 'sheets'), exist_ok=True)
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    log_path = os.path.join(a.out_root, 'logs', 'pv-batch-%s.log' % stamp)
    logf = open(log_path, 'a', encoding='utf-8')

    def log(msg):
        line = '[%s] %s' % (datetime.datetime.now().strftime('%H:%M:%S'), msg)
        print(line, flush=True)
        logf.write(line + '\n')
        logf.flush()

    lock = acquire_lock(a.out_root, log)
    progress_path = os.path.join(a.out_root, 'pv-batch-progress.json')
    prog = {'version': 1, 'outRoot': a.out_root, 'group': a.group, 'shotsFilter': a.shots,
            'fps': fps, 'dryRun': False, 'renderer': blender_exec, 'extra': extra,
            'framesFirstN': a.frames, 'nice': a.nice, 'log': log_path,
            'startedAt': now_iso(), 'updatedAt': now_iso(), 'etaSeconds': None,
            'stoppedReason': None,
            'shots': {s['id']: {'light': s['light'], 'status': 'pending', 'attempts': 0,
                                'framesExpected': s['frames'], 'framesDone': 0,
                                'secondsTotal': None, 'secondsPerFrame': None,
                                'guard': 'not-run', 'guardDetail': None, 'command': None, 'note': None}
                      for s in sel}}
    for s in sel:
        ok, per = shot_state(a.out_root, s['light'], s['id'], s['frames'])
        if ok:
            prog['shots'][s['id']].update(status='complete-preexisting', framesDone=s['frames'], note='帧文件已齐全，跳过')
    write_json(progress_path, prog)
    log('pv-batch 开始：%d 镜 / %d 帧（group=%s shots=%s extra=%r frames=%s nice=%s）' % (
        len(sel), total_sel_frames, a.group, a.shots or '-', extra or '-', a.frames, a.nice))
    pre = [sid for sid in prog['shots'] if prog['shots'][sid]['status'] == 'complete-preexisting']
    if pre:
        log('断点续跑：%d 镜已齐全直接跳过：%s' % (len(pre), ', '.join(pre)))

    cmd_by_tag = {tag: (cmd, ids) for tag, cmd, ids in plan}
    shot_cmd = {sid: cmd_by_tag['shot:%s' % sid][0] for sid in prog['shots']}
    stop = {'reason': None}

    def run_renderer(tag, cmd, ids):
        """跑一条命令（cwd=area 根，串行=同时最多 1 个渲染进程）。返回 exit code。"""
        argv = exec_argv(cmd, blender_exec, a.nice, a.frames)
        log('RUN %s -> %s' % (tag, ' '.join(argv)))
        t0 = time.monotonic()
        with open(log_path, 'a', encoding='utf-8') as lf:
            lf.write('\n===== %s =====\n%s\n' % (tag, ' '.join(argv)))
            lf.flush()
            try:
                rc = subprocess.call(argv, cwd=AREA, stdout=lf, stderr=subprocess.STDOUT)
            except FileNotFoundError as e:
                lf.write('E: 渲染可执行文件不存在：%s\n' % e)
                rc = 127
        dt = time.monotonic() - t0
        log('RUN %s exit=%d %.1fs' % (tag, rc, dt))
        return rc, dt

    def finalize_shot(sid, rendered_via, seconds, group_phase=False):
        """齐全性复核 + 空白守卫 + 联系表 + 进度更新。返回 True=继续，False=停下。

        组阶段（group_phase）：组命令后仍缺帧的镜头退回 pending 交给逐镜阶段补渲（镜粒度断点续跑），
        只有空白守卫失败才停批；逐镜阶段补完仍缺帧即判失败停批。"""
        s = next(x for x in sel if x['id'] == sid)
        ok, per = shot_state(a.out_root, s['light'], sid, s['frames'])
        p = prog['shots'][sid]
        p['framesDone'] = per['beauty']['ok']
        if not ok:
            if group_phase:
                p.update(status='pending', note='组命令后仍缺帧，交给逐镜补渲（镜粒度）：%s' % json.dumps(per, ensure_ascii=False))
                return True
            p.update(status='failed-incomplete', note='渲染后帧文件仍不齐全：%s' % json.dumps(per, ensure_ascii=False))
            prog['stoppedReason'] = '%s 渲染后仍缺帧' % sid
            return False
        p['secondsTotal'] = round(seconds, 1)
        p['secondsPerFrame'] = round(seconds / max(1, s['frames']), 2)
        g_ok, g_detail = guard_shot(a.out_root, s['light'], sid, s['frames'])
        p['guard'] = 'pass' if g_ok else 'fail'
        p['guardDetail'] = g_detail
        if not g_ok:
            p.update(status='failed-guard', note='beauty 首/中/末空白（COMMON 判据）')
            prog['stoppedReason'] = '%s beauty 空白帧守卫失败' % sid
            return False
        p['status'] = 'rendered-%s' % rendered_via
        return True

    def eta_update():
        done_spf = [p['secondsPerFrame'] for p in prog['shots'].values() if p['secondsPerFrame']]
        pending = [p['framesExpected'] for p in prog['shots'].values() if p['status'] in ('pending', 'running')]
        if done_spf and pending:
            prog['etaSeconds'] = round(sum(pending) * (sum(done_spf) / len(done_spf)), 0)
        elif not pending:
            prog['etaSeconds'] = 0
        prog['updatedAt'] = now_iso()
        write_json(progress_path, prog)

    # A 组命令：组内镜头全部缺失才整组渲（部分缺失交给 B 逐镜补，避免重渲已齐镜头）
    for light, ids in groups:
        if stop['reason']:
            break
        missing = [sid for sid in ids if prog['shots'][sid]['status'] == 'pending']
        if not missing or len(missing) < len(ids):
            if missing:
                log('组 %s 跳过组命令（%d/%d 镜已齐），缺失镜头交给逐镜补渲：%s' % (light, len(ids) - len(missing), len(ids), ','.join(missing)))
            else:
                log('组 %s 全部镜头已齐，跳过组命令' % light)
            continue
        tag = 'group:%s' % light
        cmd = cmd_by_tag[tag][0]
        for sid in ids:
            prog['shots'][sid].update(status='running', attempts=prog['shots'][sid]['attempts'] + 1, command=cmd)
        eta_update()
        rc, dt = run_renderer(tag, cmd, ids)
        ok_all = True
        for sid in ids:
            if not finalize_shot(sid, 'group', dt / len(ids), group_phase=True):
                stop['reason'] = prog['stoppedReason']
                ok_all = False
                break
            eta_update()
        if not ok_all:
            break
        if rc != 0:
            log('WARN 组命令 %s 退出码 %d（已完成的镜头保留；仍缺的镜头由逐镜阶段补）' % (tag, rc))

    # B 逐镜命令：跳过已齐全，只补缺失（镜粒度）
    if not stop['reason']:
        for s in sel:
            sid = s['id']
            if stop['reason']:
                break
            p = prog['shots'][sid]
            if p['status'] != 'pending':
                continue
            cmd = shot_cmd[sid]
            p.update(status='running', attempts=p['attempts'] + 1, command=cmd)
            eta_update()
            rc, dt = run_renderer('shot:%s' % sid, cmd, [sid])
            if rc != 0:
                p.update(status='failed-render', note='渲染器退出码 %d' % rc)
                prog['stoppedReason'] = '%s 渲染器退出码 %d' % (sid, rc)
                stop['reason'] = prog['stoppedReason']
                break
            if not finalize_shot(sid, 'shot', dt):
                stop['reason'] = prog['stoppedReason']
                break
            eta_update()

    # 收尾：遗留 running 归一为 pending（停批时未轮到的镜头）；对全部齐全镜头统一出联系表（含续跑跳过的镜头）；
    # 写 RESULT.json + 进度终态
    for sid, p in prog['shots'].items():
        if p['status'] == 'running':
            p.update(status='pending', note='未轮到（批次提前停止）')
    for s in sel:
        p = prog['shots'][s['id']]
        if p['status'] in ('complete-preexisting', 'rendered-group', 'rendered-shot'):
            try:
                make_sheet(a.out_root, s['light'], s['id'], s['frames'], os.path.join(a.out_root, 'sheets', '%s.png' % s['id']))
                p['sheet'] = 'sheets/%s.png' % s['id']
            except Exception as e:
                p['sheet'] = 'error:%s' % e
                log('WARN 联系表失败 %s：%r' % (s['id'], e))
    prog['updatedAt'] = now_iso()
    prog['stoppedReason'] = stop['reason']
    eta_update()
    result = {'version': 1, 'tool': 'scripts/render-pv-batch.py', 'outRoot': a.out_root,
              'startedAt': prog['startedAt'], 'finishedAt': now_iso(),
              'group': a.group, 'shotsFilter': a.shots, 'extra': extra, 'framesFirstN': a.frames,
              'fps': fps, 'log': log_path,
              'status': 'failed' if stop['reason'] else 'ok',
              'stoppedReason': stop['reason'],
              'shots': []}
    for s in sel:
        p = prog['shots'][s['id']]
        result['shots'].append({'id': s['id'], 'light': s['light'], 'frames': s['frames'],
                                'framesFull': s['framesFull'], 'status': p['status'],
                                'secondsTotal': p['secondsTotal'], 'secondsPerFrame': p['secondsPerFrame'],
                                'guard': p['guard'], 'command': p['command']})
    result['totals'] = {'shots': len(sel), 'frames': total_sel_frames,
                        'rendered': sum(1 for x in result['shots'] if x['status'].startswith('rendered-')),
                        'skippedComplete': sum(1 for x in result['shots'] if x['status'] == 'complete-preexisting'),
                        'failed': sum(1 for x in result['shots'] if x['status'].startswith('failed-')),
                        'seconds': round(sum(x['secondsTotal'] or 0 for x in result['shots']), 1)}
    write_json(os.path.join(a.out_root, 'RESULT.json'), result)
    log('pv-batch 结束：status=%s rendered=%d skipped=%d failed=%d%s' % (
        result['status'], result['totals']['rendered'], result['totals']['skippedComplete'],
        result['totals']['failed'], ('（%s）' % stop['reason']) if stop['reason'] else ''))
    if lock:
        try:
            os.unlink(lock)
        except OSError:
            pass
    logf.close()
    return 1 if stop['reason'] else 0


def acquire_lock(out_root, log):
    """同一 out-root 防双开（O_EXCL；陈旧锁=持有进程已死则接管）。"""
    import errno
    p = os.path.join(out_root, '.pv-batch.lock')
    try:
        fd = os.open(p, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return p
    except OSError as e:
        if e.errno != errno.EEXIST:
            raise
    try:
        old = open(p, encoding='utf-8').read().strip()
    except OSError:
        old = ''
    alive = False
    if old.isdigit():
        try:
            os.kill(int(old), 0)
            alive = True
        except OSError:
            alive = False
    if alive:
        raise SystemExit('E: %s 已有一个 pv-batch 在跑（pid %s）；GPU 只允许一个 Blender 进程' % (out_root, old))
    log('WARN 接管陈旧锁 %s（旧 pid %s 已不存在）' % (p, old or '?'))
    open(p, 'w', encoding='utf-8').write(str(os.getpid()))
    return p


if __name__ == '__main__':
    sys.exit(main())
