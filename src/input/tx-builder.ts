import { readFile } from 'node:fs/promises';
import { isAddressEqual, type Address, type Hex } from 'viem';
import {
  encodeMultiSendCallOnly,
  resolveMultiSendCallOnly,
  type MultiSendCall,
} from '../safe/multisend.js';
import { Operation } from '../safe/transaction-parameters.js';
import { parseBatchFile, type BatchFile, type BatchTransaction } from './batch-file.js';
import { InputError, atTransaction } from './errors.js';
import { encodeDeclaredCall } from './method-encoding.js';
import type { SafeTransaction } from './transaction.js';

/** Parse and validate a Safe Transaction Builder JSON file into a `SafeTransaction`. */

export interface LoadOptions {
  /**
   * The Transaction Builder format has no field for call semantics, so this cannot be read from
   * the file and must be supplied by the caller. It is overridden for a batch, which only executes
   * as a delegatecall.
   */
  readonly operation: Operation;
  /**
   * The Safe to check against, used when the file does not name one in
   * `meta.createdFromSafeAddress`.
   */
  readonly safeAddress?: Address | undefined;
  /** The `MultiSendCallOnly` release to wrap a batch with; defaults inside the Safe layer. */
  readonly multiSendVersion?: string | undefined;
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

  const safeAddress = resolveSafeAddress(file.safeAddress, options.safeAddress);
  const calls = file.transactions.map((transaction, index) => {
    try {
      return { ...transaction, data: resolveCalldata(transaction) };
    } catch (cause) {
      throw atTransaction(index, cause);
    }
  });

  const [single] = calls;
  if (calls.length === 1 && single !== undefined) {
    return {
      to: single.to,
      value: single.value,
      data: single.data,
      operation: options.operation,
      safeAddress,
      chainId: file.chainId,
    };
  }

  return wrapBatch(calls, file.chainId, safeAddress, options.multiSendVersion);
}

/**
 * Wrap several transactions into the single `MultiSendCallOnly` delegatecall a Safe would use to
 * execute them as one transaction.
 *
 * `operation` is forced to delegatecall regardless of what the caller asked for, because a plain
 * call would run the batch in MultiSend's own context rather than the Safe's. `value` is zero
 * because a delegatecall carries none,   the EVM ignores the field entirely,   and each inner call
 * draws its value from the Safe's own balance.
 */
function wrapBatch(
  calls: readonly (BatchTransaction & { data: Hex })[],
  chainId: number,
  safeAddress: Address,
  multiSendVersion: string | undefined,
): SafeTransaction {
  const inner: MultiSendCall[] = calls.map((call) => ({
    to: call.to,
    value: call.value,
    data: call.data,
    operation: Operation.Call,
  }));

  let to: Address;
  let data: Hex;
  try {
    to = resolveMultiSendCallOnly({ chainId, version: multiSendVersion });
    data = encodeMultiSendCallOnly(inner);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new InputError(
      `file contains ${calls.length} transactions and cannot be batched: ${detail}`,
      { cause },
    );
  }

  return { to, value: 0n, data, operation: Operation.DelegateCall, safeAddress, chainId };
}

/**
 * `meta.createdFromSafeAddress` is optional in Safe's own `BatchFile` type, so a file that omits it
 * is well-formed and the caller supplies the Safe instead.
 *
 * When both are present and disagree, neither is used. A file naming one Safe checked against
 * another reports a diff for a Safe nobody reviewed, and silently preferring either source hides
 * which one the reviewer was reading.
 */
function resolveSafeAddress(
  fromFile: Address | null,
  fromArgument: Address | undefined,
): Address {
  if (fromFile !== null && fromArgument !== undefined && !isAddressEqual(fromFile, fromArgument)) {
    throw new InputError(
      'the file and the --safe argument name different Safes.\n' +
        `  meta.createdFromSafeAddress: ${fromFile}\n` +
        `  --safe:                      ${fromArgument}`,
    );
  }

  const safeAddress = fromFile ?? fromArgument;
  if (safeAddress === undefined) {
    throw new InputError(
      "the file declares no 'meta.createdFromSafeAddress' and no --safe was supplied; this tool " +
        'checks a transaction against a particular Safe, so one of the two must name it',
    );
  }
  return safeAddress;
}

/**
 * Transaction Builder writes calldata in one of two forms: pre-encoded in `data`, or declared as a
 * `contractMethod` with `contractInputsValues` and `data: null`.
 *
 * When a file carries both, they are encoded and compared rather than one being preferred. A file
 * whose readable declaration disagrees with the bytes that would actually execute is the shape a
 * malicious pull request takes,   a reviewer reads the method name and arguments while the Safe
 * runs the `data` field,   so a disagreement is rejected outright.
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
