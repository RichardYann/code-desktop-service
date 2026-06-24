# code Desktop Service

[中文说明](./README.zh-CN.md)

`code Desktop Service` is the desktop-side service for a paired mobile coding
client. It runs on the user's Mac, Windows, or Linux machine, connects to the local
Codex Desktop/App Server runtime, and exposes a local HTTPS/WebSocket API plus a
lightweight management page for pairing, sessions, approvals, project roots,
media assets, local web previews, and certificate trust.

The implementation directory is still named `mac-service` for historical
reasons. The current service includes platform support for macOS, Windows, and
Linux. Linux currently targets Codex CLI connectivity plus pairing, sessions,
and project-root management. Certificate trust automation, startup integration,
system folder picking, and screen capture remain manual or unsupported on Linux.

## What Is Included

- `mac-service/` - desktop service source, web management UI, and tests.
- `packages/protocol/` - shared protocol schemas used by the service.
- `scripts/install-windows-desktop-service.ps1` - lightweight Windows setup script.
- `docs/desktop-service-install-guide.md` - user-facing install and pairing guide.
- `docs/privacy-policy-zh.md` and `docs/privacy-policy-en.md` - mobile client
  privacy policies needed by users.
- `docs/releases/` - public service release notes.

This repository intentionally does not include mobile app source, app store
submission packages, internal debugging reports, local probes, generated
artifacts, local certificates/private keys, or machine-specific caches.

## Public Documents

- Desktop Service Setup Guide: <https://lyz1022.github.io/code-desktop-service/desktop-service-install-guide.html>
- Privacy Policy: <https://lyz1022.github.io/code-desktop-service/privacy-policy-zh.html>
- English Privacy Policy: <https://lyz1022.github.io/code-desktop-service/privacy-policy-en.html>

## Requirements

- Node.js 20 LTS or 22 LTS. On Windows, prefer Node.js 22:

```powershell
winget install -e --id OpenJS.NodeJS.22
```

- pnpm 9.15.4, normally installed through Corepack.
- Codex Desktop or a Codex CLI that supports the App Server runtime.

Enable pnpm if needed:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

## Windows Quick Setup

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1
```

If Codex is not auto-detected, pass its executable path:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1 `
  -CodexBin "C:\Users\<you>\AppData\Local\OpenAI\Codex\bin\<version>\codex.exe"
```

To start the service immediately after setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows-desktop-service.ps1 -Start
```

The script validates Node.js, prepares pnpm, installs dependencies, builds the
service, verifies Codex, and writes a local start script under the configured
data directory. The generated start script uses the validated absolute
`node.exe` path instead of relying on `PATH`, which avoids WindowsApps alias
failures.

Default Windows data directory:

```text
C:\Users\<you>\Documents\Codex\code-data
```

Generated start script:

```text
C:\Users\<you>\Documents\Codex\code-data\start-code-desktop-service.ps1
```

## Manual Setup

```bash
pnpm install --frozen-lockfile
pnpm --filter @code/protocol build
pnpm --filter @code/mac-service build
pnpm --filter @code/mac-service start
```

By default, the service listens on:

```text
https://0.0.0.0:37631
```

Open the management page from the desktop machine:

```text
https://localhost:37631
```

Health check:

```bash
curl -k https://127.0.0.1:37631/api/health
```

Codex preflight:

```bash
curl -k https://127.0.0.1:37631/api/codex-preflight
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `CODE_HOST` | `0.0.0.0` | HTTPS/WebSocket bind host. Use `127.0.0.1` for local-only access. |
| `CODE_PORT` | `37631` | HTTPS/WebSocket port. |
| `CODE_DATA_DIR` | platform default | Persistent data directory for SQLite, certificates, and media assets. |
| `CODEX_BIN` | auto-detected | Explicit Codex executable path. |
| `CODEX_IPC_SOCKET` | unset | Optional Codex IPC socket path. |
| `CODE_PROJECT_ROOTS` | empty | Comma-separated project roots shown in the management page. |
| `CODE_TRACE_CODEX_APP_SERVER` | unset | Set to `1` to trace Codex App Server traffic. |

## Pairing

1. Start the desktop service.
2. Open `https://localhost:37631` on the desktop machine.
3. Install/trust the local certificate from the management page when needed.
4. Configure project roots if needed.
5. Scan the QR code from the paired mobile client.
6. Confirm the desktop name and certificate fingerprint.

Each desktop generates its own local CA and service certificate. The repository
does not store shared CA private keys or service certificates.

## Platform Notes

- macOS supports the service runtime, certificate trust helper, project-root
  picker, screenshot capture, and LaunchAgent startup integration.
- Windows supports the service runtime, HTTPS management page, QR pairing,
  project-root picker, manual project-root configuration, and current-user
  certificate trust installation.
- Windows startup registration and capture automation are intentionally reported
  as unsupported when unavailable.
- Linux supports the service runtime, HTTPS management page, QR pairing, manual
  project-root configuration, and Codex CLI discovery from PATH or
  `CODEX_BIN`.
- Linux certificate trust installation, startup registration, system folder
  picker, and capture automation are intentionally reported as unsupported in
  this phase.

## Development

Run protocol checks:

```bash
pnpm --filter @code/protocol typecheck
pnpm --filter @code/protocol test
```

Run service checks:

```bash
pnpm --filter @code/mac-service typecheck
pnpm --filter @code/mac-service test
pnpm --filter @code/mac-service build
```

## More Details

See [docs/desktop-service-install-guide.md](docs/desktop-service-install-guide.md)
for the public install and troubleshooting guide.
