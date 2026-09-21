# 从私有S3归档恢复资产

此归档绑定源提交 `bb45ca6f73c9ca7648a0c979903bacf2027d86f5`。不是持续同步服务，也不保证其他历史提交或后续施工资产都已归档。

## 权限与范围

GitHub仓库公开，S3桶私有；GitHub组织成员资格不会自动赋予AWS读取权限。使用有本桶GetObject权限的AWS身份，凭据由AWS CLI本地SSO管理，不放进仓库。源码许可与资产许可分别处理，此归档可读取不代表资产可公开再分发。

桶：`onewonder-pawborough-assets-566601428909-apne1`，区域`ap-northeast-1`。对象按SHA-256寻址，快照索引在：

```text
snapshots/owner/bb45ca6f73c9ca7648a0c979903bacf2027d86f5/SNAPSHOT-MANIFEST.json
```

## 克隆代码

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/onewonderjapan/pawborough-world.git
cd pawborough-world
aws sso login --profile YOUR_PROFILE
```

需要Python3和AWS CLI。恢复脚本使用docs/ASSET-MANIFEST.json中锁定的路径、大小和SHA；默认仅列概况：

```bash
python3 tools/restore_s3_assets.py
```

## 按需或完整恢复

恢复指定文件（可重复--path）：

```bash
python3 tools/restore_s3_assets.py --profile YOUR_PROFILE \
  --path world/lane-b-polish/lane-b/model.glb
```

恢复该快照列出的全部路径（含历史渲染帧/源工程，去重对象约12.54GB；目标树可能更大）：

```bash
python3 tools/restore_s3_assets.py --profile YOUR_PROFILE --all
```

每个文件完成下载后重新计算SHA-256；已有且正确的文件直接复用。脚本只替换匹配该摘要的LFS指针，拒绝覆盖不同内容的实文件；失败下载保留具名临时文件供检查，不删用户文件。`--target /new/path`可恢复到新目录。

这不是远端Git LFS服务；应使用本脚本从S3还原，而不是假设git lfs pull会从本桶自动取件。完整资产恢复后再执行npm ci和本项目开发/构建命令。

## 已执行验证的边界

上传时每个对象的远端SHA-256与大小均回读校验；另有GLB/Blend/PNG/MP4下载样本及恢复脚本的重复执行/拒绝覆盖检查。上述不等于已重下全部12.54GB并完整试玩，也不等于W2验证。
