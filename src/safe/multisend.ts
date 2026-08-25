import { getMultiSendCallOnlyDeployment } from '@safe-global/safe-deployments';
import {
  concat,
  encodeFunctionData,
  encodePacked,
  getAddress,
  hexToBigInt,
  hexToNumber,
  parseAbi,
  size,
  slice,
  type Address,
  type Hex,
} from 'viem';
import { Operation } from './transaction-parameters.js';

/**
 * Pack a batch of calls into the `multiSend(bytes)` argument `MultiSendCallOnly` expects, and
 * resolve that contract's address for a chain.
 *
 * A Safe executes a batch as one transaction by delegatecalling a MultiSend library, so a batched
 * input file becomes a single `SafeTransaction` targeting this deployment. `MultiSendCallOnly` is
 * the right variant here: it reverts on any inner delegatecall, and the Transaction Builder format
 * cannot express one, so nothing is lost and a batch cannot smuggle one in.
 */

export const MULTI_SEND_ABI = parseAbi(['function multiSend(bytes transactions) payable']);

/**
 * The MultiSendCallOnly release this tool resolves by default.
 *
 * The library is standalone,   a Safe delegatecalls into it and it touches no Safe storage,   so its
 * release does not have to match the Safe's. 1.3.0 is the default because it is the version
 * deployed on the widest set of chains, and because the Safe this tool's fork mode targets is
 * itself v1.3.0.
 */
export const DEFAULT_MULTI_SEND_VERSION = '1.3.0';

const OPERATION_BYTES = 1;
const ADDRESS_BYTES = 20;
const WORD_BYTES = 32;
const HEADER_BYTES = OPERATION_BYTES + ADDRESS_BYTES + WORD_BYTES + WORD_BYTES;

export interface MultiSendCall {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  readonly operation: Operation;
}

/**
 * Concatenate the calls in MultiSend's packed wire format: `operation(1) ++ to(20) ++ value(32) ++
 * dataLength(32) ++ data` per entry, with no padding between entries.
 */
export function packMultiSendTransactions(calls: readonly MultiSendCall[]): Hex {
  if (calls.length === 0) {
    throw new Error('a MultiSend batch needs at least one call');
  }
  return concat(
    calls.map((call) =>
      encodePacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [call.operation, call.to, call.value, BigInt(size(call.data)), call.data],
      ),
    ),
  );
}

/**
 * Read a packed batch back into its calls. The inverse exists so a packed blob can be checked
 * against the calls it claims to carry rather than trusted because the packer produced it.
 */
export function unpackMultiSendTransactions(packed: Hex): MultiSendCall[] {
  const total = size(packed);
  const calls: MultiSendCall[] = [];

  let offset = 0;
  while (offset < total) {
    if (offset + HEADER_BYTES > total) {
      throw new Error(
        `packed batch ends mid-entry: ${total - offset} bytes remain where an entry header needs ${HEADER_BYTES}`,
      );
    }
    const operation = hexToNumber(slice(packed, offset, offset + OPERATION_BYTES));
    if (operation !== Operation.Call && operation !== Operation.DelegateCall) {
      throw new Error(`packed batch carries operation ${operation}, which is not call or delegatecall`);
    }

    let cursor = offset + OPERATION_BYTES;
    const to = getAddress(slice(packed, cursor, cursor + ADDRESS_BYTES));
    cursor += ADDRESS_BYTES;
    const value = hexToBigInt(slice(packed, cursor, cursor + WORD_BYTES));
    cursor += WORD_BYTES;
    const dataLength = hexToBigInt(slice(packed, cursor, cursor + WORD_BYTES));
    cursor += WORD_BYTES;

    if (dataLength > BigInt(total - cursor)) {
      throw new Error(
        `packed batch declares ${dataLength} bytes of calldata but only ${total - cursor} remain`,
      );
    }
    const end = cursor + Number(dataLength);
    const data: Hex = dataLength === 0n ? '0x' : slice(packed, cursor, end);
    calls.push({ to, value, data, operation });
    offset = end;
  }

  return calls;
}

/**
 * Encode the `multiSend(bytes)` call a Safe delegatecalls into.
 *
 * An inner delegatecall is rejected here rather than left to revert on chain: `MultiSendCallOnly`
 * answers one with a bare `revert(0, 0)`, which reaches the runner as an unexplained failure.
 */
export function encodeMultiSendCallOnly(calls: readonly MultiSendCall[]): Hex {
  const nested = calls.findIndex((call) => call.operation === Operation.DelegateCall);
  if (nested !== -1) {
    throw new Error(
      `call ${nested} of the batch is a delegatecall, which MultiSendCallOnly refuses to perform`,
    );
  }
  return encodeFunctionData({
    abi: MULTI_SEND_ABI,
    functionName: 'multiSend',
    args: [packMultiSendTransactions(calls)],
  });
}

export interface MultiSendDeploymentQuery {
  readonly chainId: number;
  readonly version?: string | undefined;
}

/**
 * Resolve the `MultiSendCallOnly` address deployed on a chain.
 *
 * The per-chain address is used rather than the package's `defaultAddress`, which the package
 * itself documents as an obsolete alias for the chain-1 address: chains that enforce EIP-155
 * replay protection carry a different deployment, so the default is wrong for them.
 */
export function resolveMultiSendCallOnly(query: MultiSendDeploymentQuery): Address {
  const version = query.version ?? DEFAULT_MULTI_SEND_VERSION;
  const network = String(query.chainId);
  const deployment = getMultiSendCallOnlyDeployment({ version, network });

  if (deployment === undefined) {
    throw new Error(
      `no MultiSendCallOnly ${version} deployment is recorded for chain ${network}, so a batched ` +
        'file cannot be wrapped for this chain',
    );
  }
  if (deployment.version !== version) {
    throw new Error(
      `requested MultiSendCallOnly ${version} but the deployment registry matched ${deployment.version}; ` +
        'the version must be an exact release, not a range',
    );
  }

  const address = deployment.networkAddresses[network];
  if (address === undefined) {
    throw new Error(`no MultiSendCallOnly ${version} address is recorded for chain ${network}`);
  }
  return getAddress(address);
}
