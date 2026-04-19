import agentHarnessRetrofutureRuNativeConfig from "./agent-harness-retrofuture-ru.config.mjs";

const CONFIGS = {
  "agent-harness-retrofuture-ru": agentHarnessRetrofutureRuNativeConfig,
};

export function resolveDeckNativeConfig(slug) {
  const key = String(slug ?? "").trim();
  return CONFIGS[key] ?? {};
}
