/**
 * Fallback cascade config: ordered model list and provider keys.
 * Used by CLI for startup validation and by the router for cascade execution.
 */

export type ProviderKind = 'gemini' | 'groq';

export interface ProviderConfig {
  provider: ProviderKind;
  model: string;
  apiKey: string;
}

const DEFAULT_GEMINI_MODEL = 'gemini-exp-1206';
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

/**
 * Parse FALLBACK_MODELS env (comma-separated). Entries can be:
 * - "gemini-exp-1206" or "gemini/..." -> gemini
 * - "groq/llama-3.3-70b-versatile" or "llama-..." with groq key -> groq
 * Default: [gemini, groq].
 */
function parseModelList(): Array<{ provider: ProviderKind; model: string }> {
  const raw = process.env.FALLBACK_MODELS?.trim();
  if (!raw) {
    return [
      { provider: 'gemini', model: DEFAULT_GEMINI_MODEL },
      { provider: 'groq', model: DEFAULT_GROQ_MODEL },
    ];
  }
  const entries: Array<{ provider: ProviderKind; model: string }> = [];
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.startsWith('groq/')) {
      entries.push({ provider: 'groq', model: part.slice(5) });
    } else if (part.startsWith('gemini') || part.includes('gemini')) {
      entries.push({ provider: 'gemini', model: part });
    } else {
      // Assume groq if it looks like a model name (e.g. llama-3.3-70b-versatile)
      entries.push({ provider: 'groq', model: part });
    }
  }
  if (entries.length === 0) {
    return [
      { provider: 'gemini', model: DEFAULT_GEMINI_MODEL },
      { provider: 'groq', model: DEFAULT_GROQ_MODEL },
    ];
  }
  return entries;
}

/**
 * Build ordered list of provider configs with API keys.
 * Entries without a key are skipped (caller can warn or fail).
 */
export function getFallbackConfig(): ProviderConfig[] {
  const list = parseModelList();
  const configs: ProviderConfig[] = [];
  const apiKey = process.env.API_KEY?.trim();
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  for (const { provider, model } of list) {
    if (provider === 'gemini' && apiKey) {
      configs.push({ provider: 'gemini', model, apiKey });
    } else if (provider === 'groq' && groqApiKey) {
      configs.push({ provider: 'groq', model, apiKey: groqApiKey });
    }
  }
  return configs;
}

/**
 * Which providers are in the configured model list (before filtering by key).
 * Used by CLI to validate required keys.
 */
export function getRequiredProviders(): ProviderKind[] {
  const list = parseModelList();
  return [...new Set(list.map((e) => e.provider))];
}

export function requiresGemini(): boolean {
  return getRequiredProviders().includes('gemini');
}

export function requiresGroq(): boolean {
  return getRequiredProviders().includes('groq');
}
