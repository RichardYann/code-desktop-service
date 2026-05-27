import type { FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import type { StoredLocalWebSession, createRepositories } from "../storage/repositories.js";

type LocalWebSessionRepository = ReturnType<typeof createRepositories>["localWebSessions"];
const LOCAL_WEB_PREVIEW_LANGUAGE_QUERY = "__code_preview_lang";

export interface LocalWebProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer | Readable;
  streaming: boolean;
}

export interface LocalWebProxy {
  proxyRequest(request: FastifyRequest, localWebSessionId: string, forwardedPath: string): Promise<LocalWebProxyResponse>;
}

export function createLocalWebProxy(input: { repository: LocalWebSessionRepository }): LocalWebProxy {
  return {
    async proxyRequest(request: FastifyRequest, localWebSessionId: string, forwardedPath: string): Promise<LocalWebProxyResponse> {
      const session = input.repository.get(localWebSessionId);
      if (!session || session.status !== "active") {
        throw new LocalWebProxyError("LOCAL_WEB_SESSION_NOT_FOUND", "本地 Web 会话不存在或已关闭");
      }
      if (isUpgradeRequest(request)) {
        throw new LocalWebProxyError("LOCAL_WEB_UPGRADE_UNSUPPORTED", "本地 Web WebSocket/HMR upgrade 代理尚未接入");
      }
      const targetUrl = buildTargetUrl(session, forwardedPath, request.url);
      let response: Response;
      try {
        response = await fetch(targetUrl, {
          method: request.method,
          headers: sanitizedHeaders(request),
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body as BodyInit | undefined,
          redirect: "manual"
        });
      } catch {
        input.repository.updateStatus({
          id: session.id,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error: "本地 Web 目标不可访问"
        });
        throw new LocalWebProxyError("LOCAL_WEB_TARGET_UNAVAILABLE", "本地 Web 目标不可访问");
      }

      const headers = responseHeaders(response, session);
      const contentType = response.headers.get("content-type") ?? "";
      if (shouldStreamResponse(contentType)) {
        return {
          statusCode: response.status,
          headers,
          body: response.body ? Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]) : Readable.from([]),
          streaming: true
        };
      }

      const body = Buffer.from(await response.arrayBuffer());
      return {
        statusCode: response.status,
        headers,
        body: shouldRewriteHtml(contentType) ? Buffer.from(rewriteHtml(body.toString("utf8"), session)) : body,
        streaming: false
      };
    }
  };
}

export class LocalWebProxyError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function buildTargetUrl(session: StoredLocalWebSession, forwardedPath: string, requestUrl: string): string {
  const targetBase = new URL(session.targetUrl);
  if (forwardedPath.length === 0) {
    return targetBase.href;
  }
  const target = new URL(forwardedPath, targetBase.href.endsWith("/") ? targetBase.href : new URL(".", targetBase.href).href);
  const queryStart = requestUrl.indexOf("?");
  if (queryStart >= 0) {
    target.search = forwardedQuery(requestUrl);
  }
  return target.href;
}

function forwardedQuery(requestUrl: string): string {
  const queryStart = requestUrl.indexOf("?");
  if (queryStart < 0) {
    return "";
  }
  const params = new URLSearchParams(requestUrl.slice(queryStart + 1));
  params.delete(LOCAL_WEB_PREVIEW_LANGUAGE_QUERY);
  const nextQuery = params.toString();
  return nextQuery.length > 0 ? `?${nextQuery}` : "";
}

function sanitizedHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (lower === "authorization" || lower === "host" || lower === "content-length") {
      continue;
    }
    if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  return headers;
}

function responseHeaders(response: Response, session: StoredLocalWebSession): Record<string, string> {
  const headers: Record<string, string> = {};
  const contentType = response.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  const location = response.headers.get("location");
  if (location) {
    headers.location = rewriteLocation(location, session);
  }
  return headers;
}

function shouldRewriteHtml(contentType: string): boolean {
  return contentType.toLowerCase().includes("text/html");
}

function shouldStreamResponse(contentType: string): boolean {
  return contentType.toLowerCase().includes("text/event-stream");
}

function isUpgradeRequest(request: FastifyRequest): boolean {
  const upgrade = request.headers.upgrade;
  const connection = request.headers.connection;
  const upgradeValue = Array.isArray(upgrade) ? upgrade.join(",") : upgrade ?? "";
  const connectionValue = Array.isArray(connection) ? connection.join(",") : connection ?? "";
  return upgradeValue.toLowerCase() === "websocket"
    || connectionValue.toLowerCase().split(",").map((value) => value.trim()).includes("upgrade");
}

function rewriteHtml(html: string, session: StoredLocalWebSession): string {
  const target = new URL(session.targetUrl);
  const origin = target.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html
    .replace(new RegExp(origin, "g"), session.proxyUrl.replace(/\/$/, ""))
    .replace(/(href|src)="\/([^"]*)"/g, `$1="${session.proxyUrl}$2"`);
}

function rewriteLocation(location: string, session: StoredLocalWebSession): string {
  try {
    const locationUrl = new URL(location, session.targetUrl);
    const targetUrl = new URL(session.targetUrl);
    if (locationUrl.origin !== targetUrl.origin) {
      return session.proxyUrl;
    }
    return session.proxyUrl + locationUrl.pathname.replace(/^\//, "") + locationUrl.search;
  } catch {
    return session.proxyUrl;
  }
}
