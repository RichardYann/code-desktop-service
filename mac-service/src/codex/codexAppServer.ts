import { execa } from "execa";
import net from "node:net";
import { findCodexBinary } from "./codexBinary.js";
import { createCodexAppServerClient, type AppServerTransport, type CodexAppServerClient } from "./codexAppServerClient.js";

export interface CodexAppServerHandle {
  endpoint: string;
  transport: AppServerTransport;
  stop: () => Promise<void>;
}

export async function startCodexAppServer(codexBin: string, mode: "app-server" | "remote-control" = "app-server"): Promise<CodexAppServerHandle> {
  const endpoint = "stdio://";
  const args = mode === "remote-control" ? ["remote-control"] : ["app-server", "--listen", endpoint];
  const child = execa(codexBin, args, { stdio: ["pipe", "pipe", "ignore"] });

  return {
    endpoint,
    transport: createStdioTransport(child),
    async stop() {
      child.kill("SIGTERM");
      await Promise.race([
        child.catch(() => undefined),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 1_500);
        })
      ]);
    }
  };
}

function createStdioTransport(child: ReturnType<typeof execa>): AppServerTransport {
  if (!child.stdin || !child.stdout) {
    throw new Error("Codex App Server stdio transport is unavailable");
  }

  let onMessageHandler: ((chunk: string) => void) | null = null;
  let buffer = "";

  child.stdout.on("data", (data) => {
    buffer += data.toString("utf8");
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim().length > 0) onMessageHandler?.(part);
    }
  });

  return {
    send(chunk: string): void {
      child.stdin?.write(`${chunk}\n`);
    },
    onMessage(handler: (chunk: string) => void): void {
      onMessageHandler = handler;
    },
    close(): void {
      child.stdin?.end();
    }
  };
}

export function createUnixSocketTransport(endpoint: string): AppServerTransport {
  const socketPath = endpoint.replace("unix://", "");
  const socket = net.createConnection(socketPath);
  let onMessageHandler: ((chunk: string) => void) | null = null;
  let buffer = "";

  socket.on("data", (data) => {
    buffer += data.toString("utf8");
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.trim().length > 0) onMessageHandler?.(part);
    }
  });

  return {
    send(chunk: string): void {
      socket.write(`${chunk}\n`);
    },
    onMessage(handler: (chunk: string) => void): void {
      onMessageHandler = handler;
    },
    close(): void {
      socket.end();
    }
  };
}

export interface CodexAppServerConnection {
  client: CodexAppServerClient;
  stop: () => Promise<void>;
}

export interface CodexAppServerConfig {
  codexBin?: string;
  codexCandidates?: string[];
}

export async function createCodexAppServerConnectionFromConfig(config: CodexAppServerConfig): Promise<CodexAppServerConnection> {
  const found = config.codexBin
    ? { ok: true as const, path: config.codexBin }
    : findCodexBinary({ candidates: config.codexCandidates });
  if (!found.ok) {
    throw new Error(found.error);
  }
  const handle = await startCodexAppServer(found.path);
  const client = createCodexAppServerClient(handle.transport);
  await client.initialize();
  return {
    client,
    async stop() {
      client.close();
      await handle.stop();
    }
  };
}

export async function withCodexAppServerClientFromConfig<T>(config: CodexAppServerConfig, task: (client: CodexAppServerClient) => Promise<T>): Promise<T> {
  const connection = await createCodexAppServerConnectionFromConfig(config);
  try {
    return await task(connection.client);
  } finally {
    await connection.stop();
  }
}
