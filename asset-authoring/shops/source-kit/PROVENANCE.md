# source-kit 来源记录（只读复制，未修改）

| 文件 | 原路径 | SHA256 |
|---|---|---|
| helpers.py | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/helpers.py | 1e3d8498edeaec410286ea60e96f9848edfc5d440417a6793e24a60512ca7f9f |
| Bricks061_2K-JPG_Color_1K.jpg | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/Bricks061_2K-JPG_Color_1K.jpg | 1f3ce8173e75b187cb7ac8b097a94008e7d5cd1fecea799a593cc9743996b222 |
| Bricks061_2K-JPG_NormalGL_1K.jpg | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/Bricks061_2K-JPG_NormalGL_1K.jpg | b491bab299622fa4709bae1d939ec4674bffbaeaa9a1e10d66cffea1f70b37d5 |
| Bricks061_2K-JPG_Roughness_1K.jpg | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/Bricks061_2K-JPG_Roughness_1K.jpg | 4825464954174dffb3a3aca9bef23db9881013f280eae9492a7dff5715f5ee8c |
| PaintedPlaster017_2K-JPG_Color_1K.jpg | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/PaintedPlaster017_2K-JPG_Color_1K.jpg | 4df6fad9c4939bc73c5a0f6fa1103c37d19ec81011c8631305500e82f524637d |
| PaintedPlaster017_2K-JPG_NormalGL_1K.jpg | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/PaintedPlaster017_2K-JPG_NormalGL_1K.jpg | 3dab2be0650809f946cff08fa0bee17397eb26ef7ba13276494bbfb12fe935b7 |
| PaintedPlaster017_2K-JPG_Roughness_1K.jpg | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/PaintedPlaster017_2K-JPG_Roughness_1K.jpg | 721fc5388ec4d35652c8f12257f4cb51feb089745ef0aa1344e50b00d5b4f3f8 |
| Wood092_2K-JPG_NormalGL_1K.jpg | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/Wood092_2K-JPG_NormalGL_1K.jpg | e2048d86ad46771551aae0e693d41a130cf3903036144f189cd14112e5779616 |
| roof-color.jpg | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/roof-color.jpg | ed1be8f6bc86b31576c6437cc92b8dd6e969455f6730da42746d38b501e25013 |
| roof-normal.png | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/roof-normal.png | 029c076ed01ad292245e5138a1c9b4be516ccdad1d6be90436f89deffa4c88c3 |
| wood-stain-color.jpg | /home/baibai/outbox/pawborough-world-ten-hour-20260921/workspace/building/wood-stain-color.jpg | 3365006948025802c9c5f0026e091342e8226a70b765688fe889a7af6d1beda5 |

说明：
- helpers.py 原样复制自源仓 building/helpers.py（box_glb / glb_to_blender / blender_to_glb）。
- mb_lite.py 由源仓 building/mb_lib.py 裁剪改编：去掉招牌/帘幔/灯笼/猫墙/开敞店内相关材质与构件，保留坐标契约、材质节点、box/mesh/cyl/finalize 导出管线；修改处以注释标明。
- 贴图仅本批实际使用的10个文件，材质引用走相对路径（本目录），可离线重跑。
- tools/inspect_glb.py 复制自技能 /home/baibai/.zcode/skills/pawborough-static-architecture/scripts/inspect_glb.py。
- preview/vendor/ 下 three.module.js / three.core.js / addons/{GLTFLoader,OrbitControls}.js / addons/utils/BufferGeometryUtils.js 复制自源仓 node_modules three@0.180.0，MIT 许可，本地打包，无外部CDN。
