import type { Address, Hex } from 'viem';
import type { Operation } from '../safe/transaction-parameters.js';

/** The single normalized transaction shape every later stage of the pipeline consumes. */
export interface SafeTransaction {
  /** Target of the call. */
  readonly to: Address;
  /** Native value in wei. */
  readonly value: bigint;
  /** Calldata; `0x` when the transaction carries none. */
  readonly data: Hex;
  readonly operation: Operation;
  /** The Safe the transaction executes against. */
  readonly safeAddress: Address;
  readonly chainId: number;
}
