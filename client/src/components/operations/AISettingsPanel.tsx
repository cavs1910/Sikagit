import { AIModelPicker } from "./AIModelPicker";
import { useEffect, useState } from "react";
import { api, type AISettings } from "../../lib/api";
import { refreshAISettings } from "../../lib/aiSettings";
import { useUIStore } from "../../store/uiStore";
const providers = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["google", "Google Gemini"],
  ["openrouter", "OpenRouter · many providers"],
  ["groq", "Groq"],
  ["deepseek", "DeepSeek"],
  ["mistral", "Mistral"],
  ["xai", "xAI"],
];
const field =
  "w-full bg-bg-primary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent";
export function AISettingsPanel() {
  const [s, setS] = useState<AISettings | null>(null),
    [key, setKey] = useState(""),
    [removeKey, setRemoveKey] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [dirty, setDirty] = useState(false);
  const {
    backgroundSmartCommit,
    setBackgroundSmartCommit,
    backgroundSmartCommitPush,
    setBackgroundSmartCommitPush,
  } = useUIStore();
  useEffect(() => {
    api
      .aiSettings()
      .then(setS)
      .catch((e) => setMessage(e.message));
  }, []);
  function update(p: Partial<AISettings>) {
    setS((old) => (old ? { ...old, ...p } : old));
    setDirty(true);
    setMessage("");
  }
  async function save() {
    if (!s) return;
    setBusy(true);
    setMessage("");
    try {
      setS(
        await api.aiSaveSettings({ ...s, apiKey: key || undefined, removeKey }),
      );
      setKey("");
      setRemoveKey(false);
      setDirty(false);
      await refreshAISettings();
      setMessage("Configuration saved on the server.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMessage("Testing saved configuration…");
    try {
      await api.aiTest();
      setMessage("Connection successful. The model returned a valid response.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!s) return <p className="text-sm">{message || "Loading AI settings…"}</p>;
  return (
    <div className="space-y-5 text-xs">
      <div>
        <h3 className="text-base font-medium">AI Assistant</h3>
        <p className="text-text-muted mt-1">
          Powered by Vercel AI SDK. Configure once and use it from all your
          devices.
        </p>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={s.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        Enable AI features
      </label>
      <div className="border border-border rounded-lg p-4 space-y-4 bg-bg-primary/30">
        <label className="block space-y-1">
          <span>Provider</span>
          <select
            className={field}
            value={s.provider}
            onChange={(e) => {
              update({ provider: e.target.value, model: "", hasApiKey: false });
              setKey("");
              setRemoveKey(false);
            }}
          >
            {providers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <AIModelPicker
          provider={s.provider}
          value={s.model}
          onSelect={(model) =>
            update({
              model: model.id,
              ...(model.structuredOutput === false
                ? { responseMode: "json" as const }
                : {}),
            })
          }
          onCustom={(model) => update({ model })}
        />
        <label className="block space-y-1">
          <span>
            API key {s.hasApiKey && !removeKey ? "· saved securely" : ""}
          </span>
          <input
            type="password"
            autoComplete="new-password"
            className={field}
            value={key}
            placeholder={
              s.hasApiKey && !removeKey
                ? "Leave blank to keep the saved key"
                : "Enter your provider API key"
            }
            onChange={(e) => {
              setKey(e.target.value);
              setDirty(true);
            }}
          />
        </label>
        {s.hasApiKey && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={removeKey}
              onChange={(e) => {
                setRemoveKey(e.target.checked);
                setDirty(true);
              }}
            />
            Remove saved key
          </label>
        )}
        <p className="text-text-muted">
          Keys are encrypted on the server and never returned to the browser.
          Selected diffs are sent directly to the chosen provider when you
          request a suggestion. No Vercel account or gateway is required.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          Suggestion language
          <select
            className={field}
            value={s.language}
            onChange={(e) =>
              update({ language: e.target.value as AISettings["language"] })
            }
          >
            <option value="es">Español</option>
            <option value="en">English</option>
            <option value="auto">Match project</option>
          </select>
        </label>
        <label className="space-y-1">
          Output mode
          <select
            className={field}
            value={s.responseMode}
            onChange={(e) =>
              update({
                responseMode: e.target.value as AISettings["responseMode"],
              })
            }
          >
            <option value="structured">Structured output</option>
            <option value="json">JSON text compatibility</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={s.conventionalCommits}
          onChange={(e) => update({ conventionalCommits: e.target.checked })}
        />
        Conventional commit titles
      </label>
      <details className="space-y-2">
        <summary className="cursor-pointer text-text-secondary">
          Advanced limits
        </summary>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <label>
            Maximum diff characters
            <input
              type="number"
              className={field}
              min={2000}
              max={100000}
              value={s.maxDiffChars}
              onChange={(e) => update({ maxDiffChars: Number(e.target.value) })}
            />
          </label>
          <label>
            Maximum output tokens
            <input
              type="number"
              className={field}
              min={256}
              max={8192}
              value={s.maxOutputTokens}
              onChange={(e) =>
                update({ maxOutputTokens: Number(e.target.value) })
              }
            />
          </label>
        </div>
      </details>
      <div className="border-t border-border pt-4 space-y-3">
        <h4 className="font-medium">Commit workflow · this device</h4>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={backgroundSmartCommit}
            onChange={(e) => setBackgroundSmartCommit(e.target.checked)}
          />
          Background Smart Commit — create suggested commits without the review
          dialog
        </label>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            disabled={!backgroundSmartCommit}
            checked={backgroundSmartCommitPush}
            onChange={(e) => setBackgroundSmartCommitPush(e.target.checked)}
          />
          Also push after background commits
        </label>
        <p className="text-text-muted">
          Includes commit messages, smart grouping and save-for-later branch
          suggestions.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="px-4 py-2 rounded bg-accent-emphasis text-white disabled:opacity-40"
          disabled={busy || !dirty}
          onClick={save}
        >
          {busy ? "Working…" : "Save AI configuration"}
        </button>
        <button
          className="px-4 py-2 rounded border border-border disabled:opacity-40"
          disabled={busy || dirty || !s.hasApiKey || !s.model}
          onClick={test}
        >
          Test saved connection
        </button>
      </div>
      <p className="text-text-muted">
        Connection testing makes one small provider request and may incur a
        charge.
      </p>
      {message && (
        <p role="status" className="p-3 border border-border rounded text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
