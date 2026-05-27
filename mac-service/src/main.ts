import { createAppContext } from "./appContext.js";
import { loadConfig } from "./config.js";
import { startBonjourPublication, type StartedBonjourPublication } from "./server/bonjourPublisher.js";
import { createServer } from "./server/httpServer.js";
import { formatAddressInUseMessage, isAddressInUseError } from "./server/serviceStatus.js";

const config = loadConfig();
const context = createAppContext(config);
const server = await createServer(context);
let bonjourPublication: StartedBonjourPublication | undefined;
let shuttingDown = false;

function boundPort(): number {
  const address = server.server.address();
  if (address && typeof address === "object") {
    return address.port;
  }
  return config.port;
}

async function shutdown(exitCode = 0): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  process.exitCode = exitCode;
  await bonjourPublication?.stop();
  await server.close();
}

process.once("SIGINT", () => {
  void shutdown(0);
});
process.once("SIGTERM", () => {
  void shutdown(0);
});

try {
  await server.listen({ host: config.host, port: config.port });
  bonjourPublication = await startBonjourPublication({
    name: context.localMacName,
    port: boundPort(),
    macId: "local-mac",
    tlsFingerprint: context.transport.fingerprint,
    tlsPublicKeyHash: context.transport.publicKeyHash
  });
} catch (error) {
  if (isAddressInUseError(error)) {
    console.error(formatAddressInUseMessage({ host: config.host, port: config.port }));
    await shutdown(1);
    process.exitCode = 1;
  } else {
    await shutdown(1);
    throw error;
  }
}
