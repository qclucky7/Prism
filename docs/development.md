# Prism 浏览器指纹实验台

本地多厂商 Chromium 指纹浏览器检测 工具。通过进程和监听端口发现 CDP 端点，在每个所选实例中打开检测页，保存实际网页可见指纹并对比。

## 技术栈

- 前端：React 19、TypeScript、Vite、Ant Design 6、Ant Design Icons。
- 桌面端：Tauri 2、Rust、Axum、CDP WebSocket。采集服务在 Tauri 进程内运行。
- Web 开发入口：Vite + 同一个 Rust/Axum 后端，没有独立 Node 采集服务。
- 发现：Windows 使用 Win32_Process 和 Get-NetTCPConnection，macOS 使用进程信息和 lsof。两者均支持 DevToolsActivePort。
- 存储：SQLite，桌面版沿用原有的数据库文件和数据格式。
- 验证：Rust 后端单元测试、共享 TypeScript 单元测试、Playwright 和两个真实 Chrome 进程。
- 检测底座：固定提交 CreepJS 本地模块，通过上游相同的 Rollup + TypeScript 管线构建；保留 MIT 许可证。

## 桌面开发版

开发版需要 Node.js 22.13+ 和 Rust 工具链。Windows 需要 MSVC、Visual Studio C++ 桌面开发组件和 WebView2，开发脚本会自动加载已安装的 Visual Studio 编译环境，可以从普通 PowerShell 运行。macOS 需要 Xcode Command Line Tools 和系统 WKWebView。

```powershell
npm install
npm run desktop:dev
```

桌面版运行时只需启动 Prism，Node.js 用于编译前端资源。桌面版将 `prism.sqlite` 写入系统应用数据目录（Windows 上为 `%LOCALAPPDATA%\app.prism.fingerprint`），Web 版默认使用项目下的 `data`。启动前可通过绝对路径形式的 `PRISM_DATA_DIR` 指定数据库目录。

需要发布时，在目标系统的编译环境终端中运行 `npm run desktop:build`。Windows 配置使用 NSIS，macOS 配置使用 App 和 DMG。

## 启动 Web 版

需要同样的 Rust 和前端构建工具。浏览器必须已开放可连接的本机 CDP 调试端口。

```powershell
npm install
npm start
```

`npm start` 自动编译资源和原生服务，打开 http://127.0.0.1:4318 。开发时运行 `npm run dev`，启动 Rust 服务和 Vite，打开终端显示的 Vite 地址（通常 http://127.0.0.1:5173），前端支持热更新。Rust 源码变更后重新启动开发命令。退出开发命令时会关闭其原生服务。

Node.js 仅用于前端构建、Vite 和开发脚本。编译后可直接运行 `src-tauri/target/debug/prism --serve`（Windows 使用 `prism.exe`），设置绝对路径 `PRISM_DATA_DIR` 后即可独立提供 Web 界面和 API，不需要 Node.js。

## 代码结构

- `src/`：React 界面、参数说明和对比展示。
- `shared/`：数据类型、工具清单、对比规则和统一中英文资源。
- `browser/`：在待测浏览器执行的检测适配器及页面表达式生成器。
- `public/`：检测页面、页面脚本、样式和品牌资源。
- `src-tauri/src/`：唯一的后端实现，负责进程发现、CDP、采集调度、结果校验、SQLite 和 API。
- `src-tauri/src/tests/`：原生后端测试；`tests/`：共享逻辑和真实浏览器集成测试。
- `scripts/`：构建与开发工具，不包含业务服务；其中 PowerShell 图标脚本由 Rust 在 Windows 上调用。

原 `server/` Node 服务已移除。检测页通过构建生成的 `src-tauri/generated/probes.json` 将表达式交给 Rust，运行时无需 TypeScript 解释器。

## 使用

