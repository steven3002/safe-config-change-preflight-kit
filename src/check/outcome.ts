import type { PolicyVerdict } from '../policy/evaluate.js';
import type { ExecutionMode } from '../execution/running-safe.js';
import type { Finding } from '../statediff/findings.js';
import type { Address } from 'viem';
import type { Policy } from '../policy/schema.js';

/**
 * The result of one check, in a shape that cannot state "nothing changed" about a run that
 * measured nothing.
 *
 * `INCONCLUSIVE` is not a severity between `WARN` and `FAIL`; it means the check did not complete,
 * and it exists so that "we looked and it is fine" can never be confused with "we could not look".
 * That distinction is carried by the type rather than by discipline: an inconclusive outcome has a
 * `reason` field that is not optional and holds no findings, so a caller cannot construct one that
 * quietly reads as a clean run.
 */

export type Verdict = PolicyVerdict | 'INCONCLUSIVE';

interface OutcomeBase {
  readonly mode: ExecutionMode;
  readonly findings: readonly Finding[];
  readonly safeAddress: Address | undefined;
  readonly policy: Policy | undefined;
}

export interface ConclusiveOutcome extends OutcomeBase {
  readonly verdict: PolicyVerdict;
  /**
   * The transaction executed and left nothing behind but the nonce. Not a clean bill of health:
   * state written and reverted inside a single transaction leaves no trace in storage, so this is
   * reported as its own outcome rather than as an unqualified pass.
   */
  readonly nonceOnly: boolean;
}

export interface InconclusiveOutcome extends OutcomeBase {
  readonly verdict: 'INCONCLUSIVE';
  /** Why the Safe could not be measured, written for whoever has to decide whether to merge. */
  readonly reason: string;
  readonly findings: readonly [];
  readonly nonceOnly: false;
}

export type Outcome = ConclusiveOutcome | InconclusiveOutcome;

export function conclusive(
  mode: ExecutionMode,
  verdict: PolicyVerdict,
  findings: readonly Finding[],
  nonceOnly: boolean,
  safeAddress?: Address,
  policy?: Policy,
): ConclusiveOutcome {
  return { mode, verdict, findings, nonceOnly, safeAddress, policy };
}

/**
 * A run that could not observe the Safe. The reason is required by the type and non-empty by this
 * function, because an inconclusive result whose explanation is missing is indistinguishable, to
 * the person reading it, from a tool that simply failed to say anything.
 */
export function inconclusive(
  mode: ExecutionMode,
  reason: string,
  safeAddress?: Address,
  policy?: Policy,
): InconclusiveOutcome {
  if (reason.trim() === '') {
    throw new Error('an inconclusive outcome must state why the Safe could not be measured');
  }
  return { mode, verdict: 'INCONCLUSIVE', reason, findings: [], nonceOnly: false, safeAddress, policy };
}
