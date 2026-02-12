#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import chalk from 'chalk';
import { Agent, SYSTEM_PROMPT } from '../core/agent.js';
import { getFallbackConfig, requiresGemini, requiresGroq } from '../core/config.js';
import { Router } from '../core/llm/router.js';
import { createGeminiAdapter } from '../core/llm/adapters/gemini.js';
import { createGroqAdapter } from '../core/llm/adapters/groq.js';
import type { ProviderConfig } from '../core/config.js';
import type { LLMProvider } from '../core/llm/types.js';

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
      if (requiresGemini() && !process.env.API_KEY?.trim()) {
        console.error(chalk.red('Error: API_KEY is not set in .env (required for Gemini).'));
        process.exit(1);
      }
      if (requiresGroq() && !process.env.GROQ_API_KEY?.trim()) {
        console.warn(chalk.yellow('Warning: GROQ_API_KEY is not set; Groq fallback will be skipped.'));
      }

      const providerConfigs = getFallbackConfig();
      if (providerConfigs.length === 0) {
        console.error(chalk.red('Error: No provider configured. Set API_KEY and/or GROQ_API_KEY and ensure FALLBACK_MODELS (if set) includes valid providers.'));
        process.exit(1);
      }

      const createAdapter = (config: ProviderConfig): LLMProvider => {
        return config.provider === 'gemini'
          ? createGeminiAdapter(config, SYSTEM_PROMPT)
          : createGroqAdapter(config, SYSTEM_PROMPT);
      };

      const router = new Router({
        providerConfigs,
        createAdapter,
        systemPrompt: SYSTEM_PROMPT,
      });

      console.log(chalk.blue('Starting Gemini Code Agent...'));

      const agent = new Agent({
        router,
        verbose: options.verbose,
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
