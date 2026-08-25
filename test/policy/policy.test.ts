import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pad, type Hex } from 'viem';
import { evaluateFindings, policeFindings } from '../../src/policy/evaluate.js';
import { loadPolicy, parsePolicy } from '../../src/policy/load.js';
import { DEFAULT_POLICY, PolicyError, type Policy } from '../../src/policy/schema.js';
import type { Finding, FindingField, FindingValue } from '../../src/statediff/findings.js';

/**
 * The policy layer over stated findings: no chain, no Anvil, no execution.
 *
 * The cases that matter are the ones where a permissive answer would be reassuring and wrong,   a
 * write nobody can name, and a threshold that fell rather than rose.
 */

const SLOT: Hex = pad('0x04', { size: 32 });

function finding(field: FindingField, before: FindingValue, after: FindingValue): Finding {
  return { field, slot: SLOT, before, after };
}

function withPolicy(text: string): Policy {
  return parsePolicy(text, 'test-policy.yml');
}

test('a threshold decrease fails while an increase warns, under a policy that says so', () => {
  const policy = withPolicy(`
protected_state:
  threshold_decrease: fail
  threshold_increase: warn
`);

  assert.equal(evaluateFindings([finding('threshold', 4, 1)], policy), 'FAIL');
  assert.equal(evaluateFindings([finding('threshold', 2, 5)], policy), 'WARN');
});

test('the dispositions can be swapped, so the direction is read and not assumed', () => {
  const policy = withPolicy(`
protected_state:
  threshold_decrease: warn
  threshold_increase: fail
`);

  assert.equal(evaluateFindings([finding('threshold', 4, 1)], policy), 'WARN');
  assert.equal(evaluateFindings([finding('threshold', 2, 5)], policy), 'FAIL');
});

test('a threshold neither side can be read as a number takes the more severe of the two rules', () => {
  const raw = pad('0xffffffffffffffffffffffffffffffffffffffffff', { size: 32 });
  const policy = withPolicy(`
protected_state:
  threshold_decrease: warn
  threshold_increase: fail
`);

  assert.equal(evaluateFindings([finding('threshold', 2, raw)], policy), 'FAIL');
});

test('the highest severity among several findings is the verdict', () => {
  const policy = withPolicy(`
protected_state:
  modules: warn
  guard: warn
  singleton: fail
  nonce: report
`);

  const findings = [
    finding('modules', [], ['0x00000000000000000000000000000000000000aa']),
    finding('guard', '0x0', '0x1'),
    finding('nonce', 0, 1),
  ];
  assert.equal(evaluateFindings(findings, policy), 'WARN');
  assert.equal(
    evaluateFindings([...findings, finding('singleton', '0xa', '0xb')], policy),
    'FAIL',
  );
});

test('an empty finding list under any policy is a pass', () => {
  assert.equal(evaluateFindings([], DEFAULT_POLICY), 'PASS');
});

test('a nonce-only diff does not by itself produce a failure', () => {
  assert.equal(evaluateFindings([finding('nonce', 41, 42)], DEFAULT_POLICY), 'PASS');
});

test('the nonce cannot be made to fail, because every executed transaction increments it', () => {
  for (const disposition of ['fail', 'warn']) {
    assert.throws(
      () => withPolicy(`protected_state:\n  nonce: ${disposition}\n`),
      (error: unknown) => error instanceof PolicyError && error.message.includes('oracle'),
      `nonce: ${disposition} must be rejected`,
    );
  }
  assert.equal(withPolicy('protected_state:\n  nonce: pass\n').protectedState.nonce, 'pass');
});

test('an unrecognised write fails by default, without any policy file saying so', () => {
  const unrecognised = finding('unrecognised', pad('0x0', { size: 32 }), pad('0x2a', { size: 32 }));
  assert.equal(DEFAULT_POLICY.protectedState.unrecognised, 'fail');
  assert.equal(evaluateFindings([unrecognised], DEFAULT_POLICY), 'FAIL');
  assert.equal(
    evaluateFindings([unrecognised], withPolicy('protected_state:\n  owners: fail\n')),
    'FAIL',
  );
});

test('a policy states only what it changes; every other field keeps its default', () => {
  const policy = withPolicy('protected_state:\n  modules: fail\n');
  assert.equal(policy.protectedState.modules, 'fail');
  assert.equal(policy.protectedState.singleton, DEFAULT_POLICY.protectedState.singleton);
  assert.equal(policy.protectedState.unrecognised, 'fail');
});

test('each finding carries the rule that judged it, so a report can say why', () => {
  const policed = policeFindings(
    [finding('threshold', 4, 1), finding('ownerCount', 7, 8)],
    DEFAULT_POLICY,
  );
  assert.deepEqual(
    policed.map((entry) => [entry.rule, entry.disposition]),
    [
      ['threshold_decrease', 'fail'],
      ['owner_count', 'fail'],
    ],
  );
});

test('an unknown key is rejected rather than ignored', () => {
  const cases: [string, string][] = [
    ['protected_state:\n  fallbackhandler: warn\n', 'not a protected field'],
    ['protected_state:\n  threshold: fail\n', 'not a protected field'],
    ['protected_state:\n  owners: fail\nexecution:\n  fail_on_inconclusive: true\n', 'unknown top-level'],
  ];
  for (const [text, fragment] of cases) {
    assert.throws(
      () => withPolicy(text),
      (error: unknown) => error instanceof PolicyError && error.message.includes(fragment),
      `expected '${fragment}' for ${text}`,
    );
  }
});

test('a malformed document is rejected with a message naming the file', () => {
  const cases: [string, string][] = [
    ['protected_state:\n  owners: block\n', 'must be one of'],
    ['protected_state:\n  owners:\n    - fail\n', 'must be one of'],
    ['protected_state: fail\n', 'must be a mapping'],
    ['owners: fail\n', 'unknown top-level'],
    ['', 'the file is empty'],
    ['protected_state:\n  owners: "fail\n', 'not valid YAML'],
    ['- owners\n', 'must be a mapping'],
  ];
  for (const [text, fragment] of cases) {
    assert.throws(
      () => withPolicy(text),
      (error: unknown) =>
        error instanceof PolicyError &&
        error.message.includes(fragment) &&
        error.message.startsWith('test-policy.yml'),
      `expected '${fragment}' for ${JSON.stringify(text)}`,
    );
  }
});

test('a policy is read from disk, and a missing file says so', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'safe-policy-'));
  const path = join(directory, 'safe-policy.yml');
  await writeFile(path, 'protected_state:\n  threshold_increase: pass\n', 'utf8');

  const policy = await loadPolicy(path);
  assert.equal(policy.protectedState.threshold_increase, 'pass');
  assert.equal(evaluateFindings([finding('threshold', 2, 3)], policy), 'PASS');

  await assert.rejects(
    loadPolicy(join(directory, 'absent.yml')),
    (error: unknown) =>
      error instanceof PolicyError && error.message.includes('could not read the policy file'),
  );
});
