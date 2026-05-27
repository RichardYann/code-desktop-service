import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuditLog } from "./audit/auditLog.js";
import { createCodexAppServerConnectionFromConfig, withCodexAppServerClientFromConfig } from "./codex/codexAppServer.js";
import { detectCodexCli } from "./codex/codexBinary.js";
import { mapCodexModelList } from "./codex/codexModelMapper.js";
import { runCodexPreflight } from "./codex/codexPreflight.js";
import { mapCodexConfigReadToRuntimeConfigInput } from "./codex/codexRuntimeConfigMapper.js";
import { createCodexSessionManager } from "./codex/codexSessionManager.js";
import { loadConfig, type ServiceConfig } from "./config.js";
import { createCaptureService } from "./domain/captureService.js";
import { createCodexGeneratedImageArtifactService } from "./domain/codexGeneratedImageArtifactService.js";
import { createCodexAccountUsageService } from "./domain/codexAccountUsageService.js";
import { createMediaAssetService } from "./domain/mediaAssetService.js";
import { createLocalWebProxy } from "./domain/localWebProxy.js";
import { createProjectService } from "./domain/projectService.js";
import {
  createSessionRuntimeConfigService,
  type SessionRuntimeConfig,
  type SessionRuntimeConfigInput
} from "./domain/sessionRuntimeConfigService.js";
import { createSessionInputQueueService } from "./domain/sessionInputQueueService.js";
import { createSessionService } from "./domain/sessionService.js";
import { createPairingService } from "./security/pairing.js";
import { createCertificateTrustService } from "./security/certificateTrust.js";
import { collectDefaultTransportSubjectAltNames, ensureTransportCertificate } from "./security/transport.js";
import { openDatabase } from "./storage/db.js";
import { createRepositories } from "./storage/repositories.js";
import { createDesktopPlatform, type DesktopPlatform } from "./platform/desktopPlatform.js";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type RuntimeConfigTurnStore = Pick<ReturnType<typeof createSessionRuntimeConfigService>,
  "getUserOverride" | "hasCodexSessionConfig" | "saveCodexSessionConfig">;

export interface CreateAppContextOptions {
  platform?: DesktopPlatform;
}

export async function runtimeConfigForTurn(
  threadId: string,
  runtimeConfig: RuntimeConfigTurnStore,
  readRuntimeConfigBaseline: () => Promise<SessionRuntimeConfigInput>
): Promise<SessionRuntimeConfig | undefined> {
  const userOverride = runtimeConfig.getUserOverride(threadId);
  if (userOverride) {
    return userOverride;
  }
  if (!runtimeConfig.hasCodexSessionConfig(threadId)) {
    try {
      runtimeConfig.saveCodexSessionConfig(threadId, await readRuntimeConfigBaseline(), "codex-default-snapshot");
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function createAppContext(config: ServiceConfig = loadConfig(), options: CreateAppContextOptions = {}) {
  const platform = options.platform ?? createDesktopPlatform();
  const codexCandidates = config.codexCandidates ?? platform.defaultCodexBinaryCandidates();
  const codexConnectionConfig = {
    codexBin: config.codexBin,
    codexCandidates
  };
  const transport = ensureTransportCertificate(config.dataDir, collectDefaultTransportSubjectAltNames());
  const db = openDatabase("code-v1.sqlite", config);
  const repositories = createRepositories(db);
  const runtimeConfig = createSessionRuntimeConfigService(repositories);
  const mediaStorageDir = path.join(config.dataDir, "media-assets");
  const accountUsage = createCodexAccountUsageService({
    clientFactory: async () => {
      const connection = await createCodexAppServerConnectionFromConfig(codexConnectionConfig);
      return {
        request: async (method: "account/read" | "account/rateLimits/read", params?: Record<string, unknown>) => {
          return await connection.client.request(method, params);
        },
        close: async () => {
          await connection.stop();
        }
      };
    }
  });

  return {
    config,
    serviceStartedAt: new Date().toISOString(),
    localMacName: platform.resolveDisplayName(),
    transport,
    certificateTrust: createCertificateTrustService(),
    tls: {
      cert: fs.readFileSync(transport.certPath),
      key: fs.readFileSync(transport.keyPath)
    },
    db,
    repositories,
    audit: createAuditLog(db),
    pairing: createPairingService(repositories),
    projects: createProjectService({
      roots: config.projectRoots,
      projectRepository: repositories.projects,
      sessionRepository: repositories.projects
    }),
    startup: platform.createStartupService({
      startupDir: config.launchAgentDir,
      serviceRoot,
      nodePath: process.execPath,
      startupCommand: config.startupCommand,
      config
    }),
    inputQueue: createSessionInputQueueService(repositories),
    runtimeConfig,
    mediaAssets: createMediaAssetService({
      repository: repositories.mediaAssets,
      storageDir: mediaStorageDir
    }),
    codexGeneratedImages: createCodexGeneratedImageArtifactService({
      mediaAssetRepository: repositories.mediaAssets,
      sessionAttachmentRepository: repositories.sessionAttachments,
      storageDir: mediaStorageDir
    }),
    capture: createCaptureService({
      mediaAssetRepository: repositories.mediaAssets,
      localWebSessionRepository: repositories.localWebSessions,
      storageDir: mediaStorageDir,
      captureRunner: platform.createCaptureRunner()
    }),
    localWebProxy: createLocalWebProxy({
      repository: repositories.localWebSessions
    }),
    sessions: createSessionService(repositories),
    codex: {
      runPreflight: async () => {
        return withCodexAppServerClientFromConfig(codexConnectionConfig, async (codexClient) => runCodexPreflight({
          client: codexClient,
          detectCli: () => detectCodexCli({ candidates: codexCandidates })
        }));
      },
      listModels: async () => {
        return withCodexAppServerClientFromConfig(codexConnectionConfig, async (codexClient) => {
          const response = await codexClient.request("model/list", { includeHidden: false });
          return mapCodexModelList(response);
        });
      },
      readRuntimeConfigBaseline: async () => {
        return withCodexAppServerClientFromConfig(codexConnectionConfig, async (codexClient) => {
          const models = mapCodexModelList(await codexClient.request("model/list", { includeHidden: false }));
          const configResponse = await codexClient.request("config/read", { includeLayers: false });
          return mapCodexConfigReadToRuntimeConfigInput(configResponse, models.defaultModel);
        });
      },
      readAccountUsage: async () => {
        return accountUsage.refresh();
      },
      applyAccountRateLimitsNotification: (params: Record<string, unknown>) => {
        return accountUsage.applyRateLimitsNotification(params);
      },
      createSessionRuntime: async () => {
        const connection = await createCodexAppServerConnectionFromConfig(codexConnectionConfig);
        const listModels = async () => {
          const response = await connection.client.request("model/list", { includeHidden: false });
          return mapCodexModelList(response);
        };
        const readRuntimeConfigBaseline = async () => {
          const models = await listModels();
          const configResponse = await connection.client.request("config/read", { includeLayers: false });
          return mapCodexConfigReadToRuntimeConfigInput(configResponse, models.defaultModel);
        };
        const runtimeConfigForSession = async (threadId: string) =>
          runtimeConfigForTurn(threadId, runtimeConfig, readRuntimeConfigBaseline);
        return {
          client: connection.client,
          sessions: createCodexSessionManager(connection.client, {
            runtimeConfigForSession,
            listModels,
            codexRuntimeCapabilities: { supportsPermissionsProfile: false }
          }),
          stop: connection.stop
        };
      }
    }
  };
}

export type AppContext = ReturnType<typeof createAppContext>;
