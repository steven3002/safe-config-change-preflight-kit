#!/usr/bin/env node
import { runCheck } from '../check/run-check.js';
import { exitCodeFor, USAGE_ERROR_EXIT_CODE } from './exit-codes.js';
import { parseArguments, USAGE, UsageError } from './args.js';
import { renderHumanReport } from '../report/human.js';
import { renderJsonReport } from '../report/json.js';

/** Entry point: wires argv to the check pipeline and turns its outcome into an exit code. */

async function main(argv: readonly string[]): Promise<number> {
  const command = parseArguments(argv);

  if (command.kind === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  const outcome = await runCheck({
    filePath: command.filePath,
    operation: command.operation,
    safeAddress: command.safeAddress,
    mode: command.mode,
    policyPath: command.policyPath,
  });

  const output = command.format === 'json' ? renderJsonReport(outcome) : renderHumanReport(outcome);
  process.stdout.write(output);
  return exitCodeFor(outcome.verdict);
}

const exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return USAGE_ERROR_EXIT_CODE;
  }
  throw error;
});

process.exitCode = exitCode;
