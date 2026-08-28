import test from 'node:test';
import assert from 'node:assert/strict';
import { renderHumanReport } from '../../src/report/human.js';
import { conclusive, inconclusive } from '../../src/check/outcome.js';
import { DEFAULT_POLICY } from '../../src/policy/schema.js';

test('human report', async (t) => {
  await t.test('renders inconclusive without looking like a pass', () => {
    const outcome = inconclusive('fork', 'Transaction could not be executed', '0x1234');
    const report = renderHumanReport(outcome);
    assert.match(report, /Result: INCONCLUSIVE/);
    assert.match(report, /Reason: Transaction could not be executed/);
    assert.doesNotMatch(report, /PASS/);
  });

  await t.test('renders findings with before and after', () => {
    const outcome = conclusive('fork', 'FAIL', [
      { field: 'threshold', slot: '0x', before: 2, after: 1 }
    ], false, '0x1234', DEFAULT_POLICY);
    const report = renderHumanReport(outcome);
    assert.match(report, /Result: FAIL/);
    assert.match(report, /threshold/);
    assert.match(report, /Before: 2/);
    assert.match(report, /After:  1/);
    assert.match(report, /Policy: FAIL/);
  });

  await t.test('renders nonceOnly outcome distinctly', () => {
    const outcome = conclusive('fork', 'PASS', [], true, '0x1234', DEFAULT_POLICY);
    const report = renderHumanReport(outcome);
    assert.match(report, /executed-with-no-observable-change/);
    assert.match(report, /CAVEAT:/);
    assert.match(report, /Result: PASS/);
  });
});
