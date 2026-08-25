import type { Address, Hex } from 'viem';

/**
 * Safe's transaction parameter tuple,   the arguments `execTransaction` takes and the fields the
 * EIP-712 `SafeTx` struct hashes,   together with Safe's `Enum.Operation` values.
 */

/**
 * `DelegateCall` runs the target's code in the Safe's own storage context, which is how a
 * transaction can rewrite owners or the singleton pointer without presenting any Safe
 * configuration selector.
 */
export const Operation = {
  Call: 0,
  DelegateCall: 1,
} as const;

export type Operation = (typeof Operation)[keyof typeof Operation];

/**
 * The nine arguments shared by `execTransaction` and `getTransactionHash`. The nonce is deliberately
 * not a member: `execTransaction` reads it from storage rather than accepting it, so carrying it
 * here would invite a caller to believe it is being submitted.
 */
export interface SafeTxParameters {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  readonly operation: Operation;
  readonly safeTxGas: bigint;
  readonly baseGas: bigint;
  readonly gasPrice: bigint;
  readonly gasToken: Address;
  readonly refundReceiver: Address;
}

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * Build the parameter tuple for a transaction that pays no gas refund.
 *
 * The runner never reimburses a relayer, and the Transaction Builder file format carries no fields
 * for the refund parameters, so every transaction this tool executes leaves all five at zero.
 */
export function withoutGasRefund(call: {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
  readonly operation: Operation;
}): SafeTxParameters {
  return {
    to: call.to,
    value: call.value,
    data: call.data,
    operation: call.operation,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
  };
}
