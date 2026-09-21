# 第三方与资产许可边界

本说明不改变任何第三方许可，也不表示所有历史素材已获统一再分发许可。仓库公开源码与资产发布分别处理。

## 软件

当前锁定依赖的包元数据：Three.js 0.180.0（MIT）、Rapier3D compat 0.19.0（Apache-2.0）、gltf-validator 2.0.0-dev.3.10（Apache-2.0）、Vite 7.1.5（MIT）。具体版本以package-lock.json为准，安装包中的LICENSE保留其效力。

本仓历史构建输出与public/decoder包含第三方运行时代码。Three.js许可副本在licenses/THREE-LICENSE.txt；Draco许可来自https://github.com/google/draco，副本在licenses/DRACO-LICENSE.txt；Basis Universal许可来自https://github.com/BinomialLLC/basis_universal，副本在licenses/BASIS-UNIVERSAL-LICENSE.txt。历史输出是生成件，依赖更新后应重建，不移除上游版权与许可。

## 图片、模型、字体与参考

GLB、Blend、贴图、照片、视频和渲染帧目前仅公开Git LFS指针与哈希清单；实体已保存于私有S3备份，未开放公共下载。资产不因公开仓库而自动获得与源码相同的许可。后续发布应保留各素材的实际来源、作者、许可及适用署名条件。生成推理图标记design_inference，不当作历史照片或测绘依据。无法确定可再分发范围的素材保持未发布，不用猜测来源补许可证。
