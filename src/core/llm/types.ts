/**
 * Provider-agnostic LLM types for the fallback cascade.
 */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type NormalizedMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; functionCalls?: ToolCall[] }
  | { role: 'system'; content: string }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface TurnResponse {
  text?: string;
  functionCalls?: ToolCall[];
}

/**
 * Neutral tool definition (JSON schema-like) for conversion to provider-specific formats.
 */
export interface NeutralToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/**
 * Each adapter implements this interface. Router calls sendTurn with full message history.
 */
export interface LLMProvider {
  sendTurn(messages: NormalizedMessage[], tools?: NeutralToolDef[]): Promise<TurnResponse>;
}
