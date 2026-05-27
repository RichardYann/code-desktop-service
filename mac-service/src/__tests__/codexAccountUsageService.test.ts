import { describe, expect, it } from "vitest";
import { createCodexAccountUsageService } from "../domain/codexAccountUsageService.js";

function createClient(response: unknown) {
  return {
    request: async () => response
  };
}

describe("codex account usage service", () => {
  it("reads official rate limit snapshots for ChatGPT accounts", async () => {
    const calls: string[] = [];
    const primaryReset = 1800000000;
    const secondaryReset = 1800003600;
    const service = createCodexAccountUsageService({
      clientFactory: async () => ({
        request: async (method: string, params?: Record<string, unknown>) => {
          calls.push(method);
          if (method === "account/read") {
            expect(params).toEqual({ refreshToken: false });
            return {
              account: {
                type: "chatgpt",
                email: "user@example.com",
                planType: "pro"
              },
              requiresOpenaiAuth: true
            };
          }
          if (method === "account/rateLimits/read") {
            expect(params).toBeUndefined();
            return {
              rateLimits: {
                limitId: "codex",
                limitName: null,
                primary: {
                  usedPercent: 42,
                  windowDurationMins: 60,
                  resetsAt: primaryReset
                },
                secondary: {
                  usedPercent: 5,
                  windowDurationMins: 1440,
                  resetsAt: secondaryReset
                },
                credits: {
                  hasCredits: true,
                  unlimited: false,
                  balance: "9.99"
                },
                planType: "pro",
                rateLimitReachedType: "workspace_member_usage_limit_reached"
              },
              rateLimitsByLimitId: {
                codex_other: {
                  limitId: "codex_other",
                  limitName: "codex_other",
                  primary: {
                    usedPercent: 88,
                    windowDurationMins: 30,
                    resetsAt: primaryReset
                  },
                  secondary: null,
                  credits: null,
                  planType: "pro",
                  rateLimitReachedType: null
                }
              }
            };
          }
          throw new Error(`unexpected method: ${method}`);
        }
      }),
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    const usage = await service.refresh();

    expect(calls).toEqual(["account/read", "account/rateLimits/read"]);
    expect(usage).toMatchObject({
      status: "available",
      accountLabel: "user@example.com",
      accountStatusText: "已登录",
      refreshedAt: "2026-05-18T08:00:00.000Z",
      limitId: "codex",
      primary: {
        usedPercent: 42,
        windowDurationMins: 60,
        resetsAt: new Date(primaryReset * 1000).toISOString()
      },
      secondary: {
        usedPercent: 5,
        windowDurationMins: 1440,
        resetsAt: new Date(secondaryReset * 1000).toISOString()
      },
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: "9.99"
      },
      planType: "pro",
      rateLimitReachedType: "workspace_member_usage_limit_reached",
      fiveHour: null,
      weekly: null
    });
    expect(usage.rateLimits.map((snapshot) => snapshot.limitId)).toEqual(["codex", "codex_other"]);
  });

  it("updates the cached usage snapshot from official rate limit notifications", async () => {
    const service = createCodexAccountUsageService({
      clientFactory: async () => createClient({
        account: {
          type: "chatgpt",
          email: "user@example.com",
          planType: "plus"
        },
        requiresOpenaiAuth: true
      }),
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    const updated = service.applyRateLimitsNotification({
      rateLimits: {
        limitId: "codex",
        primary: {
          usedPercent: 55,
          windowDurationMins: 300,
          resetsAt: "2026-05-18T12:00:00.000Z"
        },
        secondary: null,
        credits: null,
        planType: "plus",
        rateLimitReachedType: null
      }
    });

    expect(updated).toMatchObject({
      status: "available",
      accountLabel: "",
      accountStatusText: "已登录",
      refreshedAt: "2026-05-18T08:00:00.000Z",
      limitId: "codex",
      primary: {
        usedPercent: 55,
        windowDurationMins: 300,
        resetsAt: "2026-05-18T12:00:00.000Z"
      },
      planType: "plus",
      fiveHour: null,
      weekly: null
    });
    expect(service.snapshot()).toEqual(updated);
  });

  it("keeps the previous usage snapshot when official notifications contain the default empty rate limit", async () => {
    let nowCallCount = 0;
    const service = createCodexAccountUsageService({
      clientFactory: async () => ({
        request: async (method: string) => {
          if (method === "account/read") {
            return {
              account: {
                type: "chatgpt",
                email: "user@example.com",
                planType: "plus"
              },
              requiresOpenaiAuth: true
            };
          }
          if (method === "account/rateLimits/read") {
            return {
              rateLimits: {
                limitId: "codex",
                limitName: null,
                primary: {
                  usedPercent: 33,
                  windowDurationMins: 300,
                  resetsAt: "2026-05-18T12:00:00.000Z"
                },
                secondary: {
                  usedPercent: 7,
                  windowDurationMins: 10080,
                  resetsAt: "2026-05-25T12:00:00.000Z"
                },
                credits: {
                  hasCredits: true,
                  unlimited: false,
                  balance: "15.00"
                },
                planType: "plus",
                rateLimitReachedType: null
              }
            };
          }
          throw new Error(`unexpected method: ${method}`);
        }
      }),
      now: () => {
        nowCallCount += 1;
        return new Date(nowCallCount === 1 ? "2026-05-18T08:00:00.000Z" : "2026-05-18T08:05:00.000Z");
      }
    });

    const initial = await service.refresh();
    const updated = service.applyRateLimitsNotification({
      rateLimits: {
        limitId: "codex",
        limitName: null,
        primary: null,
        secondary: null,
        credits: null,
        planType: null,
        rateLimitReachedType: null
      }
    });

    expect(initial.status).toBe("available");
    expect(updated).toMatchObject({
      status: "available",
      refreshedAt: "2026-05-18T08:05:00.000Z",
      limitId: "codex",
      primary: {
        usedPercent: 33,
        windowDurationMins: 300,
        resetsAt: "2026-05-18T12:00:00.000Z"
      },
      secondary: {
        usedPercent: 7,
        windowDurationMins: 10080,
        resetsAt: "2026-05-25T12:00:00.000Z"
      },
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: "15.00"
      }
    });
  });

  it("maps explicit five hour and weekly usage windows", async () => {
    const service = createCodexAccountUsageService({
      clientFactory: async () => createClient({
        account: {
          email: "user@example.com",
          usage: {
            fiveHour: {
              used: 12,
              limit: 100,
              remaining: 88,
              resetsAt: "2026-05-18T10:00:00.000Z"
            },
            weekly: {
              used: 120,
              limit: 500,
              remaining: 380,
              resetsAt: "2026-05-25T00:00:00.000Z"
            }
          }
        }
      }),
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    const usage = await service.refresh();

    expect(usage).toMatchObject({
      status: "available",
      accountLabel: "user@example.com",
      accountStatusText: "已登录",
      refreshedAt: "2026-05-18T08:00:00.000Z",
      fiveHour: {
        used: 12,
        limit: 100,
        remaining: 88,
        resetsAt: "2026-05-18T10:00:00.000Z"
      },
      weekly: {
        used: 120,
        limit: 500,
        remaining: 380,
        resetsAt: "2026-05-25T00:00:00.000Z"
      },
      message: ""
    });
    expect(service.snapshot()).toEqual(usage);
  });

  it("returns unsupported instead of guessing when precise fields are absent", async () => {
    const service = createCodexAccountUsageService({
      clientFactory: async () => createClient({
        account: {
          email: "user@example.com",
          plan: "pro",
          requestCount: 42
        }
      }),
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    await expect(service.refresh()).resolves.toMatchObject({
      status: "unsupported",
      accountLabel: "user@example.com",
      accountStatusText: "已登录",
      fiveHour: null,
      weekly: null,
      message: "当前通道暂不支持读取精确用量"
    });
  });

  it("maps missing login to authRequired", async () => {
    const service = createCodexAccountUsageService({
      clientFactory: async () => createClient({
        account: null,
        requiresOpenaiAuth: true
      }),
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    await expect(service.refresh()).resolves.toMatchObject({
      status: "authRequired",
      accountLabel: "",
      accountStatusText: "需要在桌面端完成 Codex 登录",
      fiveHour: null,
      weekly: null,
      message: "需要在桌面端完成 Codex 登录"
    });
  });

  it("maps api key login to an explicit apiKey status without reading usage windows", async () => {
    const service = createCodexAccountUsageService({
      clientFactory: async () => createClient({
        account: {
          type: "apiKey",
          usage: {
            fiveHour: {
              used: 1,
              limit: 2,
              remaining: 1,
              resetsAt: "2026-05-18T10:00:00.000Z"
            },
            weekly: {
              used: 1,
              limit: 2,
              remaining: 1,
              resetsAt: "2026-05-25T00:00:00.000Z"
            }
          }
        },
        requiresOpenaiAuth: true
      }),
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    await expect(service.refresh()).resolves.toMatchObject({
      status: "apiKey",
      accountLabel: "",
      accountStatusText: "API 登录",
      fiveHour: null,
      weekly: null,
      message: "当前为 API 登录，账号用量仅支持 Codex 账号登录后读取"
    });
  });

  it("uses a short sanitized failure message", async () => {
    const service = createCodexAccountUsageService({
      clientFactory: async () => ({
        request: async () => {
          throw new Error("Authorization Bearer token leaked in upstream header");
        }
      }),
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    await expect(service.refresh()).resolves.toMatchObject({
      status: "failed",
      accountLabel: "",
      accountStatusText: "读取失败",
      fiveHour: null,
      weekly: null,
      message: "读取失败"
    });
  });

  it("keeps a short non-sensitive failure reason", async () => {
    const service = createCodexAccountUsageService({
      clientFactory: async () => ({
        request: async () => {
          throw new Error("upstream returned 503");
        }
      }),
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    await expect(service.refresh()).resolves.toMatchObject({
      status: "failed",
      accountLabel: "",
      accountStatusText: "读取失败：upstream returned 503",
      fiveHour: null,
      weekly: null,
      message: "读取失败：upstream returned 503"
    });
  });

  it("maps runtime connection failures to offline", async () => {
    const service = createCodexAccountUsageService({
      clientFactory: async () => {
        throw new Error("connect ENOENT /private/tmp/codex.sock");
      },
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    await expect(service.refresh()).resolves.toMatchObject({
      status: "offline",
      accountLabel: "",
      accountStatusText: "Codex 官方通道不可用",
      fiveHour: null,
      weekly: null,
      message: "Codex 官方通道不可用"
    });
  });

  it("maps unsupported account usage methods to unsupported instead of guessing", async () => {
    const service = createCodexAccountUsageService({
      clientFactory: async () => ({
        request: async () => {
          throw new Error("method not found: account/read");
        }
      }),
      now: () => new Date("2026-05-18T08:00:00.000Z")
    });

    await expect(service.refresh()).resolves.toMatchObject({
      status: "unsupported",
      accountLabel: "",
      accountStatusText: "当前通道暂不支持读取精确用量",
      fiveHour: null,
      weekly: null,
      message: "当前通道暂不支持读取精确用量"
    });
  });
});
