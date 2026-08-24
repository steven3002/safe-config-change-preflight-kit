import { parseArgs } from 'node:util';
import { Operation } from '../input/transaction.js';

/** Parse and validate command-line arguments into a command the entry point can run. */

export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export interface CheckCommand {
  readonly kind: 'check';
  readonly filePath: string;
  readonly operation: Operation;
}

export interface HelpCommand {
  readonly kind: 'help';
}

export type Command = CheckCommand | HelpCommand;

export const USAGE = `safe-statediff ,  check a Safe transaction file against the Safe's protected state

Usage:
  safe-statediff check <transaction.json> [options]

Options:
  --operation <call|delegatecall>  Call semantics to execute the transaction with.
                                   Defaults to call. The Transaction Builder format has no field
                                   for this, so a delegatecall must be declared here.
  -h, --help                       Show this message.
`;

const OPERATIONS: Readonly<Record<string, Operation>> = {
  call: Operation.Call,
  delegatecall: Operation.DelegateCall,
};

export function parseArguments(argv: readonly string[]): Command {
  let values: { operation?: string | undefined; help?: boolean | undefined };
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        operation: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (cause) {
    throw new UsageError(cause instanceof Error ? cause.message : String(cause), { cause });
  }

  if (values.help === true || positionals.length === 0) return { kind: 'help' };

  const [command, ...rest] = positionals;
  if (command !== 'check') {
    throw new UsageError(`unknown command '${command ?? ''}'; the only command is 'check'`);
  }

  if (rest.length === 0) {
    throw new UsageError('check needs the path to a Safe Transaction Builder JSON file');
  }
  if (rest.length > 1) {
    throw new UsageError(`check takes one file, received ${rest.length}: ${rest.join(', ')}`);
  }

  return {
    kind: 'check',
    filePath: rest[0] as string,
    operation: readOperation(values.operation),
  };
}

function readOperation(raw: string | undefined): Operation {
  if (raw === undefined) return Operation.Call;
  const operation = OPERATIONS[raw.toLowerCase()];
  if (operation === undefined) {
    throw new UsageError(`--operation must be call or delegatecall, received '${raw}'`);
  }
  return operation;
}
