import Groq from 'groq-sdk';
import type { ProviderConfig } from '../../config.js';
import type { LLMProvider, NormalizedMessage, NeutralToolDef, ToolCall, TurnResponse } from '../types.js';
import { neutralToOpenAI } from '../../tools.js';

type GroqMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; content: string; tool_call_id: string };

function normalizedMessagesToGroq(messages: NormalizedMessage[]): GroqMessage[] {
  const out: GroqMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      out.push({ role: 'system', content: msg.content });
      continue;
    }
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }
    if (msg.role === 'assistant') {
      const m: GroqMessage = { role: 'assistant', content: msg.content || undefined };
      if (msg.functionCalls?.length) {
        m.tool_calls = msg.functionCalls.map((fc) => ({
          id: fc.id,
          type: 'function' as const,
          function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) },
        }));
      }
      out.push(m);
      continue;
    }
    if (msg.role === 'tool') {
      out.push({ role: 'tool', content: msg.content, tool_call_id: msg.toolCallId });
    }
  }
  return out;
}

function parseArgs(argsStr: string): Record<string, unknown> {
  try {
    const o = JSON.parse(argsStr);
    return typeof o === 'object' && o !== null ? o : {};
  } catch {
    return {};
  }
}

const PREFIX = '<function=';

/**
 * Parse Groq's malformed tool syntax in text: <function=name{...}>.
 * Uses brace-matching for nested JSON. Returns tool calls and text with those segments replaced by a space.
 */
function repairMalformedToolCalls(text: string): { calls: ToolCall[]; strippedText: string } {
  const calls: ToolCall[] = [];
  const spans: { start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf(PREFIX, i);
    if (idx === -1) break;
    const start = idx;
    i = idx + PREFIX.length;
    // Read identifier [a-zA-Z_][a-zA-Z0-9_]*
    if (i >= text.length) break;
    const first = text[i];
    if (first !== '_' && (first < 'a' || first > 'z') && (first < 'A' || first > 'Z')) break;
    let nameEnd = i + 1;
    while (nameEnd < text.length) {
      const c = text[nameEnd];
      if (c === '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
        nameEnd++;
      } else {
        break;
      }
    }
    const name = text.slice(i, nameEnd);
    i = nameEnd;
    // Skip whitespace
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length || text[i] !== '{') continue;
    const braceStart = i;
    let depth = 0;
    let j = i;
    while (j < text.length) {
      const c = text[j];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    if (j >= text.length) continue;
    const jsonStr = text.slice(braceStart, j + 1);
    i = j + 1;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i < text.length && text[i] === '>') i++;
    const end = i;
    const args = parseArgs(jsonStr);
    calls.push({
      id: `groq-repair-${calls.length}`,
      name,
      args,
    });
    spans.push({ start, end });
  }
  // Build strippedText: replace each matched span with a single space
  if (spans.length === 0) return { calls, strippedText: text };
  let strippedText = '';
  let pos = 0;
  for (const { start, end } of spans) {
    if (start > pos) {
      strippedText += text.slice(pos, start);
    }
    strippedText += ' ';
    pos = end;
  }
  if (pos < text.length) strippedText += text.slice(pos);
  return { calls, strippedText: strippedText.trim() };
}

export function createGroqAdapter(config: ProviderConfig, systemPrompt: string): LLMProvider {
  if (config.provider !== 'groq') throw new Error('createGroqAdapter requires provider groq');
  const client = new Groq({ apiKey: config.apiKey, maxRetries: 0 });

  return {
    async sendTurn(messages: NormalizedMessage[], tools?: NeutralToolDef[]): Promise<TurnResponse> {
      const groqMessages = normalizedMessagesToGroq(messages);
      const openaiTools = tools ? neutralToOpenAI(tools) : undefined;

      // Use tool_choice: "none" so the model returns only text. Llama 3.3 70B sometimes
      // outputs malformed tool syntax in content (e.g. <function=...>) which Groq rejects.
      // Fallback to Groq therefore gives text-only responses; tool use works on Gemini.
      const completion = await client.chat.completions.create({
        model: config.model as any,
        messages: groqMessages as any,
        tools: openaiTools ?? undefined,
        tool_choice: 'none',
      } as any);

      const choice = completion.choices?.[0];
      if (!choice?.message) {
        return {};
      }
      const m = choice.message;
      const out: TurnResponse = {};
      if (m.content) out.text = typeof m.content === 'string' ? m.content : (m.content as any[]).map((p: any) => p.text ?? '').join('');
      const tc = (m as any).tool_calls;
      if (tc?.length) {
        out.functionCalls = tc.map((t: any) => ({
          id: t.id ?? '',
          name: t.function?.name ?? '',
          args: parseArgs(t.function?.arguments ?? '{}'),
        })) as ToolCall[];
      }
      // Repair: when API returns only text, parse malformed <function=name{...}> and run tools
      if (out.text && (!out.functionCalls || out.functionCalls.length === 0)) {
        const { calls, strippedText } = repairMalformedToolCalls(out.text);
        if (calls.length > 0) {
          out.functionCalls = calls;
          out.text = strippedText;
        }
      }
      return out;
    },
  };
}
