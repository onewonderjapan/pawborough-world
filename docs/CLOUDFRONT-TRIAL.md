# 独立公开试玩站点

机主选择：专用 S3 + CloudFront，先使用 CloudFront 地址，后续再绑定子域名。游戏运行、碰撞和存档在浏览器内，不需要常驻 S1 游戏服务器。

公开试玩：https://pawborough.onewonder.co.jp/

原 CloudFront 地址仍可用：https://d1c74tvoxrrqcb.cloudfront.net/

2026-10-02 已发布。运行版本 `20261002-main-df137ad1`，源码 `df137ad1`；169 个运行文件、132,481,245 bytes（约126.34 MiB），逐对象上传并校验 SHA256。专用 stack `onewonder-pawborough-web`，分发 `E3GZY0L85XH6FN`；公开 HTTP 入口字节与本地版本一致，CSP 匹配，S3 直接匿名读取返回403。真实 Chrome 公网检查八项通过（17 分片、6 碰撞区、资源加载、上车/倒车/Esc/CSP）；小吃相关本地 Chrome 21项及车篮/刷新六项通过。

发布回执与截图：`/home/baibai/outbox/pawborough-cloudfront-preflight-20261002/artifacts/`。2026-10-02 已绑定 `pawborough.onewonder.co.jp`：现有 us-east-1 公司证书、Route53 A/AAAA 指向原分发。HTTPS 与入口字节验证通过。

## 导出运行包

在恢复当前输入清单所需 GLB、贴图和 npm 依赖后，从仓库根运行：

```sh
python3 -X utf8 tools/export_play_site.py --output /绝对路径/发布目录
```

`site/` 是可直接静态托管的目录；`artifacts/PUBLIC-MANIFEST.json` 列出每个公开文件的大小、SHA256、类型和缓存策略。导出器使用 `deploy/runtime-paths.json`，补齐全部 17 个场景分片的渲染/碰撞文件和方浜路线，将根路径改为 `versions/日期-main-提交/`。只列入本次版本，不会把导出目录中保留的旧版本列入新上传清单。

入口默认进入灰猫试玩。角色、小吃、自行车与关闭柜面 GLB 字节不修改；输入清单去掉私有原件路径和制作过程资料。Blend、参考照片、历史审查包、凭证和素材归档不进入发布包。每次源码或输入资源变化，必须重新导出并用真实浏览器检查静态目录。

## 云资源与更新顺序

`deploy/cloudfront-static.json` 是可复用的 CloudFormation 模板。`GameCsp` 参数取导出 `HEADERS.json` 的 Content-Security-Policy。专用 S3 阻断直接公开访问，开启版本控制与加密；CloudFront 通过 OAC 访问 `web/`，桶策略仅放行该分发。可选 DomainName/CertificateArn/HostedZoneId 参数管理子域名；当前已启用公司证书与该站 A/AAAA。更新 GameCsp 时必须保留这些参数。

上传者先核对 AWS 账户、该项目 stack/tag、桶名及分发 ID，按清单上传 `web/versions/当前版本/`，逐对象核对校验和/类型/缓存。所有依赖验证后最后上传 `web/index.html`；不删除旧版本、不对整个仓库做同步。版本文件缓存一年，入口不缓存。首次发布无需失效缓存；以后更新入口仅失效 `/` 与 `/index.html`。

安全策略只允许本站脚本与资源；Three.js 的 Basis 解码器在 Worker 内使用动态 JS 绑定，因此本站 CSP 需要 `unsafe-eval`，同时允许 WASM、blob Worker，以及入口精确 SHA256。以后更换入口时，策略应暂时保留上个入口的 SHA256，便于发布切换与回退。

公开后需要从 CloudFront 地址实际检查：17 个渲染分片、6 个碰撞分区、角色/小吃/自行车/关闭柜面全部加载；步行、倒车、Esc 暂停、取食及暂停后的手持稳定；没有脚本异常、资源 404 或 CSP 拦截。确认 S3 直接匿名访问拒绝。

试玩存档保存在访问者浏览器，换电脑或以后换域名不会自动带过去。目前只交付电脑浏览器试玩，不宣称手机触屏已适配。

## 独立试玩后的地面防陷版本

当前运行 `20261002-main-cebe4d2a`，169 文件、132,482,641 bytes。Gemini 3.8 Flash 独立试玩确认原版本四处仍可跌入背景底板；现已更新通行面判断、边缘阻止和地下存档校验。主控在新域名实测四条接近/退出路线八项及基础玩法八项通过。报告与未修项目见 `GEMINI-PLAYTEST-20261002.md`；不宣称全地图或全部视觉问题均通过。

域名/变更集回执：`/home/baibai/outbox/pawborough-domain-20261002/artifacts/`；独立试玩和复验：`/home/baibai/outbox/pawborough-gemini-playtest-20261002/`。

## 剩余试玩问题上线（2026-10-02）

当前运行 `20261002-main-a5d3bd03`，源码 `a5d3bd03ded8c674967a547f0126d656801a4e00`；172 文件、132,522,376 bytes（126.38 MiB）。桥头通行/门廊窄缝、轮子落地/骑姿、老街北顶棚与取景标签已更新。专用桶逐对象 SHA256、类型与缓存核对通过；先上传不可变资源，安全策略生效后再切换入口。域名、现有证书与 Route53 A/AAAA 保留。域名和原 CloudFront 入口字节与本地发布包一致。

公开 Chrome 24 项检查通过：基础加载与控制八项、老街北三项、取景三项、自行车八项、桥往返两项。普通按键从岸边到湖心亭门廊 17 点并返回 19 点，无位置写入冒充通行。40 份公开 GLB 与上一防陷版本字节一致。验收范围和截图见 `PLAYTEST-REMNANTS-20261002.md`；发布回执在原 preflight outbox，详细复验在 `/home/baibai/outbox/pawborough-remnants-20261002/artifacts/FINAL-ACCEPTANCE.json`。

## 双爪捧食版本（2026-10-02）

当前运行 `20261002-main-9108d443`，源码 `9108d4436723b69fbc212219eb408e17f1bd4f29`；172 文件、132,528,969 bytes。三味小吃按实际尺寸放大，双爪捧起并朝嘴进食，车篮/暂停/刷新行为保留。公开 Chrome 基础八项及小吃21项通过，域名和原 CloudFront 入口字节与本地一致；40份原GLB与上一版本字节一致。细节见 `SNACK-CUPPING-20261002.md`，回执与实景图在 `/home/baibai/outbox/pawborough-snack-cupping-20261002/artifacts/`。

旧主机 Python SDK 读取过期SSO token失败，但同profile的CLI仍有有效角色凭证。发布工具改由CLI取得同账号凭证，仅在内存传给SDK；没有写出或打印凭证，没有修改登录配置。

## 毛绒角色与互动美术第一轮（2026-10-02）

当前运行 `20261002-main-cc89c58e`，源码 `cc89c58ebf91e139277599d3b7a5514a50d42121`；176 文件、132,565,648 bytes（126.42 MiB）。包含角色材质/高光/肩腋过渡、单车轮圈与藤篮、热食与奖励反馈、逛吃手账和操作面板。域名及原 CloudFront 入口 SHA 匹配；40份原GLB未改。公开实景47项通过（资源/控制8、小吃24、单车8、界面7）。

美术方向、定量范围与整图后续提案见 `ART-DIRECTION-20261002.md`；证据在 `/home/baibai/outbox/pawborough-art-upgrade-20261002/artifacts/`，前后对照为同目录上级 `art-review.html`。
