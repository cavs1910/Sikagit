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
] as const;
const schema = z.object({
  enabled: z.boolean(),
  provider: z.enum(providers),
  model: z.string().trim().max(200),
  language: z.enum(["en", "es", "auto"]),
  conventionalCommits: z.boolean(),
  maxDiffChars: z.number().int().min(2000).max(100000),
  maxOutputTokens: z.number().int().min(256).max(8192),
  responseMode: z.enum(["structured", "json"]),
  apiKey: z.string().max(4096).optional(),
  removeKey: z.boolean().optional(),
});
const dir = process.env.DATA_DIR || "./data";
const filename = path.join(dir, "ai-settings.json");
const keyfile = path.join(dir, "ai-settings.key");
const defaults = {
  enabled: false,
  provider: "openai" as (typeof providers)[number],
  model: "",
  language: "es" as "en" | "es" | "auto",
  conventionalCommits: true,
  maxDiffChars: 30000,
  maxOutputTokens: 2048,
  responseMode: "structured" as "structured" | "json",
};
type Settings = typeof defaults & { secret?: string };
function read(): Settings {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
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
export function publicSettings() {
  const { secret, ...settings } = read();
  return {
    ...settings,
    hasApiKey: !!secret,
    revision: createHash("sha256").update(JSON.stringify(read())).digest("hex"),
  };
}
export function saveSettings(body: unknown) {
  if ((body as any)?.revision !== publicSettings().revision)
    throw new Error(
      "AI settings changed on another device. Reopen settings before saving.",
    );
  const parsed = schema.parse(body);
  const old = read();
  const { apiKey, removeKey, ...settings } = parsed;
  let secret = old.secret;
  if (removeKey || settings.provider !== old.provider) secret = undefined;
  if (apiKey?.trim()) secret = encrypt(apiKey.trim());
  if (settings.enabled && (!secret || !settings.model))
    throw new Error("A model and API key are required to enable AI");
  const tmp = filename + ".tmp";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ ...settings, secret }), {
    mode: 0o600,
  });
  fs.renameSync(tmp, filename);
  return publicSettings();
}
export function configured(requireEnabled = true) {
  const s = read();
  if ((requireEnabled && !s.enabled) || !s.secret || !s.model)
    throw new Error("Configure and enable AI in Settings → AI first");
  const { secret, ...settings } = s;
  return { ...settings, apiKey: decrypt(secret) };
}
