import {
  BaseError,
  HttpRequestError,
  SocketClosedError,
  TimeoutError,
  WebSocketRequestError,
  decodeFunctionResult,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import {
  EXEC_TRANSACTION_ABI,
  encodeExecTransaction,
  encodePreValidatedSignatures,
} from '../safe/exec-transaction.js';
import type { SafeTxParameters } from '../safe/transaction-parameters.js';
import { resolveFundedAccount, type AnvilClients } from './anvil-client.js';
import { describeFailure } from './failure-reason.js';

/**
 * Submit the transaction under review as a real `execTransaction` call, and say precisely how it
 * went.
 *
 * Nothing here reports success unless the transaction actually executed. A revert, an exhausted gas
 * limit and an unreachable node are three different things and each is named: a reverted
 * transaction changed no state, and reporting "no protected state changed" for it would be true and
 * badly misleading.
 *
 * The submitting account is one Anvil unlocked, not an owner. The signature check is satisfied by
 * the approvals written beforehand, and `execTransaction` places no requirement on its caller, so
 * the runner impersonates nobody and writes to no slot other than the approvals it made.
 */

/** Why a submission did not execute. Each maps to an inconclusive result, never to a verdict. */
export type ExecutionFailure = 'reverted' | 'out-of-gas' | 'transport';

export interface ExecutedTransaction {
  readonly status: 'executed';
  readonly transactionHash: Hex;
  readonly gasUsed: bigint;
}

export interface FailedExecution {
  readonly status: 'failed';
  readonly failure: ExecutionFailure;
  readonly reason: string;
}

export type ExecutionResult = ExecutedTransaction | FailedExecution;

export interface ExecutionRequest {
  readonly safeAddress: Address;
  readonly transaction: SafeTxParameters;
  /** The owners whose approvals were written, which become the pre-validated signature blob. */
  readonly signers: readonly Address[];
  /**
   * Gas to submit with. Defaults to the chain's block gas limit, which is the most any transaction
   * on this chain can be given, so that a transaction the Safe could run is never refused for the
   * runner's own reasons.
   */
  readonly gasLimit?: bigint | undefined;
}

export async function executeSafeTransaction(
  clients: AnvilClients,
  request: ExecutionRequest,
): Promise<ExecutionResult> {
  const safeAddress = getAddress(request.safeAddress);
  const data = encodeExecTransaction(
    request.transaction,
    encodePreValidatedSignatures(request.signers),
  );

  let account: Address;
  let gas: bigint;
  try {
    account = await resolveFundedAccount(clients.wallet);
    gas = request.gasLimit ?? (await blockGasLimit(clients));
  } catch (cause) {
    return failure(
      'transport',
      `the chain could not be prepared for submission: ${describeFailure(cause)}`,
    );
  }

  const simulation = await simulate(clients, { account, safeAddress, data, gas });
  if (simulation !== undefined) {
    return simulation;
  }

  return send(clients, { account, safeAddress, data, gas });
}

interface Submission {
  readonly account: Address;
  readonly safeAddress: Address;
  readonly data: Hex;
  readonly gas: bigint;
}

/**
 * Run the call first and return a failure if it does not go through.
 *
 * A mined transaction that reverted carries no reason on its receipt, so the submission that failed
 * would otherwise be reported as an unexplained revert. Calling first costs one request and puts
 * the Safe's own error — `GS013` for an inner call that failed, `GS02x` for a signature the Safe
 * rejected — into the reason a reviewer reads. It returns `undefined` when there is nothing to
 * report and the transaction should be sent.
 */
async function simulate(
  clients: AnvilClients,
  submission: Submission,
): Promise<FailedExecution | undefined> {
  let returned: Hex | undefined;
  try {
    ({ data: returned } = await clients.reader.call({
      account: submission.account,
      to: submission.safeAddress,
      data: submission.data,
      gas: submission.gas,
    }));
  } catch (cause) {
    return classify(cause, 'the transaction could not be executed against the Safe');
  }

  if (returned === undefined) {
    return failure('reverted', 'execTransaction returned nothing, so the Safe did not run it');
  }

  const succeeded = decodeFunctionResult({
    abi: EXEC_TRANSACTION_ABI,
    functionName: 'execTransaction',
    data: returned,
  });
  if (!succeeded) {
    return failure(
      'reverted',
      'execTransaction reported failure: the Safe ran the transaction and its inner call did ' +
        'not succeed',
    );
  }
  return undefined;
}

async function send(clients: AnvilClients, submission: Submission): Promise<ExecutionResult> {
  let transactionHash: Hex;
  try {
    transactionHash = await clients.wallet.sendTransaction({
      account: submission.account,
      chain: null,
      to: submission.safeAddress,
      data: submission.data,
      gas: submission.gas,
    });
  } catch (cause) {
    return classify(cause, 'the transaction could not be submitted');
  }

  try {
    const receipt = await clients.reader.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status === 'success') {
      return { status: 'executed', transactionHash, gasUsed: receipt.gasUsed };
    }
    if (receipt.gasUsed >= submission.gas) {
      return failure(
        'out-of-gas',
        `the transaction consumed its entire gas limit of ${submission.gas} without completing`,
      );
    }
    return failure(
      'reverted',
      `the transaction reverted once mined (transaction ${transactionHash}), although the same ` +
        'call had succeeded moments earlier',
    );
  } catch (cause) {
    return classify(cause, `the receipt for transaction ${transactionHash} could not be read`);
  }
}

