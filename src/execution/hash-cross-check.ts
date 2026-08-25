import { isHex, type Address, type Hex, type PublicClient } from 'viem';
import {
  computeSafeTxHash,
  encodeGetTransactionHashCall,
  identifySafeDomainVariant,
} from '../safe/transaction-hash.js';
import type { SafeTxParameters } from '../safe/transaction-parameters.js';
import { describeFailure } from './failure-reason.js';
import { readNonce } from './safe-state.js';

/**
 * Confirm that the hash computed here is the one the Safe itself checks signatures against.
 *
 * This is the only place the tool asks a Safe a question through its own code, and it is licensed
 * because it measures nothing: it validates this tool's EIP-712 encoding against the deployment in
 * front of it. Everything that feeds a finding is read from raw storage.
 *
 * A disagreement is never worked around. Approving the wrong hash would leave `execTransaction`
 * reverting on signatures, and a hash that "nearly" matches means this tool's model of the
 * deployment is wrong, which is a statement about the check rather than about the transaction.
 */

export interface HashCrossCheckRequest {
  readonly safeAddress: Address;
  readonly chainId: number;
  readonly transaction: SafeTxParameters;
}

export interface MatchedTransactionHash {
  readonly status: 'matched';
  readonly safeTxHash: Hex;
  /** The nonce the hash binds, read from slot 5 rather than supplied. */
  readonly nonce: bigint;
}

export interface UnmatchedTransactionHash {
  readonly status: 'failed';
  /** `mismatch`: the Safe hashes it differently. `unreadable`: the Safe would not answer. */
  readonly failure: 'mismatch' | 'unreadable';
  readonly reason: string;
}

export type HashCrossCheck = MatchedTransactionHash | UnmatchedTransactionHash;

export async function crossCheckTransactionHash(
  reader: PublicClient,
  request: HashCrossCheckRequest,
): Promise<HashCrossCheck> {
  const { safeAddress, chainId, transaction } = request;

  let nonce: bigint;
  let reported: Hex;
  try {
    nonce = await readNonce(reader, safeAddress);
    reported = await callGetTransactionHash(reader, safeAddress, transaction, nonce);
  } catch (cause) {
    return {
      status: 'failed',
      failure: 'unreadable',
      reason: `the Safe at ${safeAddress} did not report a transaction hash to check ours ` +
        `against: ${describeFailure(cause)}`,
    };
  }

  const computed = computeSafeTxHash({ safeAddress, chainId }, transaction, nonce);
  if (computed.toLowerCase() === reported.toLowerCase()) {
    return { status: 'matched', safeTxHash: computed, nonce };
  }

  return {
    status: 'failed',
    failure: 'mismatch',
    reason: explainMismatch({ safeAddress, chainId }, transaction, nonce, computed, reported),
  };
}

async function callGetTransactionHash(
  reader: PublicClient,
  safeAddress: Address,
  transaction: SafeTxParameters,
  nonce: bigint,
): Promise<Hex> {
  const { data } = await reader.call({
    to: safeAddress,
    data: encodeGetTransactionHashCall(transaction, nonce),
  });
  if (!isHex(data) || data.length !== 66) {
    throw new Error(`getTransactionHash returned ${data ?? 'nothing'} rather than a 32-byte hash`);
  }
  return data;
}

/**
 * Name the cause when one is identifiable. A Safe at v1.2.0 or earlier hashes with a domain that
 * binds no chain id, which is the one mismatch with a known explanation; saying so turns an
 * unexplained inconclusive result into a stated one. It is still not a reason to proceed.
 */
function explainMismatch(
  domain: { readonly safeAddress: Address; readonly chainId: number },
  transaction: SafeTxParameters,
  nonce: bigint,
  computed: Hex,
  reported: Hex,
): string {
  const variant = identifySafeDomainVariant(domain, transaction, nonce, reported);
  const cause =
    variant === 'legacy'
      ? 'it hashes with the pre-1.3.0 domain separator, which binds no chain id, so this ' +
        'deployment is outside the versions this tool has been verified against'
      : 'neither the chain-id nor the legacy EIP-712 domain accounts for the difference';

  return (
    `the Safe at ${domain.safeAddress} reports ${reported} for this transaction at nonce ` +
    `${nonce}, not ${computed}: ${cause}`
  );
}
