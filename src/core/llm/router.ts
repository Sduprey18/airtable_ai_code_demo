import chalk from 'chalk';
import type { ProviderConfig } from '../config.js';
import type { LLMProvider, NormalizedMessage, NeutralToolDef, TurnResponse } from './types.js';

function isRetryableError(error: any): boolean {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  const code = error?.code;
  const msg = String(error?.message ?? '');
  if (status === 429 || status === 500 || status === 503) return true;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') return true;
  if (msg.includes('429') || msg.includes('500') || msg.includes('503') || msg.includes('rate limit')) return true;
  return false;
}

function failureReason(error: any): string {
  const status = error?.status ?? error?.statusCode ?? error?.response?.status;
  if (status === 429) return 'Rate Limited';
  if (status === 500) return 'Server Error (500)';
  if (status === 503) return 'Service Unavailable (503)';
  const code = error?.code;
  if (code === 'ETIMEDOUT') return 'Timeout';
  return error?.message?.slice(0, 60) ?? 'Unknown error';
}

export interface RouterConfig {
  providerConfigs: ProviderConfig[];
  createAdapter: (config: ProviderConfig) => LLMProvider;
  systemPrompt: string;
}

/**
 * Sequential fallback router: tries each provider in order; on retryable failure, logs and tries next.
 * Remembers the last successful provider for the session so tool results go to the same model.
 */
export class Router {
  private providerConfigs: ProviderConfig[];
  private createAdapter: (config: ProviderConfig) => LLMProvider;
  private systemPrompt: string;
  private currentIndex: number = 0;

  constructor(config: RouterConfig) {
    this.providerConfigs = config.providerConfigs;
    this.createAdapter = config.createAdapter;
    this.systemPrompt = config.systemPrompt;
  }

  private buildMessagesWithSystem(messages: NormalizedMessage[]): NormalizedMessage[] {
    const hasSystem = messages.some((m) => m.role === 'system');
    if (hasSystem) return messages;
    return [{ role: 'system', content: this.systemPrompt }, ...messages];
  }

  async sendMessage(messages: NormalizedMessage[], tools?: NeutralToolDef[]): Promise<TurnResponse> {
    const full = this.buildMessagesWithSystem(messages);
    return this.sendTurn(full, tools);
  }

  async sendToolResults(messages: NormalizedMessage[], tools?: NeutralToolDef[]): Promise<TurnResponse> {
    const full = this.buildMessagesWithSystem(messages);
    return this.sendTurn(full, tools);
  }

  private async sendTurn(messages: NormalizedMessage[], tools?: NeutralToolDef[]): Promise<TurnResponse> {
    let lastError: any;
    const startIndex = this.currentIndex;
    for (let i = 0; i < this.providerConfigs.length; i++) {
      const idx = (startIndex + i) % this.providerConfigs.length;
      const config = this.providerConfigs[idx];
      const adapter = this.createAdapter(config);
      const label = config.provider === 'gemini' ? 'Gemini' : 'Groq';
      try {
        const out = await adapter.sendTurn(messages, tools);
        this.currentIndex = idx;
        return out;
      } catch (error: any) {
        lastError = error;
        if (isRetryableError(error) && this.providerConfigs.length > 1) {
          const reason = failureReason(error);
          const nextLabel = this.providerConfigs[(idx + 1) % this.providerConfigs.length].provider === 'gemini' ? 'Gemini' : 'Groq';
          console.error(chalk.yellow(`[Primary Model Failed: ${reason}. Trying ${nextLabel}...]`));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }
}
