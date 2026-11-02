import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, Check, ExternalLink, Loader2 } from "lucide-react";
import type { AIModelCatalog, AIModelInfo } from "@sikagit/shared";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";
function price(value: number | null) {
  if (value === null) return "Unavailable";
  if (value === 0) return "$0";
  if (value < 0.000001) return "<$0.000001";
  return (
    "$" +
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value)
  );
}
function context(value: number | null) {
  return value
    ? new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value) + " tokens"
    : "Not listed";
}
export function AIModelPicker({
  provider,
  value,
  onSelect,
  onCustom,
}: {
  provider: string;
  value: string;
  onSelect: (model: AIModelInfo) => void;
  onCustom: (id: string) => void;
}) {
  const [catalog, setCatalog] = useState<AIModelCatalog | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("recent"),
    [freeOnly, setFreeOnly] = useState(false),
    [structuredOnly, setStructuredOnly] = useState(true),
    [shown, setShown] = useState(80),
    [refresh, setRefresh] = useState(0);
  const request = useRef(0);
  useEffect(() => {
    setQuery("");
    setFreeOnly(false);
    setShown(80);
    setCatalog(null);
  }, [provider]);
  useEffect(() => {
    const sequence = ++request.current;
    setLoading(true);
    setError("");
    api
      .aiModels(provider, refresh > 0)
      .then((data) => {
        if (sequence === request.current) setCatalog(data);
      })
      .catch((e) => {
        if (sequence === request.current) setError(e.message);
      })
      .finally(() => {
        if (sequence === request.current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [provider, refresh]);
  const selected =
    catalog?.provider === provider
      ? catalog.models.find((model) => model.id === value)
      : undefined;
  const matches = useMemo(() => {
    if (catalog?.provider !== provider) return [];
    return catalog.models
      .filter(
        (model) =>
          (!query ||
            [model.id, model.name].some((text) =>
              text.toLowerCase().includes(query.toLowerCase()),
            )) &&
          (!freeOnly || (model.inputPrice === 0 && model.outputPrice === 0)) &&
          (!structuredOnly || model.structuredOutput === true),
      )
      .sort((a, b) =>
        sort === "input"
          ? (a.inputPrice ?? Infinity) - (b.inputPrice ?? Infinity) ||
            a.name.localeCompare(b.name)
          : sort === "output"
            ? (a.outputPrice ?? Infinity) - (b.outputPrice ?? Infinity) ||
              a.name.localeCompare(b.name)
            : sort === "name"
              ? a.name.localeCompare(b.name)
              : (b.released || "").localeCompare(a.released || "") ||
                a.name.localeCompare(b.name),
      );
  }, [catalog, provider, query, sort, freeOnly, structuredOnly]);
  return (
    <div className="space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">Choose a model</span>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setRefresh((n) => n + 1);
            setShown(80);
          }}
          className="flex items-center gap-1 text-text-muted hover:text-accent disabled:opacity-40"
          title="Refresh model catalog"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh prices
        </button>
      </div>
      <div className="border border-border rounded-lg overflow-hidden bg-bg-primary">
        <div className="flex flex-wrap gap-2 p-2 border-b border-border">
          <label className="flex items-center gap-2 flex-1 min-w-[130px] px-2 py-1 border border-border rounded">
            <Search size={13} className="text-text-muted shrink-0" />
            <input
              aria-label="Search models"
              placeholder="Search name or model ID…"
              value={query}
              maxLength={200}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(80);
              }}
              className="w-full min-w-0 bg-transparent text-xs outline-none"
            />
          </label>
          <select
            aria-label="Sort models"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setShown(80);
            }}
            className="bg-bg-secondary border border-border rounded px-2 py-1 text-xs"
          >
            <option value="recent">Newest first</option>
            <option value="input">Lowest input price</option>
            <option value="output">Lowest output price</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[0.65rem] text-text-muted">
          <span>
            {loading ? "Loading models…" : matches.length + " models"} · USD /
            1M tokens
          </span>
          <label className="flex items-center gap-1.5" title="Show models with declared JSON schema support. Disable to include JSON compatibility and unverified models.">
            <input
              type="checkbox"
              checked={structuredOnly}
              onChange={(e) => {
                setStructuredOnly(e.target.checked);
                setShown(80);
              }}
            />
            JSON schema support
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={freeOnly}
              onChange={(e) => {
                setFreeOnly(e.target.checked);
                setShown(80);
              }}
            />
            Free only
          </label>
        </div>
        {structuredOnly && <p className="px-3 pb-2 text-[0.65rem] text-text-muted">
          Models with declared structured output support. Disable the filter to include JSON compatibility and unverified models.
        </p>}
        <div className="grid grid-cols-[minmax(0,1fr)_75px_75px] gap-2 px-3 py-1.5 border-y border-border text-[0.65rem] text-text-muted">
          <span>Model</span>
          <span className="text-right">Input / 1M</span>
          <span className="text-right">Output / 1M</span>
        </div>
        <div className="max-h-60 overflow-auto" aria-label="Available models">
          {loading && (
            <div className="flex items-center gap-2 p-4 text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              Loading public catalog…
            </div>
          )}
          {!loading && error && (
            <p role="alert" className="p-3 text-danger">
              {error}
            </p>
          )}
          {!loading && !error && !matches.length && (
            <p className="p-4 text-text-muted">
              No models match these filters.
            </p>
          )}
          {!loading &&
            !error &&
            matches.slice(0, shown).map((model) => (
              <button
                type="button"
                key={model.id}
                data-model-id={model.id}
                aria-label={"Select " + model.name}
                aria-pressed={value === model.id}
                onClick={() => onSelect(model)}
                className={cn(
                  "w-full grid grid-cols-[minmax(0,1fr)_75px_75px] gap-2 px-3 py-2.5 text-left border-b border-border/50 hover:bg-bg-tertiary",
                  value === model.id && "bg-accent/10",
                )}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {value === model.id && (
                      <Check size={12} className="text-accent shrink-0" />
                    )}
                    <span className="truncate">{model.name}</span>
                    {model.inputPrice === 0 && model.outputPrice === 0 && (
                      <span className="text-[0.6rem] text-success shrink-0">
                        FREE
                      </span>
                    )}
                  </span>
                  <span
                    className="block truncate text-[0.6rem] font-mono text-text-muted"
                    title={model.id}
                  >
                    {model.id}
                  </span>
                </span>
                <span className="text-right self-center text-[0.7rem] tabular-nums">
                  {price(model.inputPrice)}
                </span>
                <span className="text-right self-center text-[0.7rem] tabular-nums">
                  {price(model.outputPrice)}
                </span>
              </button>
            ))}
          {!loading && matches.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + 80)}
              className="w-full py-2 text-accent"
            >
              Show more ({matches.length - shown} remaining)
            </button>
          )}
        </div>
      </div>
      {value && (
        <div
          className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-2"
          aria-label="Selected model pricing"
        >
          <div className="flex items-center gap-2">
            <Check size={14} className="text-accent shrink-0" />
            <strong className="text-sm break-words min-w-0">
              {selected?.name || value}
            </strong>
          </div>
          <p className="text-[0.65rem] font-mono text-text-muted break-all">
            {value}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <span>
              Input: <strong>{price(selected?.inputPrice ?? null)}</strong>
            </span>
            <span>
              Output: <strong>{price(selected?.outputPrice ?? null)}</strong>
            </span>
            <span className="text-text-muted">USD / 1M tokens</span>
          </div>
          <p className="text-text-muted">
            Context: {context(selected?.contextWindow ?? null)}
            {selected?.cacheReadPrice !== null &&
            selected?.cacheReadPrice !== undefined
              ? " · Cached input: " + price(selected.cacheReadPrice) + " / 1M"
              : ""}
          </p>
          {structuredOnly && selected && selected.structuredOutput !== true && (
            <p className="text-warning">Your selected model is hidden by this filter and remains selected.</p>
          )}
          {selected?.structuredOutput === false && (
            <p className="text-warning">
              This catalog does not list JSON schema support. JSON text
              compatibility will be used when selecting it.
            </p>
          )}
          {!loading && !selected && (
            <p className="text-warning">
              This ID is not in the current catalog. Its price and availability
              are unknown; your saved selection is preserved.
            </p>
          )}
        </div>
      )}
      {catalog?.provider === provider && (
        <div className="space-y-1 text-[0.65rem] text-text-muted">
          <p>
            Source:{" "}
            <a
              href={catalog.sourceURL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >
              {catalog.sourceName}
            </a>{" "}
            · Retrieved {new Date(catalog.updatedAt).toLocaleString()} ·{" "}
            {catalog.sourceType === "snapshot"
              ? "bundled fallback"
              : catalog.sourceType === "cache"
                ? "cached"
                : "live"}
            {catalog.stale ? " · outdated" : ""}
          </p>
          {catalog.warning && (
            <p role="status" className="text-warning">
              {catalog.warning}
            </p>
          )}
          <p>
            Base text rates; long context, caching, reasoning, routing and
            account discounts can change the final charge. Catalog presence does
            not guarantee access with your API key.
          </p>
          <a
            href={catalog.pricingURL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent"
          >
            Verify provider pricing
            <ExternalLink size={10} />
          </a>
        </div>
      )}
      <details className="text-text-muted">
        <summary className="cursor-pointer">
          Advanced: custom or private model ID
        </summary>
        <label className="block mt-2 space-y-1">
          <span>Manual ID (pricing may be unavailable)</span>
          <input
            aria-label="Custom model ID"
            value={value}
            maxLength={200}
            onChange={(e) => onCustom(e.target.value)}
            placeholder="Exact provider model ID"
            className="w-full min-w-0 bg-bg-primary border border-border rounded px-3 py-2 font-mono text-xs text-text-primary"
          />
        </label>
      </details>
    </div>
  );
}
