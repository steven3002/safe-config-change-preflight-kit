/**
 * The four terminal states a check can reach.
 *
 * `INCONCLUSIVE` is not a severity between `WARN` and `FAIL`; it means the check did not complete,
 * and it exists so that "we looked and it is fine" can never be confused with "we could not look".
 */
export type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'INCONCLUSIVE';
