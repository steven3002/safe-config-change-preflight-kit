import type { Address } from 'viem';
import { InputError } from '../input/errors.js';
import { loadSafeTransaction } from '../input/tx-builder.js';
import type { SafeTransaction } from '../input/transaction.js';
import { createAnvilClients } from '../execution/anvil-client.js';
import { executeSafeTransaction } from '../execution/execute.js';
import { describeFailure } from '../execution/failure-reason.js';
import { resolveForkEndpoint, type ForkEndpoint } from '../execution/fork-config.js';
import { startForkedSafe } from '../execution/fork-mode.js';
import { approveTransactionHash } from '../execution/hash-approval.js';
import { crossCheckTransactionHash } from '../execution/hash-cross-check.js';
import { startLocalSafe } from '../execution/local-mode.js';
import type { ExecutionMode, SafeSession } from '../execution/running-safe.js';
import { createSafeStorageReader } from '../execution/storage-reader.js';
import { readCodeSize } from '../execution/target-code.js';
import { evaluateFindings } from '../policy/evaluate.js';
import { loadPolicy } from '../policy/load.js';
import { DEFAULT_POLICY, PolicyError, type Policy } from '../policy/schema.js';
import { resolveMultiSendCallOnly } from '../safe/multisend.js';
import { Operation, withoutGasRefund } from '../safe/transaction-parameters.js';
import { captureProtectedState, extendCapture } from '../statediff/capture.js';
import { classifyDeltas, isNonceOnlyDiff } from '../statediff/classify.js';
import { compareCaptures } from '../statediff/compare.js';
import { excludeRunnerWrites } from '../statediff/exclusions.js';
import { conclusive, inconclusive, type Outcome } from './outcome.js';

/**
 * The whole check, and the only module that knows the whole sequence: load the transaction and the
 * policy, start a chain holding the Safe, cross-check the hash, read the protected state, approve,
 * execute, read it again, diff the union of both reads, strip the runner's own writes, classify
 * what is left, and apply the policy to it.
 *
 * Every failure converges here, and every one of them is `INCONCLUSIVE` with a reason. That is the
 * property this file exists to guarantee: a hash that does not cross-check, a transaction that
 * reverted, a node that stopped answering and a payload too large for a block all produce no diff,
 * and an empty diff evaluated by a policy is a `PASS`. A reverted transaction genuinely changed no
 * protected state, so reporting that it changed none would be true and completely misleading.
 */

export interface CheckRequest {
  readonly filePath: string;
  /** Call semantics; the Transaction Builder format carries no field for it. */
  readonly operation: Operation;
  /** The Safe to check, for a file that does not name one itself. */
  readonly safeAddress?: Address | undefined;
  readonly mode: ExecutionMode;
  /** A `safe-policy.yml`; the built-in default policy applies when no file is named. */
  readonly policyPath?: string | undefined;
  /** Where fork mode forks from; resolved from the environment when not supplied. */
  readonly fork?: ForkEndpoint | undefined;
}

export interface Measurement {
  readonly transaction: SafeTransaction;
  readonly policy: Policy;
}

export async function runCheck(request: CheckRequest): Promise<Outcome> {
  const { mode } = request;

  let transaction: SafeTransaction;
  try {
    transaction = await loadSafeTransaction(request.filePath, {
      operation: request.operation,
      safeAddress: request.safeAddress,
    });
  } catch (cause) {
    if (!(cause instanceof InputError)) throw cause;
    return inconclusive(mode, `the transaction file could not be read: ${cause.message}`);
  }

  let policy: Policy;
  try {
    policy = request.policyPath === undefined ? DEFAULT_POLICY : await loadPolicy(request.policyPath);
  } catch (cause) {
    if (!(cause instanceof PolicyError)) throw cause;
    return inconclusive(mode, `the policy could not be read: ${cause.message}`);
  }

  let session: SafeSession;
  try {
    session = await startSafe(request, transaction);
  } catch (cause) {
    return inconclusive(
      mode,
      `no chain could be started to measure the Safe on: ${describeFailure(cause)}`,
    );
  }

  try {
    return await checkAgainstSafe(session, { transaction, policy });
  } finally {
    await session.stop();
  }
}

