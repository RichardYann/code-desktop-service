export interface ServiceAddress {
  host: string;
  port: number;
}

export function serviceUptimeSeconds(startedAt: string, nowMs: number = Date.now()): number {
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(startedAtMs) || nowMs < startedAtMs) {
    return 0;
  }
  return Math.floor((nowMs - startedAtMs) / 1000);
}

export function isAddressInUseError(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: unknown };
  return record.code === "EADDRINUSE";
}

export function formatAddressInUseMessage(address: ServiceAddress): string {
  return [
    `端口 ${address.port} 已被占用，通常表示已有 code 桌面端服务正在运行。`,
    `请打开 https://127.0.0.1:${address.port} 复用当前服务；如果页面打不开，再停止旧进程后重新启动。`,
    `监听地址：${address.host}:${address.port}`
  ].join("\n");
}
