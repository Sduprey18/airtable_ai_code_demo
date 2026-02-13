import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { SafetyGuard } from '../utils/safety.js';
import { neutralToolsDef, ToolExecutor } from './tools.js';
import type { Router } from './llm/router.js';
import type { NormalizedMessage, ToolCall } from './llm/types.js';

export const SYSTEM_PROMPT = [
  'You are a senior software engineer.',
  'You have access to tools to read files, edit files (create/update), list directories, and run terminal commands.',
  'TOOL-FIRST RULE: If the user mentions a file path or filename (e.g., prd.txt, test.txt, api_spec.txt, README.md), immediately call read_file to inspect it before responding with advice or questions. Do not guess file contents.',
  'If read_file fails because the file path is wrong/unknown, call list_files to discover the correct path and then retry read_file.',
  'If a PRD or spec file you read refers to other files, recursively call read_file on those referenced files as needed.',
  "Interpret phrases like 'build it', 'create this', or 'implement this' (when referring to a PRD/spec/file) as: implement the described requirements in the repository by editing/creating files with edit_file, and optionally running safe commands with run_command.",
  'Be mindful of context size: summarize long documents, avoid re-reading the same file unnecessarily, and prefer reading only what you need.',
  'Be concise.',
].join(' ');

export interface AgentConfig {
  router: Router;
  verbose?: boolean;
}

export class Agent {
  private router: Router;
  private verbose: boolean;
  private safety: SafetyGuard;
  private toolExecutor: ToolExecutor;

  constructor(config: AgentConfig) {
    this.router = config.router;
    this.verbose = config.verbose ?? false;
    this.safety = new SafetyGuard({
      autoApprove: false,
      confirmFileReads: process.env.GCA_CONFIRM_FILE_READS === '1',
    });
    this.toolExecutor = new ToolExecutor(this.safety);
  }

  public async start() {
    console.log(chalk.green('Gemini Code Agent initialized.'));
    console.log(chalk.gray('Type "exit" to quit.'));

    while (true) {
      const { input } = await inquirer.prompt([{
        type: 'input',
        name: 'input',
        message: chalk.blue('You:'),
      }]);

      if (input.toLowerCase() === 'exit') {
        console.log(chalk.yellow('Goodbye!'));
        break;
      }

      await this.processInput(input);
    }
  }

  private async processInput(input: string) {
    const spinner = ora('Thinking...').start();
    let messages: NormalizedMessage[] = [{ role: 'user', content: input }];

    try {
      let response = await this.router.sendMessage(messages, neutralToolsDef);

      while (response.functionCalls && response.functionCalls.length > 0) {
        spinner.stop();

        const assistantContent = response.text ?? '';
        const assistantMsg: NormalizedMessage = {
          role: 'assistant',
          content: assistantContent,
          functionCalls: response.functionCalls,
        };
        messages = [...messages, assistantMsg];

        const toolResults: NormalizedMessage[] = [];
        for (const call of response.functionCalls) {
          if (!call.name) continue;
          if (this.verbose) {
            console.log(chalk.dim(`[Tool Call] ${call.name}(${JSON.stringify(call.args)})`));
          }
          const result = await this.toolExecutor.execute(call.name, call.args);
          if (this.verbose) {
            console.log(chalk.dim(`[Tool Result] ${JSON.stringify(result)}`));
          }
          toolResults.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(result),
          });
        }
        messages = [...messages, ...toolResults];

        spinner.start('Processing results...');
        response = await this.router.sendToolResults(messages, neutralToolsDef);
      }

      spinner.stop();
      if (response.text) {
        console.log(chalk.green('Gemini:'), response.text);
      }
    } catch (error: any) {
      spinner.stop();
      console.error(chalk.red('Error:'), error.message);
      if (this.verbose) console.error(error);
    }
  }
}
