import inquirer from 'inquirer';
import chalk from 'chalk';

export interface SafetyConfig {
  autoApprove?: boolean;
  confirmFileReads?: boolean;
}

export class SafetyGuard {
  private autoApprove: boolean;
  private confirmFileReads: boolean;

  constructor(config: SafetyConfig = {}) {
    this.autoApprove = config.autoApprove || false;
    this.confirmFileReads = config.confirmFileReads || false;
  }

  async confirmAction(action: string, details: string): Promise<boolean> {
    if (this.autoApprove) return true;

    console.log(chalk.yellow('\n--- SAFETY CHECK ---'));
    console.log(chalk.bold('Action:'), action);
    console.log(chalk.dim(details));
    console.log(chalk.yellow('--------------------\n'));

    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: 'Do you want to proceed?',
      default: false
    }]);

    return confirmed;
  }

  /**
   * Determine whether file reads should require explicit confirmation.
   * This can be toggled via config (e.g., CLI flags or env) and can be
   * combined with size-based heuristics at the call site.
   */
  shouldConfirmFileReads(): boolean {
    return !this.autoApprove && this.confirmFileReads;
  }

  validateCommand(command: string): boolean {
    const BLACKLIST = [
      'rm -rf /', 
      'mkfs', 
      ':(){ :|:& };:',
      'dd if=/dev/zero'
    ];

    for (const blocked of BLACKLIST) {
      if (command.includes(blocked)) {
        console.error(chalk.red(`Command blocked by safety filter: ${blocked}`));
        return false;
      }
    }
    return true;
  }
}