# GLM 实作结果与可复用部分

试验根目录：`/home/baibai/outbox/pawborough-image-to-cat-glm-20260911`。

## 已观察到的结果

- C-template/r01：确实进行了局部变形并保留底模贴图；面部缩放不均、腿没有真正变长，低 Z 收腹误选脚。主控否决为成猫完成品。
- C-template/r02：GLM-5.3-Flash 生成修订脚本，主控修复头部权重、脚底 Z 位移及导出参数三个代码问题。模型实际 20,293 三角形、0 动画，保留原 4K 基础色与 2K 后处理贴图。真实多视图中脸与着地改善；仍有幼猫胸腹和尾形，不是已采用的 C 成猫正典。
- A-independent/r01：GLM-5.3-Flash 仅据文本方法和稀疏比例生成独立 loft 网格；未读取老师几何/贴图。主控修复无效耳尖面索引、尾轴顺序、材质槽等执行问题后导出，实际 1,852 三角形。真实图仍有明显接缝、硬折、眼睛被头面遮住、耳壳简化与纯色块，**独立路线未达目标**。

两条路线都保留 GLM 原代码、主控执行版 `build-reviewed.py`、`LEAD_PATCHES.json`、Blend、GLB 与真实图。不能称 GLM 完全独立完成，也不能把主控修过的代码当原始成功率。

## 可以复用的具体代码

从本 Skill 的 scripts/template_fit.py 调用以下例子（替换 output 为自己的新候选目录）：

```bash
/home/baibai/.local/bin/blender -b -t 6 --python-exit-code 1 \
  --python /home/baibai/.codex/skills/pawborough-image-to-cat/scripts/template_fit.py -- \
  --input /home/baibai/outbox/pawborough-image-to-cat-glm-20260911/teacher/neutral-standing.glb \
  --parameters /home/baibai/.codex/skills/pawborough-image-to-cat/assets/a-to-c-profile.json \
  --output /absolute/path/to/new-candidate
```

模板绑定姿态、UV 与材质的继承，是这条路线能保住质量的重要原因。当前例子不是普适图片转三维算法。图片相机和比例仍由主控测量，输入别的猫不能照搬坐标或现有哈希。

## 工序分工的实测教训

本机 ZCode 的长工单出现过终止或空结果退出；有一次程序返回 0 但没有后续交付。Flash 工单后来产出了 C 修订代码，但执行前被主控停止。实际文件与时间优先于旧 PROGRESS 字段。

最终独立 A 使用同一个已配置 GLM-5.3-Flash 的有限纯代码请求取得：只让模型输出代码，不让它模拟看图工具。主控检查代码并用 Blender 执行、查看实际渲染。GLM 原始代码有错误，仍需这一层审查。模型访问或 API helper 不等于 Tripo 图生三维服务，本试验新增 Tripo 积分消耗为 0。

当前建议：用已认可底模做有限参数变形；从零构造保留为研究。若继续独立路线，下一步需要真正连成一体的控制网格和可验证的眼眶/眼睑结构，不能继续把分离的 loft 物体摆在一起，或以增加细分数代替解剖修形。
