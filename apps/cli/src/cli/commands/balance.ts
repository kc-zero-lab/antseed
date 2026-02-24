import type { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getGlobalOptions } from './types.js';
import { loadConfig } from '../../config/loader.js';
import {
  loadOrCreateIdentity,
  BaseEscrowClient,
  identityToEvmAddress,
} from '@antseed/node';

/** Format USDC base units (6 decimals) to human-readable string. */
function formatUsdc(baseUnits: bigint): string {
  const whole = baseUnits / 1_000_000n;
  const frac = baseUnits % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '') || '0';
  return `${whole}.${fracStr}`;
}

export function registerBalanceCommand(program: Command): void {
  program
    .command('balance')
    .description('Show escrow balance for your wallet')
    .option('--json', 'output as JSON', false)
    .action(async (options) => {
      const globalOpts = getGlobalOptions(program);
      const config = await loadConfig(globalOpts.config);

      const payments = config.payments;
      if (!payments?.crypto) {
        console.error(chalk.red('Error: No crypto payment configuration found.'));
        console.error(chalk.dim('Configure payments.crypto in your config file or run: antseed init'));
        process.exit(1);
      }

      const identity = await loadOrCreateIdentity(globalOpts.dataDir);
      const address = identityToEvmAddress(identity);

      const escrowClient = new BaseEscrowClient({
        rpcUrl: payments.crypto.rpcUrl,
        contractAddress: payments.crypto.escrowContractAddress,
        usdcAddress: payments.crypto.usdcContractAddress,
      });

      const spinner = ora('Fetching balance...').start();

      try {
        const account = await escrowClient.getBuyerAccount(address);
        const usdcBalance = await escrowClient.getUSDCBalance(address);

        spinner.stop();

        if (options.json) {
          console.log(JSON.stringify({
            address,
            walletUSDC: formatUsdc(usdcBalance),
            escrowDeposited: formatUsdc(account.deposited),
            escrowCommitted: formatUsdc(account.committed),
            escrowAvailable: formatUsdc(account.available),
          }, null, 2));
          return;
        }

        console.log(chalk.bold('Wallet: ') + chalk.cyan(address));
        console.log('');
        console.log(chalk.bold('USDC Balance (wallet): ') + chalk.green(formatUsdc(usdcBalance) + ' USDC'));
        console.log('');
        console.log(chalk.bold('Escrow Account:'));
        console.log(`  Deposited:  ${chalk.green(formatUsdc(account.deposited) + ' USDC')}`);
        console.log(`  Committed:  ${chalk.yellow(formatUsdc(account.committed) + ' USDC')}`);
        console.log(`  Available:  ${chalk.green(formatUsdc(account.available) + ' USDC')}`);
      } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch balance: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
