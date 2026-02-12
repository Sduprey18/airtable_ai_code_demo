import { GoogleGenAI, Chat, GenerateContentResponse, Part } from "@google/genai";
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { SafetyGuard } from '../utils/safety.js';
import { toolsDef, ToolExecutor } from './tools.js';

export interface AgentConfig {
  apiKey: string;
  verbose?: boolean;
}

export class Agent {
  private client: GoogleGenAI;
  private chat: Chat;
  private verbose: boolean;
  private safety: SafetyGuard;
  private toolExecutor: ToolExecutor;

  constructor(config: AgentConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.verbose = config.verbose || false;
    this.safety = new SafetyGuard();
    this.toolExecutor = new ToolExecutor(this.safety);

    // Initialize chat session
    this.chat = this.client.chats.create({
      model: 'gemini-3-flash-preview', // Stronger model for coding tasks
      config: {
        systemInstruction: "You are a senior software engineer. You have access to tools to read files, edit files (create/update), list directories, and run terminal commands. When asked to do something, use these tools to perform the action on the user's system. Always check if files exist before reading. Be concise.",
        tools: [{ functionDeclarations: toolsDef }],
      },
    });
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

    try {
      // 1. Send user message
      let response = await this.chat.sendMessage({ message: input });

      // 2. Loop while there are function calls (Agent Loop)
      while (response.functionCalls && response.functionCalls.length > 0) {
        spinner.stop(); // Stop spinner to allow console output from tools/safety prompts
        
        const functionResponseParts: Part[] = [];

        for (const call of response.functionCalls) {
          if (!call.name) {
             continue;
          }

          if (this.verbose) {
            console.log(chalk.dim(`[Tool Call] ${call.name}(${JSON.stringify(call.args)})`));
          }

          // Execute tool
          const result = await this.toolExecutor.execute(call.name, call.args);

          if (this.verbose) {
             console.log(chalk.dim(`[Tool Result] ${JSON.stringify(result)}`));
          }

          functionResponseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: { result: result }
            }
          });
        }

        // Restart spinner for the next model turn
        spinner.start('Processing results...');
        
        // Send tool results back to model
        response = await this.chat.sendMessage({ message: functionResponseParts });
      }

      spinner.stop();

      // 3. Display final text response
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