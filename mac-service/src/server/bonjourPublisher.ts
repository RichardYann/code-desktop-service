import { Bonjour, type ServiceConfig } from "bonjour-service";

export interface BonjourPublicationInput {
  name: string;
  port: number;
  macId: string;
  tlsFingerprint: string;
  tlsPublicKeyHash: string;
}

export type BonjourPublication = ServiceConfig & {
  protocol: "tcp";
  txt: {
    product: "code";
    macId: string;
    tlsFingerprint: string;
    tlsPublicKeyHash: string;
  };
};

export interface BonjourServiceHandle {
  start?: CallableFunction;
  stop?: CallableFunction;
}

export interface BonjourInstance {
  publish: (publication: BonjourPublication) => BonjourServiceHandle;
  destroy?: CallableFunction;
}

export type BonjourFactory = () => BonjourInstance;

export interface StartedBonjourPublication {
  stop: () => Promise<void>;
}

function defaultBonjourFactory(): BonjourInstance {
  return new Bonjour();
}

function callWithOptionalCallback(action: CallableFunction | undefined): Promise<void> {
  if (!action) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    action(resolve);
  });
}

export function buildBonjourPublication(input: BonjourPublicationInput): BonjourPublication {
  return {
    name: input.name,
    type: "code",
    protocol: "tcp",
    port: input.port,
    txt: {
      product: "code",
      macId: input.macId,
      tlsFingerprint: input.tlsFingerprint,
      tlsPublicKeyHash: input.tlsPublicKeyHash
    }
  };
}

export async function startBonjourPublication(
  input: BonjourPublicationInput & { factory?: BonjourFactory }
): Promise<StartedBonjourPublication> {
  const bonjour = (input.factory ?? defaultBonjourFactory)();
  const service = bonjour.publish(buildBonjourPublication(input));
  service.start?.();

  return {
    stop: async () => {
      await callWithOptionalCallback(service.stop?.bind(service));
      await callWithOptionalCallback(bonjour.destroy?.bind(bonjour));
    }
  };
}
