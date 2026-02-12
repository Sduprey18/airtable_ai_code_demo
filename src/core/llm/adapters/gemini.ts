import {
  GoogleGenAI,
  createPartFromText,
  createPartFromFunctionCall,
  createPartFromFunctionResponse,
  type Content,
  type Part,
  type GenerateContentResponse,
} from '@google/genai';
import type { ProviderConfig } from '../../config.js';
import type { LLMProvider, NormalizedMessage, NeutralToolDef, ToolCall, TurnResponse } from '../types.js';
import { neutralToGemini } from '../../tools.js';

function parseToolResultContent(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null ? { result: parsed } : { result: parsed };
  } catch {
    return { result: content };
  }
}

function normalizedMessagesToContents(messages: NormalizedMessage[]): Content[] {
  const contents: Content[] = [];
  let pendingToolParts: Part[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      if (pendingToolParts.length > 0) {
        contents.push({ role: 'user', parts: pendingToolParts });
        pendingToolParts = [];
      }
      contents.push({ role: 'user', parts: [createPartFromText(msg.content)] });
      continue;
    }

    if (msg.role === 'assistant') {
      if (pendingToolParts.length > 0) {
        contents.push({ role: 'user', parts: pendingToolParts });
        pendingToolParts = [];
      }
      const parts: Part[] = [];
      if (msg.content) parts.push(createPartFromText(msg.content));
      if (msg.functionCalls?.length) {
        for (const fc of msg.functionCalls) {
          parts.push(createPartFromFunctionCall(fc.name, fc.args ?? {}));
        }
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }

    if (msg.role === 'tool') {
      const response = parseToolResultContent(msg.content);
      pendingToolParts.push(createPartFromFunctionResponse(msg.toolCallId, msg.name, response));
    }
  }
  if (pendingToolParts.length > 0) {
    contents.push({ role: 'user', parts: pendingToolParts });
  }
  return contents;
}

function responseToTurnResponse(response: GenerateContentResponse): TurnResponse {
  const out: TurnResponse = {};
  if (response.text) out.text = response.text;
  const fc = response.functionCalls;
  if (fc?.length) {
    out.functionCalls = fc.map((f: any) => ({
      id: f.id ?? '',
      name: f.name ?? '',
      args: f.args ?? {},
    })) as ToolCall[];
  }
  return out;
}

export function createGeminiAdapter(config: ProviderConfig, systemPrompt: string): LLMProvider {
  if (config.provider !== 'gemini') throw new Error('createGeminiAdapter requires provider gemini');
  const client = new GoogleGenAI({ apiKey: config.apiKey });

  return {
    async sendTurn(messages: NormalizedMessage[], tools?: NeutralToolDef[]): Promise<TurnResponse> {
      const contents = normalizedMessagesToContents(messages);
      const geminiTools = tools ? neutralToGemini(tools) : [];
      const configGen: any = {
        systemInstruction: systemPrompt,
      };
      if (geminiTools.length) configGen.tools = [{ functionDeclarations: geminiTools }];

      const response = await client.models.generateContent({
        model: config.model,
        contents,
        config: configGen,
      });
      return responseToTurnResponse(response);
    },
  };
}
