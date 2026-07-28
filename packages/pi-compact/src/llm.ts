import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";

export interface LlmClient {
  complete(
    model: Model<Api>,
    context: Context,
    options: SimpleStreamOptions,
  ): Promise<AssistantMessage>;
}

const runtimeClient: LlmClient = {
  async complete(model, context, options) {
    const { completeSimple } = await import("@earendil-works/pi-ai/compat");
    return completeSimple(model, context, options);
  },
};

let client: LlmClient = runtimeClient;

export function getLlmClient(): LlmClient {
  return client;
}

export function setLlmClient(value: LlmClient): void {
  client = value;
}

export function resetLlmClient(): void {
  client = runtimeClient;
}
