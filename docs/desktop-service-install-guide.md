---
title: 桌面服务安装与配对说明
---

# 桌面服务安装与配对说明

本文档面向需要从源码安装、启动和配对 `code-desktop-service` 的用户。

公开链接：

- 桌面服务安装说明：<https://lyz1022.github.io/code-desktop-service/desktop-service-install-guide.html>
- GitHub Release：<https://github.com/lyz1022/code-desktop-service/releases>

## 1. 准备环境

安装 Node.js 20 LTS 或 22 LTS。Windows 推荐直接安装 Node.js 22：

```powershell
winget install -e --id OpenJS.NodeJS.22
```

启用 pnpm：

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

确保本机已安装 Codex Desktop，或有可用的 Codex CLI/App Server 可执行文件。

Linux 建议先确认本机 `codex` 已可直接执行，并且支持：

```bash
codex app-server --help
codex remote-control --help
```

## 2. Windows 快速安装

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1
```

如果 Codex 没有被自动发现，可显式传入 Codex 可执行文件：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1 `
  -CodexBin "C:\Users\<you>\AppData\Local\OpenAI\Codex\bin\<version>\codex.exe"
```

安装完成后立即启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1 -Start
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| `-DataDir <path>` | 指定服务数据、证书、日志和启动脚本目录。 |
| `-Port 37631` | 指定 HTTPS/WebSocket 端口。 |
| `-CodexBin <path>` | 指定 Codex 可执行文件路径。 |
| `-Start` | 安装后立即启动服务。 |
| `-SkipInstall` | 跳过依赖安装。 |
| `-SkipBuild` | 跳过构建。 |
| `-AllowUnsupportedNode` | 允许非推荐 Node.js 版本继续执行。 |

默认 Windows 数据目录：

```text
C:\Users\<you>\Documents\Codex\code-data
```

生成的启动脚本：

```text
C:\Users\<you>\Documents\Codex\code-data\start-code-desktop-service.ps1
```

生成的启动脚本默认监听 `0.0.0.0`，方便已配对移动端通过桌面电脑的局域网地址连接。请在桌面电脑本机通过 `https://localhost:37631` 打开管理页。

如需记录 Codex App Server 追踪日志：

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\<you>\Documents\Codex\code-data\start-code-desktop-service.ps1" -TraceAppServer
```

## 3. 手动安装

```bash
pnpm install --frozen-lockfile
pnpm --filter @code/protocol build
pnpm --filter @code/mac-service build
pnpm --filter @code/mac-service start
```

也可以直接启动已构建服务：

```bash
node mac-service/dist/main.js
```

Linux 常见启动方式：

```bash
export CODE_HOST=0.0.0.0
export CODE_PORT=37631
export CODEX_BIN="$(command -v codex)"
node mac-service/dist/main.js
```

## 4. 环境变量

macOS/Linux shell 示例：

```bash
export CODE_HOST=0.0.0.0
export CODE_PORT=37631
export CODE_DATA_DIR="$HOME/Documents/Codex/code-data"
export CODEX_BIN="/path/to/codex"
node mac-service/dist/main.js
```

Windows PowerShell 示例：

```powershell
$env:CODE_HOST = "0.0.0.0"
$env:CODE_PORT = "37631"
$env:CODE_DATA_DIR = "$HOME\Documents\Codex\code-data"
$env:CODEX_BIN = "C:\Users\<you>\AppData\Local\OpenAI\Codex\bin\<version>\codex.exe"
node .\mac-service\dist\main.js
```

## 5. 验证服务

打开管理页：

```text
https://localhost:37631
```

服务健康检查：

```bash
curl -k https://127.0.0.1:37631/api/health
```

Codex 预检：

```bash
curl -k https://127.0.0.1:37631/api/codex-preflight
```

## 6. 信任本机证书

服务会在每台桌面电脑上生成自己的本地 CA。仓库不携带共享证书或私钥。

请从桌面电脑本机打开 `https://localhost:37631`，在管理页执行证书信任安装。为了安全，安装信任动作只允许从 loopback 地址访问。

Linux 当前不会自动安装或检测本地证书信任状态。如果浏览器提示证书不受信任，请按你的发行版和桌面环境手动信任，或在调试阶段继续使用允许忽略本地证书警告的客户端路径。

如果浏览器安装信任后仍提示证书不受信任，请刷新页面或重启浏览器。

## 7. 配对移动端

1. 确认桌面电脑和移动设备在同一网络，或移动设备能直接访问桌面服务地址。
2. 打开桌面管理页 `https://localhost:37631`。
3. 确认管理页显示的服务地址。
4. 使用移动端扫描二维码。
5. 确认桌面端名称和证书指纹。

## 8. 项目根目录

可在管理页添加项目根目录，用于移动端新建项目和创建会话时选择创建位置。

Windows 上“选择文件夹”使用 PowerShell/.NET `FolderBrowserDialog`。如果当前桌面环境无法弹出系统窗口，请手动输入项目根目录路径。Linux 当前请直接手动输入项目根目录路径。

示例：

```text
C:\Users\<you>\Documents\Codex
$HOME/Documents/Codex
```

移动端通过 Windows 项目根目录新建项目时，服务端会在创建文件夹前校验项目名。包含 Windows 保留字符、以 `.` 结尾，或使用保留设备名的项目名会被拒绝。

## 9. Windows 常见问题

### node.exe 指向 WindowsApps

如果 `node.exe` 来自 WindowsApps alias 并报 `Access is denied`，请安装 Node.js 22，打开新的 PowerShell 窗口后重新运行安装脚本：

```powershell
winget install -e --id OpenJS.NodeJS.22
```

### Node.js 24 被拒绝

Node.js 24 可能触发 `better-sqlite3` 原生编译。推荐使用 Node.js 20 或 22；只有确认本机具备原生构建工具链时才使用 `-AllowUnsupportedNode`。

### Codex 未找到

使用 `-CodexBin` 或 `CODEX_BIN` 指向真实 Codex 可执行文件。避免使用 WindowsApps alias。

### 端口被占用

换一个端口启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1 -Port 37632 -Start
```

### 移动端无法连接

请检查：

- 桌面电脑和移动设备网络可互通；
- Windows Defender Firewall 允许 Node.js 使用专用网络；
- 入站 TCP 端口已放行；
- 管理页显示的是预期的局域网地址；
- 本机证书已信任；
- `/api/health` 返回 `ok: true`。
