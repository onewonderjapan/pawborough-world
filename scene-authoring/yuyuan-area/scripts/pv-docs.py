#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""wave11-pvboard P1 / P3：由 pv-shots.json（正本）+ pv-cameras.json + 检查报告生成 STORYBOARD.md 与 AI-HANDOFF.md。

文档里的数字全部从输入文件读，不手填：镜头表（意图 / 目标 / 类别 / 焦距 / 机位起止 / 路径长 / 时长 / 灯光 / 转场）、
几何检查（tests/pv-shots-test.mjs JSON_OUT：最小净距 / 最大速度 / 角速度 / 终帧目标投影）、
渲染侧检查（scripts/check-pv-frames.py：终帧目标像素 / 天空 / 近景墙 / 平地）、动态样片时间码（build-animatic.py 的 json）。
删镜记录与编辑性说明从 --notes（json）读。

用法：python3 scripts/pv-docs.py --pv scripts/pv-shots.json --cameras <pv-cameras.json> --test <pv-shots-test.json>
          --frames-check <CHECK-PV-FRAMES.json> --animatic <animatic.json> --notes <notes.json> --out-dir <包>/artifacts/pv
"""
import argparse
import json
import math
import os

CLASS_ZH = {'ground': '地面眼高 1.6 m', 'raised': '升高机位', 'crane': '原地升降', 'aerial': '航拍'}
GEN_ZH = {'fixed-push': '固定机位微推 / 升降', 'travel': '行进', 'aerial': '航拍'}
CHANNELS = {
    'fixed-push': ('depth + 参考帧（首帧）；normal 可选', '机位几乎不动：深度锁构图，首帧参考锁材质与灯光；运动幅度小，生成模型最稳'),
    'travel': ('depth + normal + segmentation + 参考帧（首 / 末帧）', '机位行进、视差大：深度与法线约束几何，分割约束「楼不漂、桥不断」，首末帧双锚'),
    'aerial': ('depth + segmentation + 参考帧（首帧）', '航拍大场景：深度给层次，分割锁住楼群 / 池面 / 院落的分区不串位；normal 在远景意义小'),
}
# R1 审查必修1：渲染器按整次调用的 --preset 工作（不读每镜 light 字段），导出命令必须按 light 分组并显式带引擎与预设。
# 引擎按 docs/CONTROL-PASSES.md：PV 参考帧选 Cycles（GPU）；EEVEE 只作快速预览；Workbench 出不了灯光参考帧。
BEAUTY_ENGINE = 'cycles'
PRESETS = ('day', 'dusk', 'night')


def export_command(shot_ids, light, out_root):
    return ('~/.local/bin/blender -b -t 4 --python-exit-code 1 --python scripts/render-control-passes.py -- \\\n'
            '    --scene out-zone/scene-areas.glb --cameras out-zone/pv-cameras.json -- \\\n'
            '    --out %s --shots %s --beauty %s --preset %s' % (out_root + '/control-24fps', ','.join(shot_ids), BEAUTY_ENGINE, light))


def light_groups(shots):
    """按 pv-shots.json 的 light 字段把镜头顺序分组：[[light, [id…]]…]（不手写，由数据生成）。"""
    g = []
    for s in shots:
        if g and g[-1][0] == s['light']:
            g[-1][1].append(s['id'])
        else:
            g.append([s['light'], [s['id']]])
    return g


def check_export_commands(entries, shots):
    """检查生成的每条导出命令：预设 = 该镜 light、引擎非 workbench、--shots 与组一致。"""
    import re as _re
    by_id = {s['id']: s for s in shots}
    errs = []
    for tag, cmd, ids in entries:
        mp = _re.search(r'--preset (\S+)', cmd)
        mb = _re.search(r'--beauty (\S+)', cmd)
        ms = _re.search(r'--shots (\S+)', cmd)
        if not (mp and mb and ms):
            errs.append('%s: 缺 --beauty / --preset / --shots' % tag)
            continue
        preset, beauty, listed = mp.group(1), mb.group(1), ms.group(1).split(',')
        if preset not in PRESETS:
            errs.append('%s: 预设 %s 不在 day|dusk|night' % (tag, preset))
        if beauty not in ('cycles', 'eevee'):
            errs.append('%s: beauty 引擎 %s 出不了灯光参考帧（须 cycles|eevee）' % (tag, beauty))
        if listed != ids:
            errs.append('%s: --shots %s 与预期 %s 不符' % (tag, listed, ids))
        for sid in listed:
            if sid not in by_id:
                errs.append('%s: 镜头 %s 不在分镜' % (tag, sid))
            elif by_id[sid]['light'] != preset:
                errs.append('%s: 镜头 %s light=%s 但命令预设 %s' % (tag, sid, by_id[sid]['light'], preset))
    if errs:
        raise SystemExit('导出命令自检失败：\n  ' + '\n  '.join(errs))
    print('export-command check: %d commands, all presets match shot light' % len(entries))


def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def fmt_pt(p):
    return '(%.1f, %.1f, %.1f)' % (p[0], p[1], p[2])


def move_desc(s):
    e0, e1 = s['eye'][0], s['eye'][-1]
    L = s['eyePathM']
    d = '%s，%s，%.0f mm；机位 %s → %s，路径 %.1f m / %.1f s（均速 %.2f m/s）' % (
        CLASS_ZH.get(s['camClass'], s['camClass']), s['move'], s['lensMm'], fmt_pt(e0), fmt_pt(e1), L, s['durationS'], L / s['durationS'])
    if s['camClass'] == 'aerial':
        d += '；航拍高度 %.0f–%.0f m' % (min(e0[1], e1[1]), max(e0[1], e1[1]))
    if 'reuse' in s:
        d += '；复用 `%s` 归一化时间段 %s 重定时为 %d 帧' % (s['reuse']['shot'], s['reuse']['segment'], s['frames'])
    return d


def main():
    ap = argparse.ArgumentParser()
    for k in ('pv', 'cameras', 'test', 'frames-check', 'animatic', 'notes', 'out-dir'):
        ap.add_argument('--' + k, required=True)
    a = ap.parse_args()
    pv, cams, test, fc, anim, notes = (load(getattr(a, k.replace('-', '_'))) for k in ('pv', 'cameras', 'test', 'frames_check', 'animatic', 'notes'))
    shots = cams['shots']
    total = sum(s['durationS'] for s in shots)
    n_new = sum(1 for s in shots if s['status'] == 'new')
    lights = {}
    for s in shots:
        lights[s['light']] = lights.get(s['light'], 0) + s['durationS']
    anim_by = {x['id']: x for x in anim['shots']}
    P = notes['packageRoot']
    wt = notes['worktreeArea']
    pv_root = notes.get('pvRoot', P + '/artifacts/pv')

    # ---------------- STORYBOARD.md ----------------
    L = []
    L.append('# Pawborough PV 分镜（wave11-pvboard，2026-09-28 R1）\n')
    L.append('**结论**：%d 个镜头、总长 %.0f s（24 fps，%d 帧）；新镜头 %d 个、复用既有控制层镜头 %d 个（全部按 PV 重设时长）。'
             '灯光只打标签：day %.0f s / dusk %.0f s / night %.0f s，预设由 lighting/presets.json（wave11-lighting，已合入 main）提供。动态样片：`%s/animatic.mp4`（%d fps、%d×%d、%.1f s、无音轨）。\n'
             % (len(shots), total, sum(s['frames'] for s in shots), n_new, len(shots) - n_new, lights.get('day', 0), lights.get('dusk', 0),
                lights.get('night', 0), pv_root, anim['fps'], anim['width'], anim['height'], anim['durationS']))
    L.append('**本单替主控定的默认值**（可改，改 `%s/scripts/pv-shots.json` 后重跑即可）：\n' % wt)
    for d in notes['defaults']:
        L.append('- ' + d)
    L.append('\n**正本与复现**：分镜正本 `%s/scripts/pv-shots.json`（新镜头点位全部相对 layout 对象 / 实例，无绝对坐标）；'
             '逐帧相机 `%s/pv-cameras-24fps.json`（= `build-pv-shots.py` 输出，render-control-passes.py 同格式）。'
             '断言 `tests/pv-shots-test.mjs`（%d 项全过）；渲染侧 `scripts/check-pv-frames.py`（%d 个镜头标记）。\n'
             % (wt, pv_root, test['checks'], len(fc['flagged'])))
    L.append('## 结构\n')
    acts = []
    for s in shots:
        if not acts or acts[-1][0] != s['act']:
            acts.append([s['act'], []])
        acts[-1][1].append(s)
    t = 0.0
    for act, ss in acts:
        dur = sum(s['durationS'] for s in ss)
        L.append('- **%s**（%s–%s，%.0f s）：%s' % (act, '%05.2f' % t, '%05.2f' % (t + dur), dur, '、'.join('%02d' % s['no'] for s in ss)))
        t += dur
    L.append('\n## 镜头表\n')
    L.append('| # | id | 意图 | 目标对象 | 类别 / 运镜 | 焦距 | 时长 | 灯光 | 转场 入 / 出 | 新 / 复用 | 样片时间码 |')
    L.append('|---|---|---|---|---|---|---|---|---|---|---|')
    for s in shots:
        an = anim_by.get(s['id'], {})
        L.append('| %02d | `%s` | %s | `%s`%s | %s / %s | %.0f mm | %.1f s | %s | %s / %s | %s | %s–%s |' % (
            s['no'], s['id'], s['intent']['zh'], s['targetId'], ' ' + s['targetName'] if s.get('targetName') else '',
            CLASS_ZH[s['camClass']], s['move'], s['lensMm'], s['durationS'], s['light'], s['transitionIn'], s['transitionOut'],
            '新' if s['status'] == 'new' else '复用 `%s`' % s['reuse']['shot'], an.get('start', ''), an.get('end', '')))
    L.append('\n## 相机路径与取景口径（逐镜）\n')
    L.append('口径沿用 `control-shots-spec` / `tests/control-shots-test.mjs`：碰撞集 = 五分区 + 方浜中路 `collision-*.json`（水面隐形挡墙不算）；'
             '逐帧离碰撞盒 ≥ 1.0 m、相邻帧不穿盒；地面镜头眼高 1.6 m、不进建筑 footprint / 水面；航拍镜头写明高度且在建筑上空时高出保守屋顶 ≥ 3 m；'
             '目标 9 点可见 ≥ 5、裁画框投影 ≥ 8%（航拍全景镜头显式放宽，写在该镜）；每 1 s 窗口至少一半帧满足。'
             '渲染侧：四通道首 / 中 / 末帧统计终帧目标像素、天空、近景墙（深度 < 2.5 m 的竖直面）、平地（朝上平面，不含水面）。\n')
    for s in shots:
        ts = test['perShot'][s['id']]
        fr = fc['shots'][s['id']]['frames']
        L.append('### %02d `%s` — %s\n' % (s['no'], s['id'], s['title']))
        L.append('- 意图：%s / %s' % (s['intent']['zh'], s['intent']['en']))
        L.append('- 相机：%s' % move_desc(s))
        L.append('- 注视：首帧 %s → 末帧 %s' % (fmt_pt(s['target'][0]), fmt_pt(s['target'][-1])))
        L.append('- 几何检查：最小净距 %.2f m（%s）；最大速度 %.2f m/s；最大视向角速度 %.1f°/s；可见性满足帧 %d/%d；终帧目标投影 %.1f%%（门槛 %.1f%%）'
                 % (ts['minClearanceM'], ts['minClearanceName'], ts['maxSpeedMps'], ts['maxYawDegPerS'], ts['okFrames'], ts['frames'],
                    ts['endAreaPct'], ts['minTargetPct']))
        L.append('- 渲染侧（首 / 中 / 末）：目标像素 %s%%；天空 %s%%；近景墙 %s%%；平地 %s%%；水面 %s%%'
                 % ('/'.join('%.1f' % f['targetPct'] for f in fr), '/'.join('%.0f' % f['skyPct'] for f in fr),
                    '/'.join('%.0f' % f['nearWallPct'] for f in fr), '/'.join('%.0f' % f['flatPct'] for f in fr),
                    '/'.join('%.0f' % f['waterPct'] for f in fr)))
        L.append('- 预览帧：`%s/preview/control/%s/{beauty,depth,normal,segmentation}/frame-00{0,1,2}.png`（对应 24 fps 帧 %s）\n'
                 % (pv_root, s['id'], '/'.join(str(x) for x in s.get('sourceFrames', [0, (s['frames'] - 1) // 2, s['frames'] - 1]))))
    L.append('## 删掉的镜头（看图后）\n')
    for d in notes['dropped']:
        L.append('- **%s**（%s）：%s 证据：`%s`' % (d['id'], d['draft'], d['why'], d['evidence']))
    L.append('\n## 已知问题 / 给主控\n')
    for d in notes['issues']:
        L.append('- ' + d)
    L.append('\n## 看图记录\n')
    for d in notes['looked']:
        L.append('- ' + d)
    open(os.path.join(a.out_dir, 'STORYBOARD.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')

    # ---------------- AI-HANDOFF.md ----------------
    groups = light_groups(shots)
    H = []
    H.append('# Pawborough PV — AI 视频生成交接包（wave11-pvboard，2026-09-28 R1）\n')
    H.append('**用途**：机主定的视频路线是「AI 视频生成，3D 场景只出控制层与参考帧」。本文件给出每个镜头的控制层导出命令、需要的通道、'
             '中英提示词、负面词、时长与运镜描述，以及控制层与生成结果的对位方法。灯光已合入 main（ce0bae94）：'
             '第 1 节命令按 day / dusk / night 分组，显式带 `--beauty cycles --preset`，同一条命令同时出控制层与带灯光参考帧'
             '（depth / normal / segmentation 三通道不受灯光影响）；本包里的样片预览（Workbench beauty）只用于定分镜与节奏，不作生成输入。\n')
    H.append('## 1. 一次性导出（在同一 worktree 执行）\n')
    H.append('```bash\ncd <worktree>/scene-authoring/yuyuan-area\n'
             '# 0) 公共验收全流程重建（产物 out-zone/scene-areas.glb 与碰撞）\n'
             'OUT_DIR=out-zone PYTHONPATH=$PWD/.python-deps SITE_MODULES=1 STALL_KIT=1 GARDEN_KITS=1 SANSUITANG=1 ZONE_SPLIT=1 bash scripts/rebuild-review.sh\n'
             '# 1) 分镜 → 24 fps 逐帧相机（先从冻结源重算 control-shots.json，再生成 out-zone/pv-cameras.json）\n'
             'python3 -X utf8 scripts/build-pv-shots.py --out-zone out-zone\n'
             'OUT_DIR=out-zone node tests/pv-shots-test.mjs      # 必须 0 fail\n'
             '# 2) 四通道控制层 + 带灯光参考帧。渲染器按整次调用的 --preset 工作、不读每镜 light 字段，\n'
             '#    所以下面各组由 pv-shots.json 的 light 字段生成（组内 --shots + 对应 --preset），不许手写：\n')
    cmds = []
    for light, ids in groups:
        cmd = export_command(ids, light, pv_root)
        cmds.append(('group:' + light, cmd.replace(' \\\n', ' '), ids))
        H.append(cmd + '\n')
    H.append('```\n')
    H.append('- **自检**：生成器对上面每条命令断言「`--preset` = 组内每个镜头 pv-shots.json 的 `light`、`--beauty` ∈ cycles|eevee、`--shots` 与分组一致」，'
             '不一致即报错退出（本文件生成时已通过 %d 条）。' % len(cmds))
    H.append('- 规模：%d 帧 × 4 通道。控制层三通道约 1.2–1.3 s/帧（Workbench 批量实测）；beauty 按 CONTROL-PASSES 实测 Cycles GPU 8–13.4 s/帧'
             '（day/dusk/night），全量 %d 帧合计估算 %.0f–%.0f 小时（**按实测外推，整批未实测**）；'
             '本包样片只出了 Workbench 首 / 中 / 末三帧，平均 %.1f s/帧（三帧批次，BVH 复用摊不开，不代表批量速度）。'
             % (sum(s['frames'] for s in shots), sum(s['frames'] for s in shots),
                sum(s['frames'] for s in shots) * (1.2 + 8) / 3600, sum(s['frames'] for s in shots) * (1.35 + 13.4) / 3600,
                notes['previewSecPerFrame']))
    H.append('- 输出（`%s/control-24fps/`）：`segmentation-lut.json`（layout id ↔ RGB 双向映射）、`timings.json`（每帧耗时）、'
             '`beauty-meta.json`（非默认引擎时写：引擎 / 设备 / 采样 / 预设 / 点光数 / 自发光材质数）；每镜 `<id>/{beauty,depth,normal,segmentation}/frame-###.png` + `<id>/cameras/frame-###.json`。' % pv_root)
    H.append('- 编码与坐标约定不变（见 `scene-authoring/yuyuan-area/docs/CONTROL-PASSES.md`）：1280×720；depth 16-bit 视轴 z，near 0.3 / far 300 m；'
             'normal 为 glTF Y-up 世界系 (n+1)/2；segmentation 用 LUT 逐字节色（±2 反查）；每帧 cameras json 带 K、worldToCameraOpenGL / OpenCV。')
    H.append('- 航拍镜头远端超过 300 m 的几何在 depth / normal 通道被裁掉（深度 = far），beauty 同样裁剪；生成时远景按「薄雾天际」处理，不要让模型补出新建筑。\n')
    H.append('## 2. 控制层与生成结果的对位方法（相机 json → 视频对齐）\n')
    for d in notes['alignment']:
        H.append('- ' + d)
    H.append('\n## 3. 生成方式分组\n')
    H.append('| 生成方式 | 镜头 | 通道 | 理由 |')
    H.append('|---|---|---|---|')
    for g in ('fixed-push', 'travel', 'aerial'):
        ids = [s for s in shots if s['genMode'] == g]
        H.append('| %s（%s） | %s | %s | %s |' % (GEN_ZH[g], g, '、'.join('%02d' % s['no'] for s in ids), CHANNELS[g][0], CHANNELS[g][1]))
    H.append('\n## 4. 全局负面词\n')
    H.append('- 中文：%s' % pv['negative']['zh'])
    H.append('- English: %s' % pv['negative']['en'])
    H.append('- 形制词规则：%s / %s\n' % (pv['styleNote']['zh'], pv['styleNote']['en']))
    H.append('## 5. 逐镜头\n')
    for s in shots:
        an = anim_by.get(s['id'], {})
        n = s['frames']
        rng = 'frame-000 – frame-%03d（共 %d 帧 = 24 fps 第 0–%d 帧，t = 0 – %.3f s）' % (n - 1, n, n - 1, (n - 1) / 24.0)
        cmd = export_command([s['id']], s['light'], pv_root)
        cmds.append(('shot:%s' % s['id'], cmd.replace(' \\\n', ' '), [s['id']]))
        H.append('### %02d `%s` — %s\n' % (s['no'], s['id'], s['title']))
        H.append('- 时长 %.1f s = %d 帧 @24 fps；灯光 `%s`；转场 %s / %s；样片时间码 %s–%s' % (
            s['durationS'], n, s['light'], s['transitionIn'], s['transitionOut'], an.get('start', ''), an.get('end', '')))
        H.append('- 生成方式：%s；通道：%s' % (GEN_ZH[s['genMode']], CHANNELS[s['genMode']][0]))
        H.append('- 运镜：%s' % move_desc(s))
        H.append('- 控制层导出（单独补渲该镜；与第 1 节分组命令同参数，预设 = 该镜 light）：\n```bash\n%s\n```' % cmd)
        H.append('- 输出路径与有效帧范围（%s）：' % rng)
        H.append('  - 参考帧 beauty：`%s/control-24fps/%s/beauty/frame-000.png … frame-%03d.png`（%s 预设布光）' % (pv_root, s['id'], n - 1, s['light']))
        H.append('  - 深度 depth：`%s/control-24fps/%s/depth/frame-000.png … frame-%03d.png`（16-bit，同帧范围）' % (pv_root, s['id'], n - 1))
        H.append('  - 法线 normal：`%s/control-24fps/%s/normal/frame-000.png … frame-%03d.png`（含 depth；同帧范围）' % (pv_root, s['id'], n - 1))
        H.append('  - 分割 segmentation：`%s/control-24fps/%s/segmentation/frame-000.png … frame-%03d.png`（同帧范围）' % (pv_root, s['id'], n - 1))
        H.append('  - 相机 cameras：`%s/control-24fps/%s/cameras/frame-000.json … frame-%03d.json`（每帧 K / worldToCamera，与同号帧一一对应）' % (pv_root, s['id'], n - 1))
        H.append('- 参考帧：首帧 `beauty/frame-000.png`，末帧 `beauty/frame-%03d.png`（%s 预设；与控制层同一命令同批产出，天然对齐）' % (n - 1, s['light']))
        H.append('- 提示词（中）：%s' % s['prompt']['zh'])
        H.append('- Prompt (EN): %s' % s['prompt']['en'])
        H.append('- 负面词：全局负面词（第 4 节）%s\n' % (notes['extraNegative'].get(s['id'], '')))
    check_export_commands(cmds, shots)
    H.append('## 6. 音乐与旁白（只留占位，不生成）\n')
    H.append('| 时间码 | 镜头 | 音乐占位 | 旁白占位 |')
    H.append('|---|---|---|---|')
    for act, ss in acts:
        a0, a1 = anim_by[ss[0]['id']]['start'], anim_by[ss[-1]['id']]['end']
        H.append('| %s–%s | %s | [MUSIC: %s] | [VO: 待定] |' % (a0, a1, '、'.join('%02d' % s['no'] for s in ss), act))
    H.append('\n## 7. 已知限制\n')
    for d in notes['handoffIssues']:
        H.append('- ' + d)
    open(os.path.join(a.out_dir, 'AI-HANDOFF.md'), 'w', encoding='utf-8').write('\n'.join(H) + '\n')
    print('wrote STORYBOARD.md / AI-HANDOFF.md ->', a.out_dir)


if __name__ == '__main__':
    main()
