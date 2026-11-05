import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { AIErrorDetails } from '@sikagit/shared';

type Context = Pick<AIErrorDetails, 'provider' | 'model' | 'responseMode' | 'maxOutputTokens'>;
export type Completion = { finishReason?: string; outputTokens?: number; reasoningTokens?: number };

export class AIRequestError extends Error {
  constructor(message: string, public readonly details: AIErrorDetails) {
    super(message);
    this.name = 'AIRequestError';
  }
}

// Never forward SDK messages, response bodies, headers, generated text or Zod
// messages: they can contain credentials, diffs and filenames. Inspect locally
// and emit only fixed descriptions and a small allowlist of metadata.
export function diagnoseAIError(error: unknown, context: Context, completion: Completion = {}): AIRequestError {
  if (error instanceof AIRequestError) return error;
  const chain: any[] = [];
  for (let item: any = error; item && typeof item === 'object' && chain.length < 8 && !chain.includes(item); item = item.cause) chain.push(item);
  const status = chain.map(e => e.statusCode).find(n => Number.isInteger(n) && n >= 400 && n <= 599);
  const finish = completion.finishReason || chain.find(e => typeof e.finishReason === 'string')?.finishReason;
  const finishReason = ['stop', 'length', 'content-filter', 'tool-calls', 'error', 'other'].includes(finish) ? finish : undefined;
  const names = chain.map(e => e.name);
  const words = chain.map(e => [e.message, e.code, e.type, e.data?.error?.code, e.data?.error?.type].filter(v => typeof v === 'string').join(' ').slice(0, 16000)).join(' ');
  const failure: { code: AIErrorDetails['code']; message: string } = { code: 'unknown', message: 'The AI request failed for an unrecognized reason. Use the reference below to identify this failure.' };
  const choose = (code: AIErrorDetails['code'], message: string) => { failure.code = code; failure.message = message; };
  if (finishReason === 'length') {
    choose('output_limit', `The model reached the ${context.maxOutputTokens}-token output limit before completing the response. Increase Maximum output tokens in Settings → AI, stage fewer files, or choose another model. Reasoning may also use this budget.`);
  } else if (finishReason === 'content-filter') {
    choose('content_filter', 'The provider blocked the response with its content filter. Review the staged content or choose another model.');
  } else if (status === 401 || status === 403) {
    choose('authentication', 'Provider rejected the API key or permissions. Check the saved connection and model access in Settings → AI.');
  } else if (status === 402 || /insufficient_quota|insufficient.?credits|insufficient.?balance|quota.?exceeded|billing.?hard.?limit/i.test(words)) {
    choose('quota', 'The provider reported insufficient credits or exhausted quota. Check billing and quota for this connection.');
  } else if (status === 429) {
    choose('rate_limit', 'The provider reported a rate limit or quota limit (HTTP 429). Wait before retrying and check the provider limits.');
  } else if (status === 404) {
    choose('model_not_found', 'Provider model was not found or is unavailable to this connection. Select an available model in Settings → AI.');
  } else if (status === 408 || status === 504 || names.some(n => ['TimeoutError', 'AbortError', 'GatewayTimeoutError'].includes(n)) || /UND_ERR_(?:HEADERS|BODY|CONNECT)_TIMEOUT|ETIMEDOUT/.test(words)) {
    choose('timeout', 'The AI request timed out. Retry manually, stage fewer files, or choose a faster model.');
  } else if (status && status >= 400 && status < 500 && /context_length_exceeded|context.window|maximum context|too many (?:input )?tokens|prompt.{0,15}too long/i.test(words)) {
    choose('context_limit', 'The provider rejected the input because it exceeds the model context limit. Reduce Maximum diff characters, stage fewer files, or choose a model with a larger context.');
  } else if (status && status >= 400 && status < 500 && /response_format|json_schema|structured.?output/.test(words)) {
    choose('unsupported_output', 'The provider rejected the structured output request. Select JSON text compatibility in Settings → AI or choose a model with JSON schema support.');
  } else if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|fetch failed|certificate/i.test(words)) {
    choose('network', 'The server could not connect securely to the AI provider. Check network connectivity and retry manually.');
  } else if ((status && status >= 500) || status === 424) {
    choose('provider_unavailable', 'The gateway or provider could not complete the request. Retry manually or choose another model/provider.');
  } else if (status) {
    choose('invalid_request', 'The provider rejected the request. Check the selected model and output mode in Settings → AI.');
  } else if (chain.some(e => e.name === 'AI_NoObjectGeneratedError' && e.text === '')) {
    choose('empty_response', 'The model returned an empty response. Try another model or increase the output token budget if the model uses reasoning.');
  } else if (names.includes('SyntaxError') || names.includes('AI_JSONParseError')) {
    choose('invalid_json', 'The model returned invalid JSON. Retry manually, choose a model with JSON schema support, or use another model.');
  } else if (names.includes('ZodError') || names.includes('AI_TypeValidationError')) {
    choose('invalid_response', 'The model response did not match the required commit format. Retry manually or choose another model.');
  } else if (names.includes('AI_NoOutputGeneratedError') || names.includes('AI_NoObjectGeneratedError')) {
    choose('empty_response', 'The model did not produce a usable response. Check the output mode or choose another model.');
  }
  let { code, message } = failure;
  // Report schema locations and trusted bounds, never input values or messages.
  const issues = chain.find(e => e instanceof z.ZodError)?.issues as z.core.$ZodIssue[] | undefined;
  const issue = issues?.find(i => i.path.length > 0 && i.path.every(p => typeof p === 'number' || ['groups', 'files', 'title', 'description', 'ok', 'branchName', 'message'].includes(String(p))));
  if (code === 'invalid_response' && issue) {
    const path = issue.path.map(p => typeof p === 'number' ? `[${p}]` : p).join('.').replace(/\.\[/g, '[');
    message += ` Invalid field: ${path}.`;
    if (issue.code === 'too_big') message += ` Maximum: ${issue.maximum}.`;
    if (issue.code === 'too_small') message += ` Minimum: ${issue.minimum}.`;
  }
  const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
  const usage = chain.find(e => e.usage)?.usage;
  const details: AIErrorDetails = {
    provider: context.provider, model: context.model,
    responseMode: context.responseMode, maxOutputTokens: context.maxOutputTokens,
    code, requestId: randomUUID(), httpStatus: status, finishReason,
    outputTokens: count(completion.outputTokens ?? usage?.outputTokens),
    reasoningTokens: count(completion.reasoningTokens ?? usage?.outputTokenDetails?.reasoningTokens),
  };
  // Only allowlisted metadata; no error serialization or provider payloads.
  console.warn('[AI failure]', JSON.stringify({ ...details, model: undefined }));
  return new AIRequestError(message, details);
}
