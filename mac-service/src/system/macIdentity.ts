import { execFileSync } from "node:child_process";
import os from "node:os";

function cleanName(value: string): string {
  return value.trim();
}

function readComputerName(): string {
  try {
    return cleanName(execFileSync("scutil", ["--get", "ComputerName"], {
      encoding: "utf8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"]
    }));
  } catch {
    return "";
  }
}

export function resolveLocalMacName(): string {
  const computerName = readComputerName();
  if (computerName.length > 0) {
    return computerName;
  }

  const hostName = cleanName(os.hostname());
  if (hostName.length > 0) {
    return hostName;
  }

  return "Mac";
}
