import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createStdioTransportForTest } from "../codex/codexAppServer.js";

describe("codex app server stdio transport", () => {
  it("does not write to stdio after transport is closed", () => {
    const writes: string[] = [];
    const stdin = new EventEmitter() as EventEmitter & {
      destroyed: boolean;
      writableEnded: boolean;
      write: (chunk: string) => boolean;
      end: () => void;
    };
    stdin.destroyed = false;
    stdin.writableEnded = false;
    stdin.write = (chunk: string) => {
      writes.push(chunk);
      return true;
    };
    stdin.end = () => {
      stdin.writableEnded = true;
    };
    const stdout = new EventEmitter();
    const transport = createStdioTransportForTest({ stdin, stdout });

    expect(transport.close).toBeDefined();
    transport.close?.();
    expect(() => transport.send("{\"id\":\"1\"}")).toThrow("Codex App Server stdio transport is closed");
    expect(writes.length).toBe(0);
  });
});