1. 在各厂商客户端中启动待检测配置，并开启调试端口。
2. 点击“扫描本机实例”，或手动添加 `127.0.0.1:端口`。
3. 编辑实例名称和厂商名称。厂商标记可手动修正。
4. 勾选实例，点击“采集所选实例”，单选 BrowserLeaks、CreepJS 或 FingerprintJS。选择 BrowserLeaks 后可勾选它的指纹和网络项目。选择 CreepJS 或 FingerprintJS 后，可按需勾选 ipify、dnscheck.tools、WebRTC 和 TrackMe。全选按钮只影响当前工具的可选项目。每批最多 30 个实例，逐个采集。
5. 在“指纹对比”中选择快照，筛选差异、重复值、跨上下文不一致；支持同实例历史对比、JSON 导出与面向 AI 分析的 Markdown 差异报告。
6. 在“指纹对比 → 网络对比”查看随快照保存的 IPv4、IPv6、DNS、TLS、HTTP/2 和 WebRTC 读数。
   展开“地址归属、DNS 与 ECS”可以分页查看连接地址、ECS 网段和 DNS 解析器。旧快照的地址归属按当前页补查。“运行 dnscheck.tools 完整检测”会在当前实例打开原站，保存网页显示的地址分组、地区、反向 DNS、DNSSEC 和其他诊断读数，并标记补测时间。检测期间显示已等待时间，约 75 秒仍未结束时保存已取得的读数。
7. 配置变更测试从对比总览的一份快照点“设为改前”，在厂商浏览器里改好配置，再选运行中的实例点“采集改后”。采集记录中的“查看前后”可重新打开这组快照。

列表按每次扫描同步当前可连接实例，已关闭或不可连接的实例移出列表，同时取消其勾选。历史快照和实例标记保留；重新发现同一配置时恢复标记。扫描失败不会清空列表；进程扫描漏掉的已登记端点会再单独验证，可连接则保留。扫描之间不会自动轮询，浏览器状态变化后请重新扫描。可读到同一程序路径与 user-data-dir 时保留实例标记；无配置目录时仅靠端点无法可靠跟踪跨重启身份。

## 不使用厂商 API 的发现方式

- 读取浏览器主进程启动参数中的固定调试端口。
- 动态端口 `--remote-debugging-port=0`：读取用户数据目录中的 `DevToolsActivePort`。
- 按 PID 枚举本机监听端口，访问 `/json/version` 验证 CDP，支持改名的 Chromium 程序。
- 忽略 `--type=renderer/gpu-process/utility` 等 Chromium 子进程，同一 PID 的多个监听地址去重。
- 程序路径辅助识别厂商；没有开放调试端口的实例无法连接。

进程/监听枚举权限不足时可能漏检，可以在同一系统用户下启动浏览器与本工具，或手动添加已知端口。Electron 等非指纹浏览器也可能提供 CDP 并出现在列表中，请仅选择要测试的实例。

