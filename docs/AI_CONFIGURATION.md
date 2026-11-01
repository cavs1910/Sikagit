# AI configuration

Open **Settings → AI** in SikaGit. Select a provider, enter its exact model ID and your API key, enable AI and save. **Test saved connection** sends a small request to verify credentials, the model and structured output. Testing can incur a provider charge. Saving never sends a provider request.

Supported providers: OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral and xAI. OpenRouter exposes models from many additional vendors using their catalog IDs. These are direct provider integrations through Vercel AI SDK; no Vercel account or AI Gateway is used. Model availability and charges depend on your provider account. Models must support text generation; structured output mode additionally requires JSON schema support. Select **JSON text compatibility** for models without it.

Settings are shared across devices. Choose Spanish, English or project language, conventional titles, diff size and output token limits. Background Smart Commit and automatic push remain per-device preferences and default off. Normal Smart Commit previews remain editable before execution. Commit suggestions and save-for-later suggestions are retained.

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
