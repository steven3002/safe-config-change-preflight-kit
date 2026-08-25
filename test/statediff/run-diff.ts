import assert from 'node:assert/strict';
import { concat, pad, type Hex } from 'viem';
import { createAnvilClients } from '../../src/execution/anvil-client.js';
import { executeSafeTransaction, type ExecutionResult } from '../../src/execution/execute.js';
import { approveTransactionHash } from '../../src/execution/hash-approval.js';
import { crossCheckTransactionHash } from '../../src/execution/hash-cross-check.js';
import { createSafeStorageReader } from '../../src/execution/storage-reader.js';
import type { SafeSession } from '../../src/execution/running-safe.js';
import type { SafeTxParameters } from '../../src/safe/transaction-parameters.js';
import { captureProtectedState, extendCapture } from '../../src/statediff/capture.js';
import { classifyDeltas } from '../../src/statediff/classify.js';
import { compareCaptures, type SlotDelta } from '../../src/statediff/compare.js';
import { excludeRunnerWrites } from '../../src/statediff/exclusions.js';
import type { Finding } from '../../src/statediff/findings.js';

/**
 * The whole measured sequence against a running Safe: cross-check the hash, capture the baseline,
 * approve, execute, capture again, seal the union, strip the runner's own writes, classify.
 *
 * The ordering is load-bearing. Approving before the baseline capture would bake the runner's own
 * mutation into it and hide the very writes the exclusion step exists to name.
 */

export interface DiffRun {
  readonly result: ExecutionResult;
  readonly deltas: readonly SlotDelta[];
  /** Absent when the transaction did not execute: a run that failed measured nothing. */
  readonly findings?: readonly Finding[] | undefined;
  readonly safeTxHash: Hex;
  readonly writtenSlots: readonly Hex[];
}

export async function runStateDiff(
  session: SafeSession,
  transaction: SafeTxParameters,
): Promise<DiffRun> {
  const { safe } = session;
  const clients = createAnvilClients(safe.rpcUrl);
  const reader = createSafeStorageReader(clients.reader, safe.safeAddress);

  const crossCheck = await crossCheckTransactionHash(clients.reader, {
    safeAddress: safe.safeAddress,
    chainId: safe.chainId,
    transaction,
  });
  assert.equal(crossCheck.status, 'matched', describe(crossCheck));

  const before = await captureProtectedState(reader);

  const approval = await approveTransactionHash(clients, {
    safeAddress: safe.safeAddress,
    owners: safe.owners,
    threshold: safe.threshold,
    safeTxHash: crossCheck.safeTxHash,
  });

  const result = await executeSafeTransaction(clients, {
    safeAddress: safe.safeAddress,
    transaction,
    signers: approval.signers,
  });

  const shared = {
    result,
    safeTxHash: crossCheck.safeTxHash,
    writtenSlots: approval.writtenSlots,
  };
  if (result.status !== 'executed') {
    return { ...shared, deltas: [] };
  }

  const after = await captureProtectedState(reader, {
    additionalSlots: [...before.slots.keys()],
  });
  const sealed = await extendCapture(reader, before, after.slots.keys());
  const deltas = excludeRunnerWrites(compareCaptures(sealed, after), approval.writtenSlots);

  return {
    ...shared,
    deltas,
    findings: classifyDeltas({
      before: sealed,
      after,
      deltas,
      safeTxHash: crossCheck.safeTxHash,
      approvers: approval.signers,
    }),
  };
}

/**
 * Runtime code that writes one word to one slot and stops: `PUSH32 value PUSH32 slot SSTORE STOP`.
 *
 * Delegatecalled from a Safe it is the shape of the attack this whole tool exists to catch,  a
 * contract exposing no Safe configuration selector at all, rewriting the Safe's protected storage
 * directly. A decoder sees a call to an unknown address with empty calldata.
 */
export function storageWriterRuntime(slot: Hex, value: Hex): Hex {
  return concat(['0x7f', pad(value, { size: 32 }), '0x7f', pad(slot, { size: 32 }), '0x5500']);
}

export function findingFor(
  findings: readonly Finding[] | undefined,
  field: Finding['field'],
): Finding {
  assert.ok(findings !== undefined, 'the transaction did not execute, so nothing was measured');
  const found = findings.find((finding) => finding.field === field);
  assert.ok(found !== undefined, `no ${field} finding in ${describe(findings)}`);
  return found;
}

/** These results carry bigints, and a failed assertion is only useful if it can print them. */
export function describe(value: unknown): string {
  return JSON.stringify(value, (_key: string, item: unknown) =>
    typeof item === 'bigint' ? `${item}` : item,
  );
}
