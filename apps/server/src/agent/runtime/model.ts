import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getConfiguredModel, streamWithCredentials } from "@/utils/ai";
import conf from "@/utils/conf";

export async function createAgentModel(providerId: string, modelId: string, thinkingLevel = "off") {
  const configured = getConfiguredModel(providerId, modelId);
  const preferences = conf.get("settings", {}).agentPreferences as { textProtocol?: string } | undefined;
  const protocol = preferences?.textProtocol;
  const provider = { ...configured.provider };
  if (provider.protocol !== "anthropic-messages" && (protocol === "openai-completions" || protocol === "openai-responses")) provider.protocol = protocol;
  const { model, baseUrl } = configured;
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider(providerId, {
    api: provider.protocol,
    baseUrl,
    streamSimple: (model, context, options) => streamWithCredentials(provider, model, context, options),
    models: [{
      id: model.id, name: model.label, reasoning: thinkingLevel !== "off",
      // ACT: 保留图片输入，由实际供应方判断该模型是否支持。
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.contextWindow, maxTokens: model.maxOutputTokens,
    }],
  });
  await runtime.setRuntimeApiKey(providerId, provider.apiKey);
  return { ...configured, provider, runtime };
}
