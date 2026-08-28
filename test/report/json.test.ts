import test from 'node:test';
import assert from 'node:assert/strict';
import { renderJsonReport, type JsonReport } from '../../src/report/json.js';
import { conclusive, inconclusive } from '../../src/check/outcome.js';
import { DEFAULT_POLICY } from '../../src/policy/schema.js';

test('json report', async (t) => {
  await t.test('keys match exactly for conclusive', () => {
    const outcome = conclusive('fork', 'FAIL', [
      { field: 'threshold', slot: '0x123', before: 2, after: 1, detail: 'decreased' }
    ], false, '0x1234', DEFAULT_POLICY);
    const json = JSON.parse(renderJsonReport(outcome)) as JsonReport;
    
    // Assert keys
    assert.deepEqual(Object.keys(json).sort(), ['findings', 'mode', 'nonceOnly', 'safeAddress', 'verdict']);
    
    const findings = json.findings ?? [];
    assert.equal(findings.length, 1);
    const finding = findings[0] as import('../../src/report/json.js').JsonFinding;
    assert.deepEqual(Object.keys(finding).sort(), ['after', 'before', 'detail', 'disposition', 'field', 'rule', 'slot']);
    
    assert.equal(json.verdict, 'FAIL');
    assert.equal(finding.field, 'threshold');
    assert.equal(finding.disposition, 'fail');
    assert.equal(finding.rule, 'threshold_decrease');
  });

  await t.test('keys match exactly for inconclusive', () => {
    const outcome = inconclusive('local', 'failed to connect', '0x1234', DEFAULT_POLICY);
    const json = JSON.parse(renderJsonReport(outcome)) as JsonReport;
    
    assert.deepEqual(Object.keys(json).sort(), ['findings', 'mode', 'nonceOnly', 'reason', 'safeAddress', 'verdict']);
    assert.equal(json.verdict, 'INCONCLUSIVE');
    assert.equal(json.reason, 'failed to connect');
    assert.equal(json.findings?.length, 0);
  });
});
