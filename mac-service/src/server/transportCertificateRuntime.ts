import type { RefreshTransportCertificateResult } from "../appContext.js";

export interface RefreshableTransportContext {
  tls: {
    cert: Buffer;
    key: Buffer;
  };
  refreshTransportCertificate: () => RefreshTransportCertificateResult;
}

export interface HttpsSecureContextServer {
  setSecureContext?: (options: { cert: Buffer; key: Buffer }) => void;
}

export interface TransportCertificateRefreshInput {
  context: RefreshableTransportContext;
  server: HttpsSecureContextServer;
}

export interface TransportCertificateRefreshLoopInput extends TransportCertificateRefreshInput {
  intervalMs?: number;
  onChanged?: (result: RefreshTransportCertificateResult) => void | Promise<void>;
  onError?: (error: Error) => void;
}

export interface StartedTransportCertificateRefreshLoop {
  refreshNow: () => Promise<RefreshTransportCertificateResult>;
  stop: () => void;
}

const DEFAULT_TRANSPORT_CERTIFICATE_REFRESH_INTERVAL_MS = 5000;

export async function applyTransportCertificateRefresh(
  input: TransportCertificateRefreshInput
): Promise<RefreshTransportCertificateResult> {
  const result = input.context.refreshTransportCertificate();
  if (!result.changed) {
    return result;
  }
  if (input.server.setSecureContext === undefined) {
    throw new Error("HTTPS server does not support secure context hot reload");
  }
  input.server.setSecureContext(input.context.tls);
  return result;
}

export function startTransportCertificateRefreshLoop(
  input: TransportCertificateRefreshLoopInput
): StartedTransportCertificateRefreshLoop {
  const intervalMs = input.intervalMs ?? DEFAULT_TRANSPORT_CERTIFICATE_REFRESH_INTERVAL_MS;
  let refreshing = false;

  const refreshNow = async (): Promise<RefreshTransportCertificateResult> => {
    if (refreshing) {
      return {
        changed: false,
        previousFingerprint: "",
        nextFingerprint: "",
        previousPublicKeyHash: "",
        nextPublicKeyHash: ""
      };
    }
    refreshing = true;
    try {
      const result = await applyTransportCertificateRefresh(input);
      if (result.changed) {
        await input.onChanged?.(result);
      }
      return result;
    } catch (error) {
      input.onError?.(error instanceof Error ? error : new Error(String(error)));
      return {
        changed: false,
        previousFingerprint: "",
        nextFingerprint: "",
        previousPublicKeyHash: "",
        nextPublicKeyHash: ""
      };
    } finally {
      refreshing = false;
    }
  };

  const timer = setInterval(() => {
    void refreshNow();
  }, intervalMs);
  timer.unref?.();

  return {
    refreshNow,
    stop: () => {
      clearInterval(timer);
    }
  };
}
