<div align="center">

<img src="public/prism-favicon.png" width="80" height="80" alt="Prism logo" />

# Prism

**浏览器指纹与网络诊断工作台**

A local-first desktop workbench for browser fingerprint and network diagnostics.

[![Release](https://img.shields.io/github/v/release/qclucky7/Prism)](https://github.com/qclucky7/Prism/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-242424)](https://tauri.app/)

[下载安装包](https://github.com/qclucky7/Prism/releases/latest) · [开发文档](docs/development.md) · [反馈问题](https://github.com/qclucky7/Prism/issues)

</div>

Prism 用于采集和对比多个厂商 Chromium 浏览器在网页中暴露的指纹与网络信息。通过本机 CDP 调试端口连接实例，将检测结果保存为带批次、工具来源和版本信息的快照，帮助排查跨上下文矛盾、配置变更效果和潜在的宿主参数泄露线索。

## 功能

| 能力 | 说明 |
| --- | --- |
| 多厂商实例发现 | 扫描进程与监听端口，验证可连接的本机 CDP 端点，也支持手动添加 |
| 浏览器身份 | 保存实例标记和应用图标，根据程序路径、用户数据目录尝试识别同一配置 |
| 检测工具选择 | 每次选择 BrowserLeaks、CreepJS 或 FingerprintJS 中的一种，按实例排队执行 |
| 横向对比 | 对比来自同一工具且版本可比的快照，查看全量参数、差异、重复值和异常证据 |
| 本机基线 | 使用本机 Chrome 的可见临时窗口采集，按需加入对比 |
| 配置变更前后 | 将快照设为“改前”，修改配置后采集“改后”，追踪参数变化 |
| 网络诊断 | 查看 IPv4 / IPv6 出口、WebRTC、DNS、ECS、TLS 和 HTTP/2 等检测读数 |
| 批次历史 | 按采集批次组织，支持检测工具与浏览器厂商组合筛选、单条及批量删除 |
| AI 分析报告 | 导出带快照引用、来源、版本、差异及错误状态的 Markdown 报告 |
| 桌面体验 | 简体中文 / English、明暗主题、可折叠侧栏与参数说明 |

## 检测工具与数据来源

| 工具 | 运行方式 | 检测范围 |
| --- | --- | --- |
| [CreepJS](https://github.com/abrahamjuliot/creepjs) | 固定版本源码模块在本地检测页运行 | Canvas、WebGL、音频、字体、Navigator、Worker、原型完整性等 22 个模块，附加跨上下文检查 |
| [FingerprintJS](https://github.com/fingerprintjs/fingerprintjs) | 固定版本在本地检测页运行，关闭遥测 | 浏览器指纹标识与组成项 |
| [BrowserLeaks](https://browserleaks.com/) | 待测浏览器逐项访问第三方页面 | Canvas、WebGL、WebGPU、字体、Client Hints、CSS、DNS、WebRTC、TLS、HTTP/2、TCP/IP 等可选项目 |
| ipify / dnscheck.tools / Stuntman / TrackMe | 使用 CreepJS 或 FingerprintJS 时按需补充联网检测 | 出口 IP、DNS 解析器与 ECS、WebRTC 候选、TLS / HTTP 协议读数 |

BrowserLeaks 是外部服务接入，不随 Prism 分发其站点源码。不同工具保留各自的报告结构，不混合比较不同算法的哈希或分数。第三方页面变化或服务不可用可能影响采集，失败与未采集状态会单独保留。

### 如何理解结果

- 参数相同可能来自相同系统、硬件或内核，不能单独据此判定泄露。
- 与本机基线相同是排查线索，需要结合预期配置、重复采样和网络路径确认。
- 跨上下文不一致、配置修改未生效、代理前后仍出现相同直连网络信息，通常更值得复查。
- 缺失、失败、不支持会与有效数据区分，不能当作检测通过。

Prism 提供研究型诊断证据，不提供通用的“拟真认证”或保证网站放行的分数。详情见 [检测来源与边界](docs/detection-sources.md)。

## 下载与使用

在 [Releases](https://github.com/qclucky7/Prism/releases/latest) 下载 **Windows x64 安装包**。项目包含 macOS 平台实现和打包配置，需在对应系统上构建验证，本次未提供 macOS 安装包。

1. 在厂商客户端启动待测配置，并开启本机 CDP 调试端口。
2. 打开 Prism，点击 **扫描本机实例**，或手动添加调试端口。
3. 勾选实例，点击 **采集所选实例**，选择一种指纹工具及检测项目。
4. 等待顺序采集完成。在 **指纹对比** 中按批次选择快照，查看异常证据、全量参数或网络对比。
5. 需要判断宿主相关线索时，采集本机 Chrome 基线，按需加入对比。
6. 需要记录配置效果时，选择一份快照 **设为改前**，修改配置后执行 **采集改后**。
7. 选择至少两份快照后，点击 **导出差异报告**，保存 Markdown 文件。

没有开放 CDP 调试端口的浏览器无法采集。扫描结果可能包含开放调试端口的 Electron 应用，请选择实际要检测的实例。

<details>
<summary>使用原生 Chrome 创建测试实例</summary>

在 PowerShell 中执行，按实际安装位置修改路径。

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --remote-debugging-port=9222 --user-data-dir='D:\prism-profiles\sample-a'
```

使用独立用户数据目录。厂商浏览器应由其客户端启动，以保留厂商注入配置。

</details>

## 数据与隐私

快照、批次与应用图标保存在本机 SQLite 数据库。Windows 桌面版默认目录为 `%LOCALAPPDATA%\app.prism.fingerprint`，可通过绝对路径形式的 `PRISM_DATA_DIR` 指定目录。

本机服务仅监听 `127.0.0.1`，仅接受本机 CDP 端点。采集期间会在待测浏览器中打开专用标签页，任务结束后关闭。

CreepJS 和 FingerprintJS 指纹模块在本地运行。选择 BrowserLeaks 或联网检测后，**每个待测浏览器自己访问对应第三方服务**，服务方能看到连接来源 IP 及该检测涉及的数据。公网检测需要网络连接。

导出文件可能包含 IP、浏览器指纹与诊断信息，分享前请检查内容。

## 从源码运行

需要 Node.js **22.13+**、npm 和 Rust stable。Windows 需要 Visual Studio C++ 桌面开发组件与 WebView2，macOS 需要 Xcode Command Line Tools。

```sh
git clone https://github.com/qclucky7/Prism.git
cd Prism
npm ci
npm run desktop:dev
```

采集服务运行在 Tauri 的 Rust 进程内。Node.js 用于构建与开发，安装后的桌面程序无需独立 Node 后端。

| 命令 | 用途 |
| --- | --- |
| `npm run desktop:dev` | 构建并启动桌面开发版 |
| `npm run dev` | 启动 Vite 与原生后端进行 Web 开发 |
| `npm start` | 构建并启动本机 Web 版，默认端口 4318 |
| `npm test` | 构建前端并运行 TypeScript 与 Rust 测试 |
| `npm run test:e2e` | 使用两个真实 Chrome 实例执行集成测试，需安装 Chrome |
| `npm run desktop:build` | 在当前平台构建桌面安装包 |

Windows 发布构建请在 Visual Studio Developer PowerShell 中运行 `npm run desktop:build`。详见 [开发文档](docs/development.md)。

## 项目结构

```text
src/             React 界面、参数说明和对比视图
shared/          数据类型、工具注册、规则、主题与中英文资源
browser/         浏览器端检测适配器与页面表达式
public/          检测页面、脚本、图标与第三方许可证
src-tauri/src/   Rust 后端、CDP、发现、调度、SQLite 与 API
vendor/creepjs/  固定提交的 CreepJS 源码与校验清单
scripts/         构建、开发与平台辅助脚本
tests/           共享逻辑与真实浏览器集成测试
```

## 反馈与贡献

欢迎通过 [Issues](https://github.com/qclucky7/Prism/issues) 报告问题。请提供 Prism 版本、系统、浏览器厂商与内核版本、检测工具、复现步骤和脱敏后的错误信息。

提交改动前运行 `npm test`。涉及采集、CDP 或快照结构时，建议同时运行 `npm run test:e2e`。新增工具应保留来源、版本、原始状态，并在对应适配器中确定可比范围。

## 许可证与致谢

Prism 采用 [MIT License](LICENSE)。第三方源码、资源和品牌标识保留各自权利与许可证。Prism 与相关检测服务及厂商没有官方隶属或背书关系。

- CreepJS 固定提交 [`10aa672`](https://github.com/abrahamjuliot/creepjs/tree/10aa6724cd33a1015db1574211890518cd04f0cc)，保留 [MIT 许可证](vendor/creepjs/LICENSE)、[商标说明](vendor/creepjs/TRADEMARKS.md) 与 [逐文件校验清单](vendor/creepjs/UPSTREAM.json)。
- FingerprintJS 固定版本 `5.3.0`，保留 [MIT 许可证](public/licenses/fingerprintjs.txt)。
- 感谢 BrowserLeaks、ipify、dnscheck.tools、Stuntman、TrackMe 及相关开源项目提供的检测能力。
