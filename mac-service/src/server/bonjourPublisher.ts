import { Bonjour, type ServiceConfig } from "bonjour-service";

export interface BonjourPublicationInput {
  name: string;
  port: number;
  macId: string;
  tlsFingerprint: string;
  tlsPublicKeyHash: string;
  serviceUrl: string;
  candidateServiceUrls: string[];
}

export type BonjourPublication = ServiceConfig & {
  protocol: "tcp";
  txt: {
    product: "code";
    macId: string;
    tlsFingerprint: string;
    tlsPublicKeyHash: string;
    serviceUrl: string;
    candidateServiceUrls: string;
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
  update: (input: BonjourPublicationInput) => Promise<void>;
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
        tlsPublicKeyHash: input.tlsPublicKeyHash,
        serviceUrl: input.serviceUrl,
        candidateServiceUrls: input.candidateServiceUrls.join("|")
      }
    };
}

export async function startBonjourPublication(
  input: BonjourPublicationInput & { factory?: BonjourFactory }
): Promise<StartedBonjourPublication> {
  const bonjour = (input.factory ?? defaultBonjourFactory)();
  let currentInput: BonjourPublicationInput = input;
  let service: BonjourServiceHandle = publishService(bonjour, currentInput);

  return {
    update: async (nextInput: BonjourPublicationInput) => {
      if (JSON.stringify(buildBonjourPublication(nextInput)) === JSON.stringify(buildBonjourPublication(currentInput))) {
        return;
      }
      await callWithOptionalCallback(service.stop?.bind(service));
      currentInput = nextInput;
      service = publishService(bonjour, currentInput);
    },
    stop: async () => {
      await callWithOptionalCallback(service.stop?.bind(service));
      await callWithOptionalCallback(bonjour.destroy?.bind(bonjour));
    }
  };
}

function publishService(bonjour: BonjourInstance, input: BonjourPublicationInput): BonjourServiceHandle {
  const service = bonjour.publish(buildBonjourPublication(input));
  service.start?.();
  return service;
}
