import type { Address } from 'viem';

/**
 * The Safe the rest of the pipeline measures, and the handle that shuts it down.
 *
 * Both execution modes produce the same shape so that nothing downstream branches on which one
 * started the chain. `threshold` and `owners` are read from raw storage rather than from
 * `getThreshold()` and `getOwners()`: on a compromised Safe the view functions are the attacker's
 * code, and this pair is measured state.
 */

export type ExecutionMode = 'fork' | 'local';

export interface RunningSafe {
  readonly rpcUrl: string;
  readonly safeAddress: Address;
  readonly chainId: number;
  readonly mode: ExecutionMode;
  readonly threshold: number;
  readonly owners: readonly Address[];
}

/**
 * A `RunningSafe` together with the lifetime of the chain hosting it. Lifecycle is kept out of the
 * data object so that a consumer holding a `RunningSafe` cannot accidentally own its teardown.
 */
export interface SafeSession {
  readonly safe: RunningSafe;
  /** Terminate the chain. Safe to call more than once. */
  readonly stop: () => Promise<void>;
}
