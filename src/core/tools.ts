import { FunctionDeclaration, Type } from '@google/genai';
import fs from 'fs/promises';
import path from 'path';
import { execa } from 'execa';
import { SafetyGuard } from '../utils/safety.js';
import chalk from 'chalk';

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
    description: 'Read the content of a file.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'The relative path of the file to read.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'edit_file',
    description: 'Create or update a file with new content.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'The relative path of the file to edit or create.',
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
    const targetPath = path.resolve(process.cwd(), dirPath || '.');
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
    const targetPath = path.resolve(process.cwd(), filePath);
    try {
      const content = await fs.readFile(targetPath, 'utf-8');
      return { content };
    } catch (error: any) {
      return { error: `Failed to read file: ${error.message}` };
    }
  }

  private async editFile(filePath: string, content: string) {
    if (!filePath) return { error: "Path is required" };
    const targetPath = path.resolve(process.cwd(), filePath);
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