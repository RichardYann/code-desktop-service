# code 桌面端服务

[English README](./README.md)

`code Desktop Service` 是配对移动端编程客户端使用的桌面端服务。它运行在用户自己的 Mac 或 Windows 电脑上，连接本机 Codex Desktop / App Server 运行时，并提供本地 HTTPS/WebSocket API 和轻量 Web 管理页，用于配对、会话、审批、项目根目录、媒体资产、本地 Web 预览和证书信任管理。

服务目录仍沿用历史名称 `mac-service`。当前代码已经包含 macOS 和 Windows 的桌面平台适配。

## 仓库包含

- `mac-service/`：桌面端服务源码、Web 管理页和测试。
- `packages/protocol/`：服务端使用的共享协议 schema。
- `scripts/install-windows-desktop-service.ps1`：Windows 轻量安装脚本。
- `docs/desktop-service-install-guide.md`：面向用户的安装与配对说明。
- `docs/privacy-policy-zh.md` 和 `docs/privacy-policy-en.md`：用户需要查看的移动端隐私政策。
- `docs/releases/`：公开版本说明。

本仓库不包含移动端源码、应用市场提交包、内部调试报告、本地探针、生成产物、本机证书/私钥或机器缓存。

## 公开文档

- 桌面服务安装与配对说明：<https://lyz1022.github.io/code-desktop-service/desktop-service-install-guide.html>
- 隐私政策：<https://lyz1022.github.io/code-desktop-service/privacy-policy-zh.html>
- English Privacy Policy：<https://lyz1022.github.io/code-desktop-service/privacy-policy-en.html>

## 环境要求

- Node.js 20 LTS 或 22 LTS。Windows 推荐 Node.js 22：

```powershell
winget install -e --id OpenJS.NodeJS.22
```

- pnpm 9.15.4，通常通过 Corepack 安装。
- 本机可用的 Codex Desktop，或支持 App Server 运行时的 Codex CLI。

如需启用 pnpm：

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

## Windows 快速安装

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1
```

如果 Codex 没有被自动发现，可显式传入可执行文件路径：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1 `
  -CodexBin "C:\Users\<you>\AppData\Local\OpenAI\Codex\bin\<version>\codex.exe"
```

如果希望安装完成后立即启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1 -Start
```

脚本会检查 Node.js、准备 pnpm、安装依赖、构建服务、验证 Codex，并在数据目录下生成本地启动脚本。生成的启动脚本使用安装时验证过的 `node.exe` 绝对路径，不依赖裸 `node`，可避开 WindowsApps alias 导致的启动失败。

默认 Windows 数据目录：

```text
C:\Users\<you>\Documents\Codex\code-data
```

生成的启动脚本：

```text
C:\Users\<you>\Documents\Codex\code-data\start-code-desktop-service.ps1
```

## 手动安装

```bash
pnpm install --frozen-lockfile
pnpm --filter @code/protocol build
pnpm --filter @code/mac-service build
pnpm --filter @code/mac-service start
```

默认监听地址：

```text
https://0.0.0.0:37631
```

在桌面电脑本机打开管理页：

```text
https://localhost:37631
```

健康检查：

```bash
curl -k https://127.0.0.1:37631/api/health
```

Codex 预检：

```bash
curl -k https://127.0.0.1:37631/api/codex-preflight
```

## 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODE_HOST` | `0.0.0.0` | HTTPS/WebSocket 绑定地址。如只允许本机访问，使用 `127.0.0.1`。 |
| `CODE_PORT` | `37631` | HTTPS/WebSocket 端口。 |
| `CODE_DATA_DIR` | 平台默认 | SQLite、证书和媒体资产持久化目录。 |
| `CODEX_BIN` | 自动探测 | 显式指定 Codex 可执行文件路径。 |
| `CODEX_IPC_SOCKET` | 未设置 | 可选 Codex IPC socket 路径。 |
| `CODE_PROJECT_ROOTS` | 空 | 管理页显示的项目根目录，多个目录用英文逗号分隔。 |
| `CODE_TRACE_CODEX_APP_SERVER` | 未设置 | 设置为 `1` 后记录 Codex App Server 通信追踪。 |

## 配对

1. 启动桌面端服务。
2. 在桌面电脑本机打开 `https://localhost:37631`。
3. 如有需要，在管理页安装/信任本机证书。
4. 按需配置项目根目录。
5. 使用已配对移动端客户端扫描管理页二维码。
6. 确认桌面端名称和证书指纹。

每台桌面设备都会生成自己的本地 CA 和服务证书。本仓库不保存共享 CA 私钥或服务证书。

## 平台说明

- macOS 支持服务运行、证书信任辅助、项目根目录选择器、截图捕获和 LaunchAgent 自启动。
- Windows 支持服务运行、HTTPS 管理页、二维码配对、项目根目录选择器、手动项目根目录配置和当前用户证书信任安装。
- Windows 自启动注册和捕获自动化在不可用时会明确返回不支持。

## 开发验证

协议包：

```bash
pnpm --filter @code/protocol typecheck
pnpm --filter @code/protocol test
```

桌面端服务：

```bash
pnpm --filter @code/mac-service typecheck
pnpm --filter @code/mac-service test
pnpm --filter @code/mac-service build
```

更多安装和排障说明见 [docs/desktop-service-install-guide.md](docs/desktop-service-install-guide.md)。
