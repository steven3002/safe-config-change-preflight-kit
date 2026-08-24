import test from 'node:test';
import assert from 'node:assert/strict';
import { exitCodeFor } from '../../src/cli/exit-codes.js';
import type { Verdict } from '../../src/check/outcome.js';

test('each verdict maps to its documented exit code', () => {
  const expected: Record<Verdict, number> = {
    PASS: 0,
    WARN: 0,
    FAIL: 1,
    INCONCLUSIVE: 2,
  };
  for (const [verdict, code] of Object.entries(expected)) {
    assert.equal(exitCodeFor(verdict as Verdict), code, `${verdict} should exit ${code}`);
  }
});

test('a warning does not block a merge but an inconclusive run is distinguishable', () => {
  assert.equal(exitCodeFor('WARN'), exitCodeFor('PASS'));
  assert.notEqual(exitCodeFor('INCONCLUSIVE'), exitCodeFor('PASS'));
  assert.notEqual(exitCodeFor('INCONCLUSIVE'), exitCodeFor('FAIL'));
});
