import { z } from 'zod';

// -- File System Types --
export interface VirtualFile {
  name: string;
  content: string;
  path: string;
  lastModified: number;
}

export interface VirtualDirectory {
  name: string;
  path: string;
  children: (VirtualFile | VirtualDirectory)[];
}

// -- Tool Definitions --
export enum ToolName {
  ListFiles = 'list_files',
  ReadFile = 'read_file',
  EditFile = 'edit_file',
  RunCommand = 'run_command',
  AskUser = 'ask_user'
}

export const ListFilesSchema = z.object({
  path: z.string().describe("The directory path to list")
});

export const ReadFileSchema = z.object({
  path: z.string().describe("The path of the file to read")
});

export const EditFileSchema = z.object({
  path: z.string().describe("The path of the file to edit"),
  content: z.string().describe("The new full content of the file"),
  description: z.string().optional().describe("Description of the change")
});

export const RunCommandSchema = z.object({
  command: z.string().describe("The terminal command to run"),
  args: z.array(z.string()).optional().describe("Arguments for the command")
});

// -- Agent Types --
export interface AgentMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  text?: string;
  toolCalls?: ToolCall[];
  toolResponses?: ToolResponse[];
  timestamp: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ToolResponse {
  id: string; // Matches ToolCall id
  name: string;
  result: any;
  error?: string;
}

export interface AgentConfig {
  modelName: string;
  safetyMode: 'strict' | 'lenient';
  autoApprove: boolean;
}