手动启动原生 Chrome 测试实例的 PowerShell 示例（请替换程序路径及配置目录）：

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --remote-debugging-port=9222 --user-data-dir='D:\prism-profiles\sample-a'
```

Chrome 136+ 的正式 Chrome 不允许通过这些参数调试默认数据目录，需要独立的 user-data-dir。指纹浏览器的具体开放方式以厂商实现为准。不要用此命令替代厂商启动器启动厂商配置，以免漏掉厂商的配置注入。

## 采集内容

当前主检测底座为 **CreepJS 的实际源码模块**，固定提交 `10aa6724cd33a1015db1574211890518cd04f0cc`。来源：https://github.com/abrahamjuliot/creepjs 。适配器由本项目维护，产品仍叫 Prism，不是官方 CreepJS 部署。

执行 22 个模块：workerScope、canvas2d、webgl、audio、fonts、screen、timezone、clientRects、svg、maths、css、cssMedia、intl、media、consoleErrors、window、htmlElement、navigator、headless、lies、trash、errors。保留各模块原始返回值及成功/不可用/失败状态。API 原型检查在模块初始化时执行。

`creepjs.*` 为实际上游结果；WebGL 1/2 像素和 Canvas 图像哈希使用上游 `hashify`，即 `SHA-256(JSON.stringify(value))`。音频 sampleHash 使用上游 hashify，但选择 `[binsSample, copySample, sampleSum]` 作为输入是 Prism 的适配决定，已记录在来源信息中。这些组件摘要不等同于官方页面的完整 FP ID。

`demo.*` 是上一版简易绘图的补充结果，不作为新检测主依据。旧 `demo-1` 快照仍可查看，但不会自动升级，需重新采集。不同算法/源码版本不合并为同一个渲染重复组。

以下为 Prism 保留的补充采集：

- 主页面、同源 iframe、Dedicated Worker：UA、platform、语言、语言顺序、逻辑核心数、内存档位、时区、UA Client Hints。
- 页面：webdriver、触摸点、插件名称、Cookie 支持、屏幕与窗口尺寸、Intl 和时区偏移。
- 渲染：Canvas 像素、WebGL 着色器像素、OfflineAudioContext 的 SHA-256 输出；WebGL 能力和 GPU 信息。
- 字体：有限候选字体的宽度探测，不是系统字体的完整枚举。

每个信号保存 `ok` / `unsupported` / `error`。错误和不支持值不算有效重复，JSON 对象键顺序不算差异。上游自身包含重复输出/像素修改等检查；尚未实现跨重启、多轮自动统计。

## 检测原理及限制

CDP 仅用于创建和关闭专用检测标签页，页面脚本自行采集并向本机服务提交结果。没有修改 UA、注入伪装、开启 Runtime 调试或覆盖浏览器参数。原有标签页保留，CDP 连接最后断开。新标签页可能短暂获得焦点；调试启用、窗口状态和运行方式本身仍可能影响结果。

检测页始终使用服务端同一源，Prism 的 iframe 为同源，补充 Worker 为 Dedicated Worker。上游按原逻辑依次尝试 Service Worker、Shared Worker、Dedicated Worker，并记录最终采用的类型，检测完成后清理本工具的 Service Worker 注册。这是“最佳可用 Worker”，不是三种 Worker 都独立采集成功。

指纹参数的检测脚本在本地运行。检测页 CSP 限制外部连接，同时允许上游 consoleErrors 模块所需的动态函数测试。上游启发式结果受浏览器版本、隐私设置和测试环境影响。

FingerprintJS 固定使用 `5.3.0`（MIT），在待测浏览器的本地标签页运行并关闭遥测。其组成项和指纹标识独立保存，按同一版本查看。检测入口和许可证来自 [FingerprintJS 上游](https://github.com/fingerprintjs/fingerprintjs)。

选择 BrowserLeaks 时，待测浏览器依次访问 [BrowserLeaks 官方检测页](https://browserleaks.com/)。Prism 保存所选项目的公开页面结果或 JSON 读数。在“指纹对比 → BrowserLeaks”选择同一检测项目查看各实例。单项失败会随快照保存，队列继续执行。公网出口页自身还包含其他 BrowserLeaks 探测，Prism 在公网出口项目里只保存出口和地址归属读数。

选择联网检测时，待测浏览器按所选工具向 ipify 获取 IPv4 和 IPv6 出口，使用 dnscheck.tools 的随机子域名读取解析器及 ECS 网段，或通过 [Stuntman 的开源公网 STUN 服务](https://www.stunprotocol.org/) 收集 WebRTC 映射地址和 ICE 候选。待测浏览器向 addr.tools 补查已观测公网地址的归属，也可在单独的临时标签页访问 TrackMe 获取 TLS 和 HTTP 协议读数。网络明细按来源切换，历史 Cloudflare STUN 读数标记为原来源。结果和检测时间随快照保存，也包含在 JSON 导出中。

### 接入检测工具

在 `shared/captureTools.ts` 登记工具 ID、分组和采集选项文案。在 `src-tauri/src/capture.rs` 的采集计划中接入适配器，由 Rust 发起探测并校验返回值；网络报告校验位于 `src-tauri/src/network.rs`。页面执行逻辑放在 `browser/` 或 `public/`，表达式由 `scripts/build-engine.mjs` 生成原生清单。新增独立报告时，在 `CaptureToolReports` 声明对应类型，适配器将报告写入同名的 `toolReports` 项。

在 `src/ToolComparisonViews.ts` 注册工具的结果组件。组件接收来自同一工具的快照，自行按版本或检测来源确定可比范围。批次调度、快照存储和配置变更后复采使用同一套流程。

在“网络对比”中，加入宿主基线且有 HTTPS 读数时默认使用该快照作为参照，也可以手动选其他快照。WebRTC 按地址族对照。若代理出口变化，且至少两个独立测试域名的解析器仍命中已确认的直连运营商 DNS，则提示疑似绕行。公共解析器重合时，仍需结合网络路径确认。

新快照记录由可执行文件路径、`user-data-dir` 和可读到的 `--profile-directory` 生成的配置标识。前后采集时优先按标识匹配，旧快照和无法匹配的实例需要手动确认。改后快照保存改前快照的 ID、匹配方式和备注。

厂商配置的目标参数无法从 CDP 通用获取，工具 不比较“配置声明与实际值”。相同宿主 GPU、系统和内核可能自然产生相同渲染输出。目标测试浏览器必须能直连 Prism 的本机服务地址，代理拦截本机地址时会超时。

## 数据与接口

默认数据库为 `data/prism.sqlite`，快照不可变；实例标记后续修改不会重写历史快照。界面最近显示 300 份快照，数据库继续保留更早数据。

环境变量：`PORT`（`npm start` 默认 4318；桌面版使用动态端口）、`PRISM_DATA_DIR`（绝对路径数据库目录）、`PRISM_UI_DIR`（可选，绝对路径静态资源目录）。仅监听 127.0.0.1，调试端点也仅接受本机地址。开发代理仅为同源请求转换 Origin，跨站 API 请求仍会被拒绝。

主要接口：`GET /api/state`、`GET /api/snapshots/:id`（完整原始证据）、`POST /api/discover`、`POST /api/instances`、`PATCH /api/instances/:id`、`POST /api/collect`、`POST /api/compare`。列表返回摘要，点击“原始证据”或导出时按需读取完整像素/图像和原始模块结果。采集提交使用单次任务令牌，90 秒超时，上游单模块 20 秒超时。后端不保存完整进程命令行，只保存必要的程序路径与配置目录。

源码与构建：上游保存在 `vendor/creepjs/src`，来源和逐文件 SHA-256 在 `vendor/creepjs/UPSTREAM.json`。`npm run build:engine` 校验源码后构建 `public/creep.js`，不改写上游检测逻辑。许可证可通过 `/licenses/creepjs.txt` 查看。适配入口为 `browser/upstream.ts`。

## 验证

```powershell
npm test
npm run build
npm run test:e2e
```

`npm test` 运行共享 TypeScript 测试和 Rust 后端测试。`npm run test:e2e` 自动构建并始终使用原生后端，使用独立临时目录和端口 4329，不操作用户已有浏览器标签。默认使用本机 Chrome，路径不同可设置 `CHROME_PATH`。覆盖两个真实 Chrome 的动态端口发现、手动登记、厂商标记、上游模块采集、像素哈希复算、原标签保留、SQLite 重启恢复、关闭实例扫描移除、无效提交拒绝及 UI 操作；另在一次性测试页中验证原型篡改能被上游发现、WebGL 不可用时明确标记失败、CSP 不影响错误特征。截图输出到 `test-results/`，测试数据使用系统临时目录。