/**
 * Measure one transaction against a Safe that is already running.
 *
 * Ordering is load-bearing. The baseline is captured before any approval is written, because
 * approving first would bake the runner's own mutation into it and hide the writes the exclusion
 * step exists to name.
 */
export async function checkAgainstSafe(
  session: SafeSession,
  input: Measurement,
): Promise<Outcome> {
  const { safe } = session;
  const { policy } = input;

  try {
    if (safe.mode === 'fork' && safe.chainId !== input.transaction.chainId) {
      return inconclusive(
        safe.mode,
        `the file declares chain ${input.transaction.chainId} but the fork is chain ` +
          `${safe.chainId}; the transaction would be checked against a Safe on a different chain`,
      );
    }

    const transaction = withoutGasRefund(input.transaction);
    const clients = createAnvilClients(safe.rpcUrl);
    const reader = createSafeStorageReader(clients.reader, safe.safeAddress);

    const crossCheck = await crossCheckTransactionHash(clients.reader, {
      safeAddress: safe.safeAddress,
      chainId: safe.chainId,
      transaction,
    });
    if (crossCheck.status !== 'matched') {
      return inconclusive(safe.mode, crossCheck.reason);
    }

    if (
      transaction.operation === Operation.DelegateCall &&
      (await readCodeSize(clients.reader, transaction.to)) === 0
    ) {
      return inconclusive(
        safe.mode,
        `the transaction delegatecalls ${transaction.to}, which holds no code on the chain this ` +
          `check ran against. A delegatecall to an address with no code succeeds and does ` +
          'nothing, so the transaction was not measured, and whatever code that address holds ' +
          'elsewhere is exactly what the check exists to observe',
      );
    }

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
    if (result.status !== 'executed') {
      return inconclusive(
        safe.mode,
        `the transaction did not execute (${result.failure}), so the Safe's protected state was ` +
          `never measured after it: ${result.reason}`,
      );
    }

    const after = await captureProtectedState(reader, {
      additionalSlots: [...before.slots.keys()],
    });
    const sealed = await extendCapture(reader, before, after.slots.keys());
    const deltas = excludeRunnerWrites(compareCaptures(sealed, after), approval.writtenSlots);
    const findings = classifyDeltas({
      before: sealed,
      after,
      deltas,
      safeTxHash: crossCheck.safeTxHash,
      approvers: approval.signers,
    });

    return conclusive(
      safe.mode,
      evaluateFindings(findings, policy),
      findings,
      isNonceOnlyDiff(findings),
    );
  } catch (cause) {
    return inconclusive(safe.mode, `the Safe could not be measured: ${describeFailure(cause)}`);
  }
}

function startSafe(request: CheckRequest, transaction: SafeTransaction): Promise<SafeSession> {
  if (request.mode === 'fork') {
    return startForkedSafe({
      safeAddress: transaction.safeAddress,
      endpoint: request.fork ?? resolveForkEndpoint(),
    });
  }
  return startLocalSafe({ multiSendAddress: hostedMultiSend(transaction.chainId) });
}

/**
 * Where local mode must host `MultiSendCallOnly` for this particular file.
 *
 * The input layer wraps a batch into a delegatecall to the deployment recorded for the *file's*
 * chain, and local mode hosts the library at whatever address it is given, defaulting to the
 * canonical chain-1 one. Chains that enforce EIP-155 replay protection carry a different
 * deployment, so a file declaring one of them would target an address local mode never wrote code
 * to. Nothing below this layer sees both halves of that: the execution layer never sees the
 * transaction, and the input layer never sees the chain that will run it.
 *
 * A chain with no recorded deployment leaves the default in place. Such a file cannot be batched at
 * all, and the input layer has already rejected it if it was.
 */
function hostedMultiSend(chainId: number): Address | undefined {
  try {
    return resolveMultiSendCallOnly({ chainId });
  } catch {
    return undefined;
  }
}
