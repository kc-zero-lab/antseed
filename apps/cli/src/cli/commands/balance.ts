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

const CHAIN_IDS: Record<string, number> = {
  'base-mainnet': 8453,
  'base-sepolia': 84532,
  'base-local':   31337,
};

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
        rpcUrl:          payments.crypto.rpcUrl,
        contractAddress: payments.crypto.escrowContractAddress,
        usdcAddress:     payments.crypto.usdcContractAddress,
        chainId:         CHAIN_IDS[payments.crypto.chainId] ?? 8453,
      });

      const spinner = ora('Fetching balance...').start();

      try {
        const balance = await escrowClient.getBuyerBalance(address);
        const usdcBalance = await escrowClient.getUSDCBalance(address);

        spinner.stop();

        const withdrawalReady = balance.withdrawalReadyAt > 0
          ? new Date(balance.withdrawalReadyAt * 1000).toLocaleString()
          : null;

        if (options.json) {
          console.log(JSON.stringify({
            address,
            walletUSDC:        formatUsdc(usdcBalance),
            escrowAvailable:   formatUsdc(balance.available),
            pendingWithdrawal: formatUsdc(balance.pendingWithdrawal),
            withdrawalReadyAt: withdrawalReady,
          }, null, 2));
          return;
        }

        console.log(chalk.bold('Wallet: ') + chalk.cyan(address));
        console.log('');
        console.log(chalk.bold('USDC Balance (wallet): ') + chalk.green(formatUsdc(usdcBalance) + ' USDC'));
        console.log('');
        console.log(chalk.bold('Escrow Account:'));
        console.log(`  Available:         ${chalk.green(formatUsdc(balance.available) + ' USDC')}`);
        console.log(`  Pending withdrawal: ${chalk.yellow(formatUsdc(balance.pendingWithdrawal) + ' USDC')}`);
        if (withdrawalReady) {
          console.log(`  Withdrawal ready:   ${chalk.dim(withdrawalReady)}`);
        }
      } catch (err) {
        spinner.fail(chalk.red(`Failed to fetch balance: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
