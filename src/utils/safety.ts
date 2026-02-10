import inquirer from 'inquirer';
import chalk from 'chalk';

export interface SafetyConfig {
  autoApprove?: boolean;
}

export class SafetyGuard {
  private autoApprove: boolean;

  constructor(config: SafetyConfig = {}) {
    this.autoApprove = config.autoApprove || false;
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