import { describe, expect, it } from "vitest";
import { formatAddressInUseMessage, isAddressInUseError } from "../server/serviceStatus.js";

describe("service status helpers", () => {
  it("recognizes port conflicts and explains the existing-service state", () => {
    const error = Object.assign(new Error("listen EADDRINUSE"), {
      code: "EADDRINUSE",
      address: "0.0.0.0",
      port: 37631
    });

    expect(isAddressInUseError(error)).toBe(true);
    expect(formatAddressInUseMessage({ host: "0.0.0.0", port: 37631 })).toContain("37631");
    expect(formatAddressInUseMessage({ host: "0.0.0.0", port: 37631 })).toContain("已有 code 桌面端服务");
  });
});
