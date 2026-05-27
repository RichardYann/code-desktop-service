import { describe, expect, it } from "vitest";
import { ClientCommandSchema as WsClientCommandSchema } from "../server/wsServer.js";

type CommandOption = {
  shape: {
    type: {
      value: string;
    };
  };
};

type CommandSchema = {
  options: CommandOption[];
};

function listCommandTypes(schema: unknown): string[] {
  return (schema as CommandSchema).options
    .map((option) => option.shape.type.value)
    .sort();
}

describe("client command schema contract", () => {
  it("keeps protocol and Mac websocket command discriminators aligned", async () => {
    const protocolSchemaUrl = new URL("../../../packages/protocol/src/index.js", import.meta.url).href;
    const protocolModule = await import(protocolSchemaUrl) as {
      ClientCommandSchema: unknown;
    };
    const protocolCommands = listCommandTypes(protocolModule.ClientCommandSchema);
    const wsCommands = listCommandTypes(WsClientCommandSchema);
    const protocolOnlyCommands = protocolCommands.filter((type) => !wsCommands.includes(type));
    const wsOnlyCommands = wsCommands.filter((type) => !protocolCommands.includes(type));

    expect(protocolOnlyCommands).toEqual([
      "pairing.claim",
      "session.retryFailed",
      "session.withdrawPending"
    ]);
    // Default-disabled local test fixture, intentionally not part of the public protocol package.
    expect(wsOnlyCommands).toEqual([
      "dev.approvalFixture.show",
      "dev.codexTurnInput.probe"
    ]);
  });
});
