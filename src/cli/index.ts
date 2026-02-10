#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { Agent } from '../core/agent.js';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('gca')
  .description('Gemini Code Agent - AI coding assistant for your terminal')
  .version('1.0.0');

program
  .command('start')
  .description('Start the interactive agent session')
  .option('-v, --verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      if (!process.env.API_KEY) {
        console.error(chalk.red('Error: API_KEY is not set in .env file or environment variables.'));
        process.exit(1);
      }

      console.log(chalk.blue('Starting Gemini Code Agent...'));
      
      const agent = new Agent({
        apiKey: process.env.API_KEY,
        verbose: options.verbose
      });

      await agent.start();
      
    } catch (error: any) {
      console.error(chalk.red('Fatal Error:'), error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}