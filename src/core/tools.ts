import { FunctionDeclaration, Type } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import { execa } from 'execa';
import { SafetyGuard } from '../utils/safety.js';
import chalk from 'chalk';
import { resolveProjectPath } from '../utils/path.js';

// -- Tool Definitions (Schema) --

export const toolsDef: FunctionDeclaration[] = [
  {
    name: 'list_files',
    description: 'List files in a directory. Use this to explore the project structure.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'The relative path to list (e.g., "." for root, "src/" for src).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the content of a project-local file. Use this whenever the user references PRDs/specs or other files. You may call this multiple times to follow references to other files mentioned in the content. Do not guess file contents—always call this tool instead.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'The relative path of the file to read (must be inside the project workspace, e.g., "prd.txt" or "docs/api_spec.txt").',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    description: 'Create OR overwrite/update a project-local file with the provided full content (this works even if the file already exists). Use this to implement features by writing code changes to disk.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'The relative path of the file to create or overwrite (must be inside the project workspace).',
        },
        content: {
          type: Type.STRING,
          description: 'The full content to write to the file.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a terminal command. Use this for git operations, npm installs, or running tests.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'The command to run.',
        },
      },
      required: ['command'],
    },
  },
];

// -- Tool Implementations --

export class ToolExecutor {
  private safety: SafetyGuard;

  constructor(safety: SafetyGuard) {
    this.safety = safety;
  }

  async execute(name: string, args: any): Promise<any> {
    const safeArgs = args || {};
    try {
      switch (name) {
        case 'list_files':
          return await this.listFiles(safeArgs.path);
        case 'read_file':
          return await this.readFile(safeArgs.path);
        case 'edit_file':
          return await this.editFile(safeArgs.path, safeArgs.content);
        case 'run_command':
          return await this.runCommand(safeArgs.command);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return { error: error.message };
    }
  }

  private async listFiles(dirPath: string) {
    // Default to current directory if path is missing/undefined
    const targetPath = resolveProjectPath(dirPath || '.');
    try {
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      // Filter out node_modules and .git for noise reduction
      const filtered = entries.filter(e => !['node_modules', '.git'].includes(e.name));
      
      const result = filtered.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file'
      }));
      return result;
    } catch (error: any) {
      return { error: `Failed to list directory: ${error.message}` };
    }
  }

  private async readFile(filePath: string) {
    if (!filePath) return { error: "Path is required" };
    let targetPath: string;
    try {
      targetPath = resolveProjectPath(filePath);
    } catch (error: any) {
      return { error: error.message || 'Invalid path' };
    }
    try {
      // Size-aware reading to avoid blowing up context with huge files
      const stats = await fs.stat(targetPath);
      const fileSize = stats.size;

      // 200 KB default threshold; can be made configurable via env later
      const threshold = 200 * 1024;

      const isLarge = fileSize > threshold;

      // Optionally require user confirmation for large reads or when globally enabled
      if (this.safety.shouldConfirmFileReads() || isLarge) {
        const humanSizeKb = (fileSize / 1024).toFixed(1);
        const allowed = await this.safety.confirmAction(
          'Read File',
          `${filePath} (~${humanSizeKb} KB)`
        );

        if (!allowed) {
          return { status: 'cancelled_by_user' };
        }
      }

      if (!isLarge) {
        const content = await fs.readFile(targetPath, 'utf-8');
        return { content, truncated: false, size: fileSize };
      }

      // For large files, return only the first chunk and mark as truncated
      const fileContent = await fs.readFile(targetPath, 'utf-8');
      const maxChars = 200 * 1024; // same as threshold, approximate by chars
      const preview = fileContent.slice(0, maxChars);

      return {
        content: preview,
        truncated: true,
        size: fileSize,
        returnedSize: Buffer.byteLength(preview, 'utf-8'),
        note: 'File is large; only a leading portion was returned. Summarize this content and request more specific sections if needed.',
      };
    } catch (error: any) {
      return { error: `Failed to read file: ${error.message}` };
    }
  }

  private async editFile(filePath: string, content: string) {
    if (!filePath) return { error: "Path is required" };
    let targetPath: string;
    try {
      targetPath = resolveProjectPath(filePath);
    } catch (error: any) {
      return { error: error.message || 'Invalid path' };
    }
    const isNew = !(await fileExists(targetPath));
    const actionDesc = isNew ? 'Create File' : 'Edit File';
    
    // Provide a default for content if it's undefined (though the schema requires it)
    const fileContent = content || "";

    const allowed = await this.safety.confirmAction(
      actionDesc,
      `${filePath}\nPreview first 100 chars:\n${fileContent.substring(0, 100)}...`
    );

    if (!allowed) {
      return { status: 'cancelled_by_user' };
    }

    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, fileContent, 'utf-8');
      console.log(chalk.green(`✔ Successfully wrote to ${filePath}`));
      return { status: 'success', message: `File ${filePath} written successfully.` };
    } catch (error: any) {
      return { error: `Failed to write file: ${error.message}` };
    }
  }

  private async runCommand(command: string) {
    if (!command) return { error: "Command is required" };

    if (!this.safety.validateCommand(command)) {
      return { error: 'Command blocked by safety filter.' };
    }

    const allowed = await this.safety.confirmAction(
      'Run Command',
      command
    );

    if (!allowed) {
      return { status: 'cancelled_by_user' };
    }

    try {
      console.log(chalk.gray(`> ${command}`));
      const { stdout, stderr } = await execa(command, { shell: true, reject: false });
      return { stdout, stderr, exitCode: 0 }; // We treat execution as success even if exit code is non-zero, agent handles logic
    } catch (error: any) {
      return { error: `Execution failed: ${error.message}` };
    }
  }
}

async function fileExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}