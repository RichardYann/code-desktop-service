---
title: 桌面服务安装与配对说明
---

# 桌面服务安装与配对说明

本文档用于应用内配对提示、AppGallery 审核备注和 GitHub 发布页引用。

公开链接：

- 隐私政策：<https://lyz1022.github.io/code-desktop-service/privacy-policy-zh.html>
- 桌面服务安装说明：<https://lyz1022.github.io/code-desktop-service/desktop-service-install-guide.html>
- GitHub Release：<https://github.com/lyz1022/code-desktop-service/releases>

## 桌面端仓库

```text
https://github.com/lyz1022/code-desktop-service
```

## 推荐安装提示词

用户可以在桌面端 Codex 中输入：

```text
请帮我从 GitHub 仓库 https://github.com/lyz1022/code-desktop-service 安装并启动 code-desktop-service
```

英文提示词：

```text
Please install and start code-desktop-service from the GitHub repository https://github.com/lyz1022/code-desktop-service
```

## 配对步骤

1. 在 Mac 或 Windows 上安装并启动 `code-desktop-service`。
2. 在桌面浏览器打开 `https://localhost:37631`。
3. 如果浏览器提示连接不安全，在管理页右上角点击“安装信任”，按系统提示安装本机信任证书。
4. 确认鸿蒙设备和桌面端处于同一网络。
5. 在鸿蒙应用中点击“扫码配对”，扫描桌面管理页上的二维码。
6. 核对桌面端名称和 TLS 指纹后，点击“确认配对”。

## 审核人员说明

本应用没有云端测试账号。核心功能依赖审核人员在本机安装桌面服务后扫码配对。若审核环境无法安装桌面服务，可通过应用市场开发者联系方式或 GitHub Issues 联系开发者获取演示协助。

## 安全说明

- 每台桌面设备首次运行时生成自己的本地 CA，仓库不携带共享 CA 私钥。
- 桌面管理页只允许在本机 loopback 地址执行“安装信任”操作。
- 移动端配对时会保存桌面端证书身份信息，并在后续连接中校验已配对桌面身份。
