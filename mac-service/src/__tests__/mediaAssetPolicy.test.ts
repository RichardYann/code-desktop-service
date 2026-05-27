import { describe, expect, it } from "vitest";
import { classifyMediaAsset, validateMobileUpload } from "../domain/mediaAssetPolicy.js";

describe("mediaAssetPolicy", () => {
  it("accepts supported images up to 50M", () => {
    const result = validateMobileUpload({ fileName: "screen.png", mimeType: "image/png", sizeBytes: 50 * 1024 * 1024 });
    expect(result.ok).toBe(true);
    expect(classifyMediaAsset("screen.png", "image/png")).toBe("image");
  });

  it("accepts supported documents up to 50M and rejects larger files", () => {
    const accepted = validateMobileUpload({ fileName: "spec.pdf", mimeType: "application/pdf", sizeBytes: 50 * 1024 * 1024 });
    const rejected = validateMobileUpload({ fileName: "spec.pdf", mimeType: "application/pdf", sizeBytes: 50 * 1024 * 1024 + 1 });
    expect(accepted.ok).toBe(true);
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain("50M");
  });

  it("rejects archives and executables", () => {
    expect(validateMobileUpload({ fileName: "dist.zip", mimeType: "application/zip", sizeBytes: 1024 }).ok).toBe(false);
    expect(validateMobileUpload({ fileName: "run.sh", mimeType: "application/x-sh", sizeBytes: 1024 }).ok).toBe(false);
  });
});
