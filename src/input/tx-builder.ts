import { readFile } from 'node:fs/promises';
import type { Hex } from 'viem';
import { parseBatchFile, type BatchFile, type BatchTransaction } from './batch-file.js';
import { InputError, atTransaction } from './errors.js';
import { encodeDeclaredCall } from './method-encoding.js';
import { Operation, type SafeTransaction } from './transaction.js';

/** Parse and validate a Safe Transaction Builder JSON file into a `SafeTransaction`. */

export interface LoadOptions {
  /**
   * The Transaction Builder format has no field for call semantics, so this cannot be read from
   * the file and must be supplied by the caller.
   */
  readonly operation: Operation;
}

export async function loadSafeTransaction(
  filePath: string,
  options: LoadOptions,
): Promise<SafeTransaction> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new InputError(`could not read '${filePath}': ${detail}`, { cause });
  }
  return parseSafeTransaction(text, options);
}

export function parseSafeTransaction(text: string, options: LoadOptions): SafeTransaction {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new InputError(`file is not valid JSON: ${detail}`, { cause });
  }
  return normalize(parseBatchFile(raw), options);
}

function normalize(file: BatchFile, options: LoadOptions): SafeTransaction {
  if (file.transactions.length === 0) {
    throw new InputError("'transactions' is empty; there is nothing to check");
  }
  if (file.transactions.length > 1) {
    throw new InputError(
      `file contains ${file.transactions.length} transactions; batched files are not supported, ` +
        'because executing them as one Safe transaction would require a MultiSend delegatecall ' +
        'that this tool does not construct. Split the batch into single-transaction files.',
    );
  }

  const transaction = file.transactions[0] as BatchTransaction;
  let data: Hex;
  try {
    data = resolveCalldata(transaction);
  } catch (cause) {
    throw atTransaction(0, cause);
  }

  return {
    to: transaction.to,
    value: transaction.value,
    data,
    operation: options.operation,
    safeAddress: file.safeAddress,
    chainId: file.chainId,
  };
}

/**
 * Transaction Builder writes calldata in one of two forms: pre-encoded in `data`, or declared as a
 * `contractMethod` with `contractInputsValues` and `data: null`.
 *
 * When a file carries both, they are encoded and compared rather than one being preferred. A file
 * whose readable declaration disagrees with the bytes that would actually execute is the shape a
 * malicious pull request takes ,  a reviewer reads the method name and arguments while the Safe
 * runs the `data` field ,  so a disagreement is rejected outright.
 */
function resolveCalldata(transaction: BatchTransaction): Hex {
  const declared =
    transaction.contractMethod === null
      ? undefined
      : encodeDeclaredCall(transaction.contractMethod, transaction.contractInputsValues);

  if (declared !== undefined && transaction.data !== null) {
    if (declared.toLowerCase() !== transaction.data.toLowerCase()) {
      throw new InputError(
        `'data' does not match the calldata encoded from contractMethod '${transaction.contractMethod?.name ?? ''}'.\n` +
          `  data:     ${transaction.data}\n` +
          `  declared: ${declared}`,
      );
    }
    return declared;
  }

  if (declared !== undefined) return declared;
  if (transaction.data !== null) return transaction.data;

  throw new InputError(
    "carries neither 'data' nor an encodable 'contractMethod', so it declares no call",
  );
}
