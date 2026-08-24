#!/usr/bin/env node
import { InputError } from '../input/errors.js';
import { loadSafeTransaction } from '../input/tx-builder.js';
import { Operation, type SafeTransaction } from '../input/transaction.js';
import { USAGE_ERROR_EXIT_CODE } from './exit-codes.js';
import { parseArguments, USAGE, UsageError } from './args.js';

/** Entry point: wires argv to the check pipeline. */

async function main(argv: readonly string[]): Promise<number> {
  const command = parseArguments(argv);

  if (command.kind === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  const transaction = await loadSafeTransaction(command.filePath, {
    operation: command.operation,
  });
  process.stdout.write(render(transaction));
  return 0;
}

function render(transaction: SafeTransaction): string {
  const rows: [string, string][] = [
    ['safe', transaction.safeAddress],
    ['chainId', String(transaction.chainId)],
    ['to', transaction.to],
    ['value', `${transaction.value} wei`],
    ['operation', transaction.operation === Operation.DelegateCall ? 'delegatecall (1)' : 'call (0)'],
    ['data', transaction.data],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}\n`).join('');
}

const exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return USAGE_ERROR_EXIT_CODE;
  }
  if (error instanceof InputError) {
    process.stderr.write(`${error.message}\n`);
    return USAGE_ERROR_EXIT_CODE;
  }
  throw error;
});

process.exitCode = exitCode;
