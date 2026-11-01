# AI configuration

Open **Settings → AI** in SikaGit. Select a provider, search the model catalog, compare its input/output prices, choose a model, enter your API key, enable AI and save. **Test saved connection** sends a small request to verify credentials, the model and structured output. Testing can incur a provider charge. Saving never sends a provider request.

Supported providers: OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral and xAI. OpenRouter exposes models from many additional vendors using their catalog IDs. These are direct provider integrations through Vercel AI SDK; no Vercel account or AI Gateway is used. Model availability and charges depend on your provider account. Models must support text generation; structured output mode additionally requires JSON schema support. Select **JSON text compatibility** for models without it.

Settings are shared across devices. Choose English or Match project (the default), conventional titles, diff size and output token limits. Background Smart Commit and automatic push remain per-device preferences and default off. Normal Smart Commit previews remain editable before execution. Commit suggestions and save-for-later suggestions are retained.

## Secrets and privacy

API keys are encrypted using AES-256-GCM in `$DATA_DIR/ai-settings.json`. The random encryption key is `$DATA_DIR/ai-settings.key`; both files use mode `0600`. Back up **both files** if you want to preserve access. They belong to the private data volume, not the repository or image. Encryption protects accidental disclosure of the settings file alone; anyone who controls the server or reads both files can decrypt the key. All authenticated users of this single-owner instance can replace or remove AI configuration.

The HTTP API returns only a `hasApiKey` flag, never the saved API key. Entering a new key replaces the old one; leaving the field blank preserves it. Changing providers clears the previous provider's key. Disabling AI preserves the key; disable AI and select **Remove saved key** to delete it. Provider responses and diffs are not logged. SDK telemetry is not enabled. Old Gemini keys in browser localStorage are removed by the v4 UI migration and are not silently uploaded; enter a key again using the new settings page.

Suggestions send the relevant diff and filenames to the selected provider. Save-for-later sends only selected files. Diffs are truncated at the configured character limit, which can reduce suggestion quality for large changes. No external requests occur before configuration and explicit AI use. Background mode requests AI only when Smart Commit is clicked. Fixed provider HTTPS endpoints and redirect refusal prevent using this integration as an arbitrary URL fetcher. Credentials from request bodies cannot override saved provider settings.

Requests time out after 60 seconds, have no automatic retries and allow at most three simultaneous generations per server. These limits do not replace provider spending limits. Provider errors are sanitized before returning to the client.

## Smart Commit integrity

Previews are bound to the repository, HEAD and an exact index tree; they expire after 15 minutes and can be executed once. Groups must contain every staged path exactly once. Changed HEAD or index requires a new preview. Execution restores each group's blobs from the saved index tree instead of staging working files, preserving partially staged content. If a later group fails, earlier commits remain and remaining changes are restored to the index; the error reports the number of completed commits. Review history before retrying. Repository operations share SikaGit's lock, but external Git processes are outside that lock.

## Validation

`tests/security.test.cjs` runs without external networking in the production image. An isolated test-only fetch mock exercises real Vercel AI SDK request/response parsing, configuration encryption, key replacement boundaries, sanitized errors, structured output, JSON compatibility, shelving, stale previews, invalid group paths, single-use plans and partial staging. The mock is not loaded or copied into the production application. Live provider calls require the owner's own credentials and are tested with the UI button.

### Deployment verification (2026-11-01)

The production image builds successfully. The expanded isolated suite passes 26 cases. A production-only npm audit and a Trivy image scan report zero known vulnerabilities; the image secret scan reports zero findings. Browser verification confirms all eight providers, an empty secret input, the settings controls and no JavaScript runtime errors. No paid live provider call was made.

The frontend's strict TypeScript check reports the same 35 diagnostics as the previous commit (confirmed using a separate baseline checkout); these pre-existing issues are unrelated to this feature. The backend TypeScript build and Vite production build pass.

## Model catalog and prices

The model picker replaces the generic model-ID field. Search by display name or ID; sort by release date, input price, output price or name; filter for free models. Each row shows separate **input** and **output** rates in **USD per one million tokens**. Selecting a model shows context size, cached-input pricing when known, source and retrieval time. Missing or invalid rates are displayed as **Unavailable**, never as zero. **Free** means both listed input and output prices are explicitly zero. No per-commit cost estimate is presented because token counts and billing details vary.

OpenRouter uses its own public [models API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties); its per-token prices are converted to per-million-token units. The seven direct providers use the community-maintained [models.dev catalog](https://github.com/anomalyco/models.dev). These are provider-specific rates; direct-provider prices are not borrowed from an OpenRouter listing. The UI links to both the data source and the provider's own pricing page. The models.dev MIT attribution is in `docs/third-party/models.dev.LICENSE`.

Only text-input/text-output generation models are listed. Explicitly deprecated models, image/audio-only models and OpenRouter entries that exclude chat completions are filtered out. Catalog entries are not an account-specific availability check: use **Test saved connection** to verify the selected model and your key. Selecting a model explicitly marked as lacking structured output switches to JSON text compatibility. The advanced custom-ID field remains available for private models or IDs not yet in the catalog. Existing saved IDs are never silently replaced if they disappear from the list; their price is shown as unavailable.

Catalog requests do not use or transmit the user's API key, repository data or diffs, and do not make text-generation calls. Only the two fixed public HTTPS catalog endpoints are contacted, with redirects refused, a ten-second timeout and a 12 MiB response limit. Retrieval timestamps show when the dataset was fetched, not a provider guarantee of the price's effective date.

The public catalog is cached in memory and `$DATA_DIR/ai-model-catalog.json`. A cached response is reused for six hours; the next request then refreshes it. **Refresh prices** requests an earlier refresh, with at most one attempt per source per minute and shared in-flight requests. If a source fails, the last valid cache or a bundled catalog remains available with a warning and its original timestamp. The bundled snapshot is approximately 104 KiB and covers all eight providers. It is data only, with no additional package or background service.

Displayed rates are baseline text-token prices. Long-context tiers, caching, reasoning, routing, free-tier limits, discounts, taxes and provider policy can affect actual charges. Verify the provider pricing link before relying on a rate.

Catalog validation on 2026-11-01: all 35 production-image regression cases and nine browser checks pass. Tests cover price-unit conversion, free versus unknown rates, text/retired-model filtering, authenticated access, fixed provider selection, offline fallback, persisted cache, refresh recovery/throttling, absence of API-key transmission, UI search/sorting/selection and saved model IDs. Backend and Vite builds pass; the frontend retains the same 35 pre-existing TypeScript diagnostics.

Suggestion language supports **English** and **Match project** only. New installations default to Match project; legacy Spanish or missing language settings normalize to Match project without changing saved credentials. Existing English preferences are preserved.
