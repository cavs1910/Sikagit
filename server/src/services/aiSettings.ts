import fs from "fs";
import path from "path";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "crypto";
import { z } from "zod";

export const providers = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "groq",
  "deepseek",
  "mistral",
  "xai",
  "vercel",
] as const;
export const byokProviders = ["openai", "anthropic", "google", "groq", "deepseek", "mistral", "xai"] as const;
const schema = z.object({
  enabled: z.boolean(),
  provider: z.enum(providers),
  model: z.string().trim().max(200),
  language: z.enum(["en", "auto"]),
  conventionalCommits: z.boolean(),
  maxDiffChars: z.number().int().min(2000).max(100000),
  maxOutputTokens: z.number().int().min(256).max(8192),
  responseMode: z.enum(["structured", "json"]),
  apiKey: z.string().max(4096).optional(),
  removeKey: z.boolean().optional(),
  gatewayMode: z.enum(["managed", "byok"]).default("managed"),
  byokProvider: z.enum(byokProviders).default("openai"),
  byokApiKey: z.string().max(4096).optional(),
  removeByokKey: z.boolean().optional(),
});
const dir = process.env.DATA_DIR || "./data";
const filename = path.join(dir, "ai-settings.json");
const keyfile = path.join(dir, "ai-settings.key");
const defaults = {
  gatewayMode: "managed" as "managed" | "byok",
  byokProvider: "openai" as (typeof byokProviders)[number],
  enabled: false,
  provider: "openai" as (typeof providers)[number],
  model: "",
  language: "auto" as "en" | "auto",
  conventionalCommits: true,
  maxDiffChars: 30000,
  maxOutputTokens: 2048,
  responseMode: "structured" as "structured" | "json",
};
type Connection = Pick<typeof defaults, "model" | "gatewayMode" | "byokProvider"> & {
  secret?: string;
  byokSecret?: string;
};
type Settings = typeof defaults & { secret?: string; byokSecret?: string; connections?: Partial<Record<(typeof providers)[number], Connection>> };
function connection(s: Settings): Connection {
  return { model: s.model, gatewayMode: s.gatewayMode, byokProvider: s.byokProvider, secret: s.secret, byokSecret: s.byokSecret };
}
function read(): Settings {
  try {
    const saved = JSON.parse(fs.readFileSync(filename, "utf8"));
    // Legacy Spanish settings become project language without touching encrypted keys.
    return { ...defaults, ...saved, language: saved.language === "en" ? "en" : "auto" };
  } catch (e: any) {
    if (e.code === "ENOENT") return { ...defaults };
    throw new Error("Cannot read AI settings");
  }
}
function master(): Buffer {
  fs.mkdirSync(dir, { recursive: true });
  try {
    return fs.readFileSync(keyfile);
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
    const key = randomBytes(32);
    fs.writeFileSync(keyfile, key, { mode: 0o600, flag: "wx" });
    return key;
  }
}
function encrypt(value: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", master(), iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}
function decrypt(value: string): string {
  const b = Buffer.from(value, "base64");
  const c = createDecipheriv("aes-256-gcm", master(), b.subarray(0, 12));
  c.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString("utf8");
}
function publicConnection(c: Connection) {
  return { model: c.model, gatewayMode: c.gatewayMode, byokProvider: c.byokProvider, hasApiKey: !!c.secret, hasByokKey: !!c.byokSecret };
}
function connections(s: Settings) {
  return { ...s.connections, [s.provider]: connection(s) };
}
export function publicSettings() {
  const s = read();
  const { secret, byokSecret, connections: stored, ...settings } = s;
  return {
    ...settings,
    hasApiKey: !!secret,
    hasByokKey: !!byokSecret,
    connections: Object.fromEntries(Object.entries(connections(s)).map(([id, c]) => [id, publicConnection(c!)])),
    revision: createHash("sha256").update(JSON.stringify(s)).digest("hex"),
  };
}
function validateConnection(s: typeof defaults, secret?: string, byokSecret?: string) {
  if (!secret || !s.model) throw new Error("A model and API key are required to enable AI");
  if (s.provider === "vercel") {
    if (!/^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(s.model))
      throw new Error("Gateway models must use a provider/model ID");
    if (s.gatewayMode === "byok" && !byokSecret)
      throw new Error("A provider API key is required for Gateway BYOK");
  }
}
export function saveSettings(body: unknown) {
  if ((body as any)?.revision !== publicSettings().revision)
    throw new Error("AI settings changed on another device. Reopen settings before saving.");
  const parsed = schema.parse(body);
  const old = read();
  const saved = connections(old);
  const { apiKey, removeKey, byokApiKey, removeByokKey, ...settings } = parsed;
  const previous = saved[settings.provider];
  let secret = previous?.secret;
  let byokSecret = previous?.byokProvider === settings.byokProvider ? previous.byokSecret : undefined;
  if (removeKey) secret = undefined;
  if (apiKey?.trim()) secret = encrypt(apiKey.trim());
  if (removeByokKey) byokSecret = undefined;
  if (settings.provider === "vercel" && byokApiKey?.trim()) byokSecret = encrypt(byokApiKey.trim());
  if (settings.enabled) validateConnection(settings, secret, byokSecret);
  const next = { ...settings, secret, byokSecret };
  saved[settings.provider] = connection(next);
  const tmp = filename + ".tmp";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ ...next, connections: saved }), { mode: 0o600 });
  fs.renameSync(tmp, filename);
  return publicSettings();
}
export function configured(requireEnabled = true) {
  const s = read();
  if (requireEnabled && !s.enabled) throw new Error("Configure and enable AI in Settings → AI first");
  validateConnection(s, s.secret, s.byokSecret);
  const { secret, byokSecret, connections: stored, ...settings } = s;
  return {
    ...settings,
    apiKey: decrypt(secret!),
    byokApiKey: s.provider === "vercel" && s.gatewayMode === "byok" ? decrypt(byokSecret!) : undefined,
  };
}
