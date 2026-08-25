#!/usr/bin/env node
import { runCheck } from '../check/run-check.js';
import type { Outcome } from '../check/outcome.js';
import { exitCodeFor, USAGE_ERROR_EXIT_CODE } from './exit-codes.js';
import { parseArguments, USAGE, UsageError } from './args.js';

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

  process.stdout.write(render(outcome));
  return exitCodeFor(outcome.verdict);
}

function render(outcome: Outcome): string {
  const lines = [`${outcome.verdict}  (${outcome.mode} mode)`];

  if (outcome.verdict === 'INCONCLUSIVE') {
    lines.push(`  the Safe was not measured: ${outcome.reason}`);
    return `${lines.join('\n')}\n`;
  }

  if (outcome.nonceOnly) {
    lines.push(
      '  the transaction executed and left no protected state behind; state written and reverted',
      '  within one transaction leaves no trace, so this is not proof that it is safe',
    );
  }
  for (const finding of outcome.findings) {
    lines.push(`  ${finding.field}: ${String(finding.before)} -> ${String(finding.after)}`);
    if (finding.detail !== undefined) lines.push(`    ${finding.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

const exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return USAGE_ERROR_EXIT_CODE;
  }
  throw error;
});

process.exitCode = exitCode;
