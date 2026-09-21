# Pawborough / 方浜市声

上海老城街景的 Three.js / Rapier 浏览与取景实验工程。当前已有主街、两处支弄和庙前入口，支持步行、取景、机位保存及本地便携包构建。

This is a public source snapshot of an experimental Shanghai street exploration and framing project. It is not a finished game or a historical survey.

## 当前公开范围

- 代码、脚本、数据清单及相关历史提交已公开。初始化来源为 `bb45ca6f73c9ca7648a0c979903bacf2027d86f5`，包含仍待验收的可靠性修复；机主视觉采用与公开源码是不同状态。
- **大型资产尚未上传。** 本仓保留 Git LFS 指针，目前没有可用的远端资产下载源。只克隆代码不能启动完整3D场景；不要把现有LFS指针当成完整备份。
- 资产清单见 [docs/ASSET-MANIFEST.json](docs/ASSET-MANIFEST.json)：10,647条路径、9,396个去重对象，约12.54GB。含历史渲染帧/源工程，不是网页每次要下载的数据量。S3桶/前缀与授权上传身份待确定。
- 源码许可证待项目所有者选择。本次未将第三方贴图、参考照片、模型、解码器统一重新许可；参见 [第三方说明](docs/THIRD-PARTY-NOTICES.md)。

## 查看源码

```bash
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/onewonderjapan/pawborough-world.git
cd pawborough-world
npm ci
```

完整运行还需要恢复匹配的资产。在资产源发布前，`npm run dev` / 构建 / 部分测试会因资产缺失而失败。不要将占位文件或旧资产替换为同名文件后声称验证通过。

本地资产齐全后：`npm run dev`，打开该服务下的 `world-preview.html`。源工程中的便携包制作脚本另见 `scripts/build_playable_package.mjs`。旧文档含S1工作机路径，供历史取证，外部使用者应以本README与后续发布的资产恢复指南为准。

## 已知边界

项目仍在开发。相关记录包含已修项、候选与历史失败，不能把任意历史PASS当成当前版本整体通过。真实GPU性能与跨机部署不在本次公开中承诺；全开配置预算与部分街缘通行仍有后续工作。

本仓未部署公开游戏服务，未上传任何S3资产。
