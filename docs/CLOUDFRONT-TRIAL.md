# 独立公开试玩站点

机主选择：专用 S3 + CloudFront，先使用 CloudFront 地址，后续再绑定子域名。游戏运行、碰撞和存档在浏览器内，不需要常驻 S1 游戏服务器。

公开试玩：https://d1c74tvoxrrqcb.cloudfront.net/

2026-10-02 已发布。运行版本 `20261002-main-df137ad1`，源码 `df137ad1`；169 个运行文件、132,481,245 bytes（约126.34 MiB），逐对象上传并校验 SHA256。专用 stack `onewonder-pawborough-web`，分发 `E3GZY0L85XH6FN`；公开 HTTP 入口字节与本地版本一致，CSP 匹配，S3 直接匿名读取返回403。真实 Chrome 公网检查八项通过（17 分片、6 碰撞区、资源加载、上车/倒车/Esc/CSP）；小吃相关本地 Chrome 21项及车篮/刷新六项通过。

发布回执与截图：`/home/baibai/outbox/pawborough-cloudfront-preflight-20261002/artifacts/`。子域名尚未绑定，按机主选择留待后续。

## 导出运行包

在恢复当前输入清单所需 GLB、贴图和 npm 依赖后，从仓库根运行：

```sh
python3 -X utf8 tools/export_play_site.py --output /绝对路径/发布目录
```

`site/` 是可直接静态托管的目录；`artifacts/PUBLIC-MANIFEST.json` 列出每个公开文件的大小、SHA256、类型和缓存策略。导出器使用 `deploy/runtime-paths.json`，补齐全部 17 个场景分片的渲染/碰撞文件和方浜路线，将根路径改为 `versions/日期-main-提交/`。只列入本次版本，不会把导出目录中保留的旧版本列入新上传清单。

入口默认进入灰猫试玩。角色、小吃、自行车与关闭柜面 GLB 字节不修改；输入清单去掉私有原件路径和制作过程资料。Blend、参考照片、历史审查包、凭证和素材归档不进入发布包。每次源码或输入资源变化，必须重新导出并用真实浏览器检查静态目录。

## 云资源与更新顺序

`deploy/cloudfront-static.json` 是可复用的 CloudFormation 模板。`GameCsp` 参数取导出 `HEADERS.json` 的 Content-Security-Policy。专用 S3 阻断直接公开访问，开启版本控制与加密；CloudFront 通过 OAC 访问 `web/`，桶策略仅放行该分发。当前使用 CloudFront 默认证书，无 DNS/子域名修改。

上传者先核对 AWS 账户、该项目 stack/tag、桶名及分发 ID，按清单上传 `web/versions/当前版本/`，逐对象核对校验和/类型/缓存。所有依赖验证后最后上传 `web/index.html`；不删除旧版本、不对整个仓库做同步。版本文件缓存一年，入口不缓存。首次发布无需失效缓存；以后更新入口仅失效 `/` 与 `/index.html`。

安全策略只允许本站脚本与资源；Three.js 的 Basis 解码器在 Worker 内使用动态 JS 绑定，因此本站 CSP 需要 `unsafe-eval`，同时允许 WASM、blob Worker，以及入口精确 SHA256。以后更换入口时，策略应暂时保留上个入口的 SHA256，便于发布切换与回退。

公开后需要从 CloudFront 地址实际检查：17 个渲染分片、6 个碰撞分区、角色/小吃/自行车/关闭柜面全部加载；步行、倒车、Esc 暂停、取食及暂停后的手持稳定；没有脚本异常、资源 404 或 CSP 拦截。确认 S3 直接匿名访问拒绝。

试玩存档保存在访问者浏览器，换电脑或以后换域名不会自动带过去。目前只交付电脑浏览器试玩，不宣称手机触屏已适配。
