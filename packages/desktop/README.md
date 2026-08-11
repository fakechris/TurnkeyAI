# TurnkeyAI Desktop

Electron 只负责原生桌面窗口和本地 daemon 的启动/复用；页面仍由同一个 TurnkeyAI daemon 在 `/app` 提供。浏览器、macOS App 和 Windows App 共用 Control Center、Runtime、Mission 数据和鉴权边界，不会分叉成多套前端。

## 支持平台

- macOS 12+：Apple Silicon (`arm64`) 与 Intel (`x64`) DMG
- Windows 10/11：`x64` NSIS 安装包

当前不发布 Linux 安装包。主进程代码保持平台无关；后续可以在同一 electron-builder 配置上增加 Linux target。

## 开发和本机验收

浏览器入口保持不变：

```bash
npm run app
```

启动 Electron 壳：

```bash
npm run desktop:dev
```

运行自动化启动验收。它使用隔离的临时数据目录和随机 loopback 端口，启动 Electron、拉起内置 daemon、验证健康证明、加载 Control Center，然后清理临时 daemon：

```bash
npm run desktop:build
npm run smoke --workspace @turnkeyai/desktop
```

如果 daemon 由你单独管理，可让桌面壳只连接现有服务：

```bash
# macOS
TURNKEYAI_DAEMON_URL=http://127.0.0.1:4100 npm run desktop:dev
```

```powershell
# Windows PowerShell
$env:TURNKEYAI_DAEMON_URL = "http://127.0.0.1:4100"
npm run desktop:dev
```

桌面壳只接受 daemon 实际绑定的 `127.0.0.1` origin。它会用一次性 challenge 和本地 token 验证 daemon 的 HMAC proof，避免把 token 交给碰巧占用相同端口的其他进程。Renderer 保持 `sandbox`、`contextIsolation`、无 Node integration，并拒绝所有 Chromium 权限请求；非 `/app` 同源导航会在系统浏览器中打开。

## macOS 构建

固定配置：

- Product Name：`TurnkeyAI`
- Bundle Identifier：`com.turnkeyai.desktop`
- Minimum macOS：`12.0`
- 签名：ad-hoc（`mac.identity: "-"`）
- 公证：无

构建当前 Apple Silicon DMG：

```bash
npm run desktop:dist:mac:arm64
npm run desktop:verify:mac
```

构建 Apple Silicon 与 Intel DMG：

```bash
npm run desktop:dist:mac
npm run desktop:verify:mac:release
```

验证会检查两个 App 的 ad-hoc 签名、无 Apple Team ID 和真实 Mach-O 架构。`spctl` 拒绝未公证的 ad-hoc 构建属于预期行为；首次启动需要用户在“系统设置 → 隐私与安全性”中选择“仍要打开”。

## Windows 构建

在 Windows x64 环境运行：

```powershell
npm run desktop:dist:win
npm run desktop:verify:win
```

产物是可选择安装目录的 NSIS 安装包，会创建 Start Menu 和桌面快捷方式。验证会检查安装包的 PE 格式、`win-unpacked/TurnkeyAI.exe` 的完整性和 x64 machine header。

默认公开构建未配置商业代码签名证书，因此 Windows SmartScreen 可能显示“未知发布者”。如在仓库 secrets 中配置 electron-builder 支持的 Windows 签名凭据，构建会自动使用；凭据不得写入仓库或工作流日志。

## GitHub 自动发布

`packages/desktop/package.json` 的 `version` 是唯一版本源。发布脚本生成 `desktop-v<version>` annotated tag；tag 推到 GitHub 后，[Publish Desktop](../../.github/workflows/publish-desktop.yml) 会：

1. 在 macOS 和 Windows runner 上分别安装锁定依赖并校验 tag/version。
2. 在两个平台运行桌面单元测试、类型检查、构建和开发产物的真实 Electron 启动 smoke。
3. 构建 arm64/x64 DMG 与 Windows x64 NSIS 安装包，并再次从打包后的原生 executable 启动 smoke。
4. 只有两个平台都成功后，生成一个覆盖全部安装包的 `SHA256SUMS.txt`。
5. 创建或更新 `TurnkeyAI Desktop v<version>` GitHub Release，上传两个 DMG、一个 Windows EXE 和校验和。

日常流程：

```bash
# 修改 desktop version，完成审查并提交

# 仅运行 test/typecheck/build/smoke 和 tag/remote preflight
npm run desktop:release

# 推送当前分支和 annotated tag，触发跨平台发布
npm run desktop:release -- --push
```

脚本默认要求 clean worktree。确实需要从已提交 HEAD 发布并保留其他本地修改时，可显式使用 `--allow-dirty`；本地未提交内容不会进入 tag：

```bash
npm run desktop:release -- --push --allow-dirty
```

不要移动已经公开的 tag。代码修复应发布新的 patch version；纯 runner 故障可以重跑 workflow，或对已有 tag 手动触发：

```bash
gh workflow run publish-desktop.yml -f tag=desktop-v0.1.1
```

## 发布验收

CI 成功证明源代码、打包、架构、启动和上传链路正确。正式发布后还要从 GitHub Release 重新下载并检查：

1. 用 `SHA256SUMS.txt` 复核三个安装包。
2. 在干净 macOS 用户/虚拟机中挂载 DMG、拖入 Applications，并走完 quarantine 首次放行。
3. 在干净 Windows 10/11 x64 用户/虚拟机中运行 NSIS 安装、启动 App、确认 Control Center 加载，然后从系统设置卸载。
4. 两个平台分别创建一个 Mission，关闭桌面窗口后通过 CLI/浏览器确认同一 Runtime 数据仍可访问。

关闭 Electron 窗口不会停止日常 daemon，因此仍可用 `npm run app` 或 `turnkeyai app` 在浏览器继续访问同一个本地工作台。自动 smoke 模式是例外：为了保持 CI 隔离，它会清理自己启动的临时 daemon。
