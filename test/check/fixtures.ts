import { fileURLToPath } from 'node:url';
import type { Outcome } from '../../src/check/outcome.js';

/** Where the shipped fixtures live, and how to print an outcome when an assertion fails. */

export function fixture(name: string): string {
  return fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));
}

export function describeOutcome(outcome: Outcome): string {
  return outcome.verdict === 'INCONCLUSIVE'
    ? `INCONCLUSIVE: ${outcome.reason}`
    : `${outcome.verdict}: ${JSON.stringify(outcome.findings)}`;
}