/**
 * Anvil's own block gas limit, used as the submission's limit.
 *
 * The limit is taken from the chain rather than estimated, because estimation on a call that
 * reverts fails in the same way a real failure does and would collapse two of the three outcomes
 * this function exists to keep apart.
 */
async function blockGasLimit(clients: AnvilClients): Promise<bigint> {
  const block = await clients.reader.getBlock({ blockTag: 'latest' });
  if (block.gasLimit <= 0n) {
    throw new Error('the chain reports a block gas limit of zero');
  }
  return block.gasLimit;
}

const TRANSPORT_ERRORS = [
  HttpRequestError,
  SocketClosedError,
  TimeoutError,
  WebSocketRequestError,
];

/** How a node that is not there surfaces when the failure is not one of viem's own error types. */
const UNREACHABLE_NODE_PATTERN = /fetch failed|ECONNREFUSED|ECONNRESET|socket/iu;

/**
 * Anvil reports an exhausted gas limit as an internal error whose detail reads `EVM error
 * OutOfGas` rather than as a revert, so the optional spacing here is load-bearing rather than
 * cosmetic. Read from anvil 1.7.1's own responses.
 */
const OUT_OF_GAS_PATTERN = /out\s?of\s?gas|intrinsic gas too low|gas required exceeds/iu;

/**
 * Decide which of the three failures an error is.
 *
 * Transport is checked first and by type rather than by message: a node that stopped answering
 * produces text that can say anything, and calling that a revert would report a fact about the
 * transaction that was never observed.
 */
function classify(cause: unknown, context: string): FailedExecution {
  const description = describeFailure(cause);

  if (isTransportError(cause)) {
    return failure('transport', `${context}: the node did not answer (${description})`);
  }
  if (OUT_OF_GAS_PATTERN.test(description)) {
    return failure('out-of-gas', `${context}: ${description}`);
  }
  return failure('reverted', `${context}: ${description}`);
}

function isTransportError(cause: unknown): boolean {
  if (!(cause instanceof BaseError)) {
    return cause instanceof Error && UNREACHABLE_NODE_PATTERN.test(cause.message);
  }
  return cause.walk((error) => TRANSPORT_ERRORS.some((kind) => error instanceof kind)) !== null;
}

function failure(kind: ExecutionFailure, reason: string): FailedExecution {
  return { status: 'failed', failure: kind, reason };
}
