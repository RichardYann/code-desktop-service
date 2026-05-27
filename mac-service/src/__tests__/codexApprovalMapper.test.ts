import { describe, expect, it } from "vitest";
import { mapCodexApprovalResponse } from "../codex/codexApprovalMapper.js";

describe("codex approval mapper", () => {
  it("maps command approval accept and decline decisions", () => {
    expect(mapCodexApprovalResponse({
      method: "item/commandExecution/requestApproval",
      actionId: "accept"
    })).toEqual({ decision: "accept" });

    expect(mapCodexApprovalResponse({
      method: "item/commandExecution/requestApproval",
      actionId: "reject"
    })).toEqual({ decision: "decline" });
  });

  it("maps file approval cancel decisions", () => {
    expect(mapCodexApprovalResponse({
      method: "item/fileChange/requestApproval",
      actionId: "cancel"
    })).toEqual({ decision: "cancel" });
  });

  it("maps legacy command and patch approvals to review decisions", () => {
    expect(mapCodexApprovalResponse({
      method: "execCommandApproval",
      actionId: "accept"
    })).toEqual({ decision: "approved" });

    expect(mapCodexApprovalResponse({
      method: "execCommandApproval",
      actionId: "acceptForSession"
    })).toEqual({ decision: "approved_for_session" });

    expect(mapCodexApprovalResponse({
      method: "applyPatchApproval",
      actionId: "decline"
    })).toEqual({ decision: "denied" });

    expect(mapCodexApprovalResponse({
      method: "applyPatchApproval",
      actionId: "cancel"
    })).toEqual({ decision: "abort" });
  });

  it("maps user input answers", () => {
    expect(mapCodexApprovalResponse({
      method: "item/tool/requestUserInput",
      actionId: "submit",
      answers: {
        reason: { answers: ["继续执行"] }
      }
    })).toEqual({
      answers: {
        reason: { answers: ["继续执行"] }
      }
    });
  });

  it("maps command approval session and amendment actions to official decisions", () => {
    expect(mapCodexApprovalResponse({
      method: "item/commandExecution/requestApproval",
      actionId: "acceptForSession"
    })).toEqual({ decision: "acceptForSession" });

    expect(mapCodexApprovalResponse({
      method: "item/commandExecution/requestApproval",
      actionId: "acceptWithExecpolicyAmendment",
      params: {
        proposedExecpolicyAmendment: ["pnpm", "test"]
      }
    })).toEqual({
      decision: {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: ["pnpm", "test"]
        }
      }
    });
  });

  it("maps command approval network policy amendments to official decision objects", () => {
    expect(mapCodexApprovalResponse({
      method: "item/commandExecution/requestApproval",
      actionId: "applyNetworkPolicyAmendment",
      params: {
        proposedNetworkPolicyAmendments: [
          { host: "api.example.com", action: "deny" },
          { host: "api.example.com", action: "allow" }
        ]
      }
    })).toEqual({
      decision: {
        applyNetworkPolicyAmendment: {
          network_policy_amendment: { host: "api.example.com", action: "allow" }
        }
      }
    });
  });

  it("maps file approval session-wide accept actions to file decisions", () => {
    expect(mapCodexApprovalResponse({
      method: "item/fileChange/requestApproval",
      actionId: "acceptForSession"
    })).toEqual({ decision: "acceptForSession" });
  });

  it("maps permissions approval actions to official permission responses", () => {
    const params = {
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: ["/tmp/input"],
          write: ["/tmp/output"]
        }
      }
    };

    expect(mapCodexApprovalResponse({
      method: "item/permissions/requestApproval",
      actionId: "grantForSession",
      params
    })).toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: null,
          write: null,
          entries: [
            { path: { type: "path", path: "/tmp/input" }, access: "read" },
            { path: { type: "path", path: "/tmp/output" }, access: "write" }
          ]
        }
      },
      scope: "session"
    });

    expect(mapCodexApprovalResponse({
      method: "item/permissions/requestApproval",
      actionId: "grantForTurnWithStrictAutoReview",
      params
    })).toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: {
          read: null,
          write: null,
          entries: [
            { path: { type: "path", path: "/tmp/input" }, access: "read" },
            { path: { type: "path", path: "/tmp/output" }, access: "write" }
          ]
        }
      },
      scope: "turn",
      strictAutoReview: true
    });
  });

  it("maps user input cancellation to an empty official answers response", () => {
    expect(mapCodexApprovalResponse({
      method: "item/tool/requestUserInput",
      actionId: "cancel"
    })).toEqual({ answers: {} });
  });

  it("maps mcp elicitation actions to official elicitation responses", () => {
    expect(mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "accept",
      answers: {
        reason: { answers: ["继续执行"] }
      }
    })).toEqual({
      action: "accept",
      content: { reason: "继续执行" },
      _meta: null
    });

    expect(mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "decline"
    })).toEqual({
      action: "decline",
      content: null,
      _meta: null
    });

    expect(mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "cancel",
      answers: {
        reason: { answers: ["不要继续"] }
      }
    })).toEqual({
      action: "cancel",
      content: null,
      _meta: null
    });
  });

  it("coerces MCP boolean form answers back to boolean content", () => {
    expect(mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "accept",
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            confirmed: { type: "boolean" },
            note: { type: "string" }
          },
          required: ["confirmed"]
        }
      },
      answers: {
        confirmed: { answers: ["True"] },
        note: { answers: ["继续"] }
      }
    })).toEqual({
      action: "accept",
      content: { confirmed: true, note: "继续" },
      _meta: null
    });
  });

  it("coerces MCP number and integer form answers back to numeric content", () => {
    expect(mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "accept",
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            threshold: { type: "number" },
            count: { type: "integer" }
          }
        }
      },
      answers: {
        threshold: { answers: ["12.5"] },
        count: { answers: ["12"] }
      }
    })).toEqual({
      action: "accept",
      content: { threshold: 12.5, count: 12 },
      _meta: null
    });
  });

  it("rejects invalid MCP number and integer answers with clear errors", () => {
    expect(() => mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "accept",
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            threshold: { type: "number" }
          }
        }
      },
      answers: {
        threshold: { answers: ["not-a-number"] }
      }
    })).toThrow("MCP 字段 threshold 需要 number 类型答案");

    expect(() => mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "accept",
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            count: { type: "integer" }
          }
        }
      },
      answers: {
        count: { answers: ["12.5"] }
      }
    })).toThrow("MCP 字段 count 需要 integer 类型答案");
  });

  it("keeps MCP array answers as arrays and coerces array item types", () => {
    expect(mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "accept",
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string" } },
            counts: { type: "array", items: { type: "integer" } },
            flags: { type: "array", items: { type: "boolean" } }
          }
        }
      },
      answers: {
        tags: { answers: ["alpha"] },
        counts: { answers: ["1", "2"] },
        flags: { answers: ["True", "False"] }
      }
    })).toEqual({
      action: "accept",
      content: {
        tags: ["alpha"],
        counts: [1, 2],
        flags: [true, false]
      },
      _meta: null
    });
  });

  it("rejects unsupported MCP object fields instead of flattening them to strings", () => {
    expect(() => mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "accept",
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            payload: { type: "object" }
          }
        }
      },
      answers: {
        payload: { answers: ['{"ok":true}'] }
      }
    })).toThrow("MCP 字段 payload 暂不支持 object 类型答案");
  });

  it("rejects empty MCP scalar answer arrays instead of fabricating empty strings", () => {
    expect(() => mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "accept",
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            path: { type: "string" }
          }
        }
      },
      answers: {
        path: { answers: [] }
      }
    })).toThrow("MCP 字段 path 缺少答案");
  });

  it("keeps explicit empty MCP array answers as arrays", () => {
    expect(mapCodexApprovalResponse({
      method: "mcpServer/elicitation/request",
      actionId: "accept",
      params: {
        requestedSchema: {
          type: "object",
          properties: {
            tags: { type: "array", items: { type: "string" } }
          }
        }
      },
      answers: {
        tags: { answers: [] }
      }
    })).toEqual({
      action: "accept",
      content: { tags: [] },
      _meta: null
    });
  });

  it("maps optional empty user input submit to the official empty answers response", () => {
    expect(mapCodexApprovalResponse({
      method: "item/tool/requestUserInput",
      actionId: "submit",
      answers: {}
    })).toEqual({ answers: {} });
  });
});
