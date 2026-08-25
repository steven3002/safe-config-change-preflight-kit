import test from 'node:test';
import assert from 'node:assert/strict';
import { conclusive, inconclusive, type Outcome } from '../../src/check/outcome.js';
import { exitCodeFor } from '../../src/cli/exit-codes.js';

/**
 * The shape of an outcome, which is where the project's central failure mode is made
 * unrepresentable: a run that could not observe the Safe must never be able to say that the Safe is
 * unchanged.
 */

test('an inconclusive outcome cannot be built without a reason', () => {
  for (const empty of ['', '   ', '\n']) {
    assert.throws(
      () => inconclusive('local', empty),
      (error: unknown) => error instanceof Error && error.message.includes('must state why'),
    );
  }
});

test('the type itself requires the reason, so the check is not merely a runtime one', () => {
  // @ts-expect-error an INCONCLUSIVE outcome without a reason does not typecheck
  const impossible: Outcome = { verdict: 'INCONCLUSIVE', mode: 'local', findings: [], nonceOnly: false };
  assert.equal(impossible.verdict, 'INCONCLUSIVE');
});

test('an inconclusive outcome carries no findings, so nothing can read it as a clean run', () => {
  const outcome = inconclusive('fork', 'the node stopped answering');
  assert.deepEqual(outcome.findings, []);
  assert.equal(outcome.nonceOnly, false);
  assert.equal(exitCodeFor(outcome.verdict), 2);
});

test('a conclusive outcome exits by its verdict', () => {
  assert.equal(exitCodeFor(conclusive('local', 'PASS', [], true).verdict), 0);
  assert.equal(exitCodeFor(conclusive('local', 'WARN', [], false).verdict), 0);
  assert.equal(exitCodeFor(conclusive('local', 'FAIL', [], false).verdict), 1);
});
