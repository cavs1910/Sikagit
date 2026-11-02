import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { AIModelCatalog, AIModelInfo } from "@sikagit/shared";
import { providers } from "./aiSettings";
import bundled from "../catalog/ai-models.snapshot.json";

type Provider = (typeof providers)[number];
const MODELS_DEV = "https://models.dev/api.json";
const VERCEL = "https://ai-gateway.vercel.sh/v1/models";
const OPENROUTER = "https://openrouter.ai/api/v1/models";
const TTL = 6 * 60 * 60 * 1000;
const RETRY_AFTER = 60 * 1000;
const MAX_BYTES = 12 * 1024 * 1024;
const pricing: Record<Provider, string> = {
  vercel: "https://vercel.com/ai-gateway/models",
  openai: "https://openai.com/api/pricing/",
  anthropic: "https://www.anthropic.com/pricing#api",
  google: "https://ai.google.dev/gemini-api/docs/pricing",
  openrouter: "https://openrouter.ai/models",
  groq: "https://groq.com/pricing",
  deepseek: "https://api-docs.deepseek.com/quick_start/pricing",
  mistral: "https://mistral.ai/pricing",
  xai: "https://docs.x.ai/docs/models",
};
export function catalogProvider(value: unknown): Provider {
  if (typeof value !== "string" || !providers.includes(value as Provider))
    throw new Error("Unsupported AI provider");
  return value as Provider;
}
function number(value: unknown, scale = 1): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const n = Number(value) * scale;
  return Number.isFinite(n) && n >= 0 && n <= 1e12 ? n : null;
}
function text(value: unknown, max = 200): string | null {
  return typeof value === "string" &&
    !!value.trim() &&
    value.length <= max &&
    !/[\x00-\x1f\x7f]/.test(value)
    ? value.trim()
    : null;
}
function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
export function normalizeModels(provider: Provider, data: any): AIModelInfo[] {
  const gateway = provider === "vercel";
  const router = provider === "openrouter" || gateway;
  if (gateway) {
    if (!Array.isArray(data?.data)) throw new Error("Invalid model catalog");
    data = { data: data.data.filter((m: any) => m?.type === "language").map((m: any) => ({
      ...m,
      architecture: { input_modalities: m.modalities?.input, output_modalities: m.modalities?.output },
      pricing: { prompt: m.pricing?.input, completion: m.pricing?.output, input_cache_read: m.pricing?.input_cache_read },
      context_length: m.context_window,
      created: m.released ?? m.created,
    })) };
  }
  const records = router
    ? data?.data
    : Object.values(data?.[provider]?.models || {});
  if (!Array.isArray(records)) throw new Error("Invalid model catalog");
  const models = new Map<string, AIModelInfo>();
  for (const entry of records.slice(0, 5000)) {
    if (!entry || typeof entry !== "object") continue;
    const id = text(entry.id);
    if (!id || entry.status === "deprecated") continue;
    const input = router
      ? entry.architecture?.input_modalities
      : entry.modalities?.input;
    const output = router
      ? entry.architecture?.output_modalities
      : entry.modalities?.output;
    if (
      !Array.isArray(input) ||
      !input.includes("text") ||
      !Array.isArray(output) ||
      !output.includes("text")
    )
      continue;
    if (
      !router &&
      entry.type &&
      !["chat", "text", "language"].includes(entry.type)
    )
      continue;
    if (
      router &&
      Array.isArray(entry.endpoints) &&
      !entry.endpoints.includes("/api/v1/chat/completions")
    )
      continue;
    if (
      router &&
      typeof entry.expiration_date === "string" &&
      entry.expiration_date.slice(0, 10) < new Date().toISOString().slice(0, 10)
    )
      continue;
    const cost = router ? entry.pricing : entry.cost;
    const params = Array.isArray(entry.supported_parameters)
      ? entry.supported_parameters
      : null;
    const timestamp = router ? number(entry.created) : null;
    models.set(id, {
      id,
      name: text(entry.name, 300) || id,
      inputPrice: number(router ? cost?.prompt : cost?.input, router ? 1e6 : 1),
      outputPrice: number(
        router ? cost?.completion : cost?.output,
        router ? 1e6 : 1,
      ),
      cacheReadPrice: number(
        router ? cost?.input_cache_read : cost?.cache_read,
        router ? 1e6 : 1,
      ),
      contextWindow: number(
        router ? entry.context_length : entry.limit?.context,
      ),
      structuredOutput: router
        ? params
          ? params.includes("structured_outputs")
          : null
        : boolean(entry.structured_output),
      reasoning: router
        ? params
          ? params.includes("reasoning")
          : null
        : boolean(entry.reasoning),
      released: router
        ? timestamp && timestamp < 8640000000000
          ? new Date(timestamp * 1000).toISOString().slice(0, 10)
          : null
        : typeof entry.release_date === "string" &&
            /^\d{4}-\d{2}(?:-\d{2})?$/.test(entry.release_date)
          ? entry.release_date
          : null,
    });
  }
  const result = [...models.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 2000);
  if (!result.length) throw new Error("No text-generation models in catalog");
  return result;
}
function info(
  provider: Provider,
  models: AIModelInfo[],
  updatedAt: string,
  sourceType: AIModelCatalog["sourceType"],
  warning: string | null = null,
): AIModelCatalog {
  return {
    provider,
    models,
    updatedAt,
    sourceType,
    stale: Date.now() - Date.parse(updatedAt) > TTL,
    sourceName:
      provider === "vercel" ? "Vercel AI Gateway API" : provider === "openrouter"
        ? "OpenRouter API"
        : "models.dev · community catalog",
    sourceURL: provider === "vercel" ? VERCEL : provider === "openrouter" ? OPENROUTER : MODELS_DEV,
    pricingURL: pricing[provider],
    warning,
  };
}
const current = new Map<Provider, AIModelCatalog>();
const attempted = new Map<string, number>();
const pending = new Map<string, Promise<void>>();
const cachePath = path.join(
  process.env.DATA_DIR || "./data",
  "ai-model-catalog.json",
);
let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const stat = fs.statSync(cachePath);
    if (stat.size > 3 * 1024 * 1024) return;
    const saved = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    for (const provider of providers) {
      const item = saved[provider];
      if (
        !item ||
        !Array.isArray(item.models) ||
        item.models.length > 2000 ||
        !Number.isFinite(Date.parse(item.updatedAt)) ||
        Date.parse(item.updatedAt) > Date.now() + 60000
      )
        continue;
      const valid = item.models.every(
        (m: any) =>
          text(m.id) &&
          text(m.name, 300) &&
          [
            "inputPrice",
            "outputPrice",
            "cacheReadPrice",
            "contextWindow",
          ].every(
            (k) =>
              m[k] === null ||
              (typeof m[k] === "number" && number(m[k]) !== null),
          ) &&
          ["structuredOutput", "reasoning"].every(
            (k) => m[k] === null || typeof m[k] === "boolean",
          ) &&
          (m.released === null ||
            (typeof m.released === "string" &&
              /^\d{4}-\d{2}(?:-\d{2})?$/.test(m.released))),
      );
      if (valid && item.models.length)
        current.set(
          provider,
          info(provider, item.models, item.updatedAt, "cache"),
        );
    }
  } catch {
    /* Missing or invalid cache falls back to the bundled public catalog. */
  }
}
function persist() {
  let temporary: string | undefined;
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    temporary = cachePath + "." + randomUUID() + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(current)), {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temporary, cachePath);
  } catch {
    /* Public catalog cache failure must not block model selection. */
  } finally {
    if (temporary)
      try {
        fs.unlinkSync(temporary);
      } catch {}
  }
}
async function fetchCatalog(url: string) {
  const signal = AbortSignal.timeout(10000);
  const response = await fetch(url, {
    headers: { "User-Agent": "Sikagit/1.0", Accept: "application/json" },
    redirect: "error",
    signal,
  });
  if (!response.ok || !response.body) throw new Error("Catalog unavailable");
  const reader = response.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error("Catalog too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
async function update(provider: Provider) {
  const data = await fetchCatalog(
    provider === "vercel" ? VERCEL : provider === "openrouter" ? OPENROUTER : MODELS_DEV,
  );
  const updatedAt = new Date().toISOString();
  for (const id of provider === "openrouter" || provider === "vercel"
    ? [provider]
    : providers.filter((p) => p !== "openrouter" && p !== "vercel")) {
    try {
      current.set(id, info(id, normalizeModels(id, data), updatedAt, "live"));
    } catch {
      if (id === provider)
        throw new Error("Selected provider unavailable in catalog");
    }
  }
  persist();
}
export async function getModelCatalog(
  value: unknown,
  refresh = false,
): Promise<AIModelCatalog> {
  const provider = catalogProvider(value);
  load();
  const key = provider === "vercel" ? "vercel" : provider === "openrouter" ? "openrouter" : "modelsdev";
  const cached = current.get(provider);
  if (cached && Date.now() - Date.parse(cached.updatedAt) < TTL && !refresh)
    return info(provider, cached.models, cached.updatedAt, "cache");
  let warning: string | null = null;
  if (
    !pending.has(key) &&
    Date.now() - (attempted.get(key) || 0) >= RETRY_AFTER
  ) {
    attempted.set(key, Date.now());
    const task = update(provider).finally(() => pending.delete(key));
    pending.set(key, task);
  }
  const task = pending.get(key);
  if (task)
    try {
      await task;
    } catch {
      warning = "Live catalog unavailable. Showing the last known prices.";
    }
  const latest = current.get(provider);
  if (latest)
    return info(
      provider,
      latest.models,
      latest.updatedAt,
      task && !warning ? "live" : "cache",
      warning ||
        (Date.now() - Date.parse(latest.updatedAt) > TTL
          ? "Prices are cached and may be outdated."
          : null),
    );
  const snapshot = (bundled as any)[provider];
  return info(
    provider,
    snapshot?.models || [],
    snapshot?.updatedAt || new Date(0).toISOString(),
    "snapshot",
    warning || "Using the bundled catalog. Refresh to check current prices.",
  );
}
