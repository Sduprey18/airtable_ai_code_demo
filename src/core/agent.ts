import { GoogleGenAI } from "@google/genai";
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';

export interface AgentConfig {
  apiKey: string;
  verbose?: boolean;
}

export class Agent {
  private client: GoogleGenAI;
  private verbose: boolean;
  private history: any[] = []; // TODO: Type properly with Content types

  constructor(config: AgentConfig) {
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.verbose = config.verbose || false;
  }

  public async start() {
    console.log(chalk.green('Agent initialized. Type "exit" to quit.'));

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
      // Basic text generation for MVP step 2
      // TODO: Add tools in next steps
      const model = 'gemini-2.0-flash-exp'; // Using experimental model for better reasoning
      
      const response = await this.client.models.generateContent({
        model: model,
        contents: input,
        config: {
            systemInstruction: "You are a helpful coding assistant CLI tool. You are running in a Node.js environment."
        }
      });

      spinner.stop();

      const text = response.text;
      if (text) {
        console.log(chalk.green('Gemini:'), text);
      } else {
        console.log(chalk.yellow('Gemini: [No text response]'));
      }

    } catch (error: any) {
      spinner.fail('Error processing request');
      console.error(chalk.red('API Error:'), error.message);
      if (this.verbose) {
        console.error(error);
      }
    }
  }
}