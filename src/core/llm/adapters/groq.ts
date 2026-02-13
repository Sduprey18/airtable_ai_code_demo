import Groq from 'groq-sdk';
import type { ProviderConfig } from '../../config.js';
import type { LLMProvider, NormalizedMessage, NeutralToolDef, ToolCall, TurnResponse } from '../types.js';
import { neutralToOpenAI } from '../../tools.js';

const GROQ_TOOL_INSTRUCTION =
  'CRITICAL: Do not describe or explain that you will use tools. Do not say "I need to read the file" or "Let me call read_file". Just output the tool call. When the user mentions a file (e.g. hi.txt, prd.txt), immediately output: <function=read_file{"path":"filename"}> and nothing else for that step. When the user asks to create or write a file, output: <function=edit_file{"path":"filename.ext","content":"..."}> with real path and full content. Both formats accept optional parentheses: <function=name({"key":"value"})> is valid. No preamble or meta-commentary—only tool calls and minimal confirmation.';

type GroqMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; content: string; tool_call_id: string };

function normalizedMessagesToGroq(messages: NormalizedMessage[]): GroqMessage[] {
  const out: GroqMessage[] = [];
  let systemAppended = false;
  for (const msg of messages) {
    if (msg.role === 'system') {
      const content = systemAppended ? msg.content : msg.content + '\n\n' + GROQ_TOOL_INSTRUCTION;
      if (!systemAppended) systemAppended = true;
      out.push({ role: 'system', content });
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
 * Parse Groq's malformed tool syntax: <function=name{...}> or <function=name({...})>.
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
    // Skip whitespace and optional opening parenthesis: name{...} or name({...})
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) continue;
    if (text[i] === '(') {
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
    }
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
    if (i < text.length && text[i] === ')') {
      i++;
      while (i < text.length && /\s/.test(text[i])) i++;
    }
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

/** Language hint (from fenced block) -> default filename */
const LANGUAGE_DEFAULT_PATH: Record<string, string> = {
  c: 'hello.c',
  cpp: 'main.cpp',
  py: 'main.py',
  python: 'main.py',
  js: 'index.js',
  javascript: 'index.js',
  ts: 'index.ts',
  typescript: 'index.ts',
};

const CREATE_FILE_INTENT =
  /(?:make|create|write)\s+(?:a\s+)?(?:file|\.?\w+\.\w+)|write\s+.*\s+to\s+(?:a\s+)?file|put\s+.*\s+in\s+(?:a\s+)?file|file\s+(?:named\s+)?[\w.-]+\.\w+/i;

/** Extract first fenced code block: optional language, then content. Returns { content, lang, start, end }. */
function extractFirstCodeBlock(text: string): { content: string; lang: string; start: number; end: number } | null {
  const open = /```(\w*)\n/g;
  const match = open.exec(text);
  if (!match) return null;
  const start = match.index;
  const lang = (match[1] || '').toLowerCase();
  const afterOpen = match.index + match[0].length;
  const closeIdx = text.indexOf('```', afterOpen);
  if (closeIdx === -1) return null;
  const content = text.slice(afterOpen, closeIdx);
  const end = closeIdx + 3;
  return { content, lang, start, end };
}

/**
 * When the model replied with plain text (no tool tag), infer a single edit_file call if the user
 * asked to create/write a file and the response contains a fenced code block.
 */
function inferEditFileFromResponse(
  text: string,
  lastUserContent: string
): { call: ToolCall; strippedText: string } | null {
  const user = lastUserContent.trim().toLowerCase();
  if (!CREATE_FILE_INTENT.test(user)) return null;
  const block = extractFirstCodeBlock(text);
  if (!block || !block.content.trim()) return null;
  let path: string | undefined;
  // Prefer filename from user message: "file named X", "create X", "a file X"
  const namedMatch = lastUserContent.match(/(?:named|called)\s+([\w.-]+\.\w+)/i);
  if (namedMatch) path = namedMatch[1];
  if (!path) {
    const createMatch = lastUserContent.match(/(?:create|make|write)\s+([\w.-]+\.\w+)/i);
    if (createMatch) path = createMatch[1];
  }
  if (!path) path = LANGUAGE_DEFAULT_PATH[block.lang] ?? 'output.txt';
  const call: ToolCall = {
    id: 'groq-heuristic-0',
    name: 'edit_file',
    args: { path, content: block.content },
  };
  const before = text.slice(0, block.start).trim();
  const after = text.slice(block.end).trim();
  const strippedText = [before, "I've created the file.", after].filter(Boolean).join('\n\n').trim();
  return { call, strippedText };
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
      // Heuristic fallback: user asked to create/write a file and response has a code block
      if (out.text && (!out.functionCalls || out.functionCalls.length === 0)) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        const lastUserContent = lastUser && 'content' in lastUser ? lastUser.content : '';
        const inferred = inferEditFileFromResponse(out.text, lastUserContent);
        if (inferred) {
          out.functionCalls = [inferred.call];
          out.text = inferred.strippedText;
        }
      }
      return out;
    },
  };
}
