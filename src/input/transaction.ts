import type { Address, Hex } from 'viem';

/**
 * Safe call semantics. `DelegateCall` runs the target's code in the Safe's own storage context,
 * which is how a transaction can rewrite owners or the singleton pointer without presenting any
 * Safe configuration selector.
 */
export const Operation = {
  Call: 0,
  DelegateCall: 1,
} as const;

export type Operation = (typeof Operation)[keyof typeof Operation];

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
