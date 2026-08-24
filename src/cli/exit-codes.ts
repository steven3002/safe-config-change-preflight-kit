import type { Verdict } from '../check/outcome.js';

/**
 * Map a verdict to the process exit code CI reads.
 *
 * `WARN` exits 0 so that a warning does not block a merge; the distinction lives in the report.
 * `INCONCLUSIVE` gets a code of its own so a pipeline can tell "we checked and it is fine" from
 * "we could not check", which must never collapse into the same signal.
 */
export const ExitCode = {
  PASS: 0,
  WARN: 0,
  FAIL: 1,
  INCONCLUSIVE: 2,
} as const satisfies Record<Verdict, number>;

/** Exit code used when the run failed before any verdict could be reached. */
export const USAGE_ERROR_EXIT_CODE = 2;

export function exitCodeFor(verdict: Verdict): number {
  return ExitCode[verdict];
}
