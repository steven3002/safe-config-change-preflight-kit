import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAddress, type Address } from 'viem';
import { checkAgainstSafe, runCheck } from '../../src/check/run-check.js';
import type { Outcome } from '../../src/check/outcome.js';
import { startLocalSafe } from '../../src/execution/local-mode.js';
import type { SafeSession } from '../../src/execution/running-safe.js';
import { loadSafeTransaction } from '../../src/input/tx-builder.js';
import type { SafeTransaction } from '../../src/input/transaction.js';
import { DEFAULT_POLICY } from '../../src/policy/schema.js';
import { Operation } from '../../src/safe/transaction-parameters.js';
import { resolveMultiSendCallOnly } from '../../src/safe/multisend.js';
import { etch, ownerSetRewrite, REVERTING_RUNTIME, singletonOverwrite } from './attacker.js';
import { describeOutcome as describe, fixture } from './fixtures.js';

/**
 * The pipeline end to end against a locally deployed Safe v1.4.1: the three fixtures, and every
 * path that fails to measure the Safe.
 *
 * The failure cases are the point. Each of them produces no diff, and an empty diff handed to a
 * policy evaluates to `PASS`,   so the property under test is that none of them ever reaches a
 * verdict at all.
 */

const IMPOSTOR_SINGLETON: Address = '0x00000000000000000000000000000000000000cc';
const ATTACKER: Address = '0x00000000000000000000000000000000000000BA';

async function withLocalSafe(body: (session: SafeSession) => Promise<void>): Promise<void> {
  const session = await startLocalSafe();
  try {
    await body(session);
  } finally {
    await session.stop();
  }
}

/** A run that measured nothing must never present as one that measured no change. */
function assertNotAPass(outcome: Outcome, fragment: string): void {
  assert.equal(outcome.verdict, 'INCONCLUSIVE', describe(outcome));
  assert.deepEqual(outcome.findings, []);
  assert.notEqual(outcome.reason.trim(), '', 'an inconclusive run must say why');
  assert.ok(
    outcome.reason.includes(fragment),
    `expected '${fragment}' in: ${describe(outcome)}`,
  );
}

test('the benign fixture passes, having changed nothing but the nonce', async () => {
  const outcome = await runCheck({
    filePath: fixture('benign.json'),
    operation: Operation.Call,
    mode: 'local',
  });

  assert.equal(outcome.verdict, 'PASS', describe(outcome));
  assert.equal(outcome.nonceOnly, true, describe(outcome));
  assert.deepEqual(
    outcome.findings.map((finding) => finding.finding.field),
    ['nonce'],
  );
});

test('the masterCopy fixture fails, and the finding names the impostor', async () => {
  await withLocalSafe(async (session) => {
    const transaction = await loadSafeTransaction(fixture('mastercopy-overwrite.json'), {
      operation: Operation.DelegateCall,
    });
    await etch(session, transaction.to, singletonOverwrite(IMPOSTOR_SINGLETON));

    const outcome = await checkAgainstSafe(session, { transaction, policy: DEFAULT_POLICY });
    assert.equal(outcome.verdict, 'FAIL', describe(outcome));
    assert.equal(outcome.nonceOnly, false);

    const singleton = outcome.findings.find((finding) => finding.finding.field === 'singleton');
    assert.ok(singleton, describe(outcome));
    assert.equal(singleton.finding.after, getAddress(IMPOSTOR_SINGLETON));
  });
});

test('the owner-rewrite fixture fails, reporting the new owner set and the fallen threshold', async () => {
  await withLocalSafe(async (session) => {
    const transaction = await loadSafeTransaction(fixture('owner-threshold-rewrite.json'), {
      operation: Operation.DelegateCall,
    });
    await etch(session, transaction.to, ownerSetRewrite(ATTACKER));

    const outcome = await checkAgainstSafe(session, { transaction, policy: DEFAULT_POLICY });
    assert.equal(outcome.verdict, 'FAIL', describe(outcome));

    const owners = outcome.findings.find((finding) => finding.finding.field === 'owners');
    assert.ok(owners, describe(outcome));
    assert.deepEqual(owners.finding.after, [getAddress(ATTACKER)]);

    const threshold = outcome.findings.find((finding) => finding.finding.field === 'threshold');
    assert.ok(threshold, describe(outcome));
    assert.equal(threshold.finding.before, 2);
    assert.equal(threshold.finding.after, 1);
  });
});

/**
 * Without this the shipped adversarial fixtures pass: a delegatecall to an address holding no code
 * succeeds and changes nothing, so the run reports a clean Safe having executed nothing at all.
 */
test('a delegatecall to an address holding no code is inconclusive, never a pass', async () => {
  assertNotAPass(
    await runCheck({
      filePath: fixture('mastercopy-overwrite.json'),
      operation: Operation.DelegateCall,
      mode: 'local',
    }),
    'holds no code on the chain this check ran against',
  );
});

test('a transaction that reverted is inconclusive, never a pass', async () => {
  await withLocalSafe(async (session) => {
    await etch(session, ATTACKER, REVERTING_RUNTIME);
    const outcome = await checkAgainstSafe(session, {
      transaction: {
        to: ATTACKER,
        value: 0n,
        data: '0x',
        operation: Operation.Call,
        safeAddress: session.safe.safeAddress,
        chainId: session.safe.chainId,
      },
      policy: DEFAULT_POLICY,
    });

    assertNotAPass(outcome, 'did not execute');
  });
});

test('a chain that stopped answering is inconclusive, never a pass', async () => {
  const session = await startLocalSafe();
  const transaction: SafeTransaction = {
    to: session.safe.safeAddress,
    value: 0n,
    data: '0x',
    operation: Operation.Call,
    safeAddress: session.safe.safeAddress,
    chainId: session.safe.chainId,
  };
  await session.stop();

  assertNotAPass(await checkAgainstSafe(session, { transaction, policy: DEFAULT_POLICY }), '');
});

test('an address that is not a Safe is inconclusive: nothing cross-checks the hash', async () => {
  await withLocalSafe(async (session) => {
    const notASafe: Address = '0x00000000000000000000000000000000000000c2';
    const outcome = await checkAgainstSafe(
      {
        safe: { ...session.safe, safeAddress: notASafe },
        stop: session.stop,
      },
      {
        transaction: {
          to: notASafe,
          value: 0n,
          data: '0x',
          operation: Operation.Call,
          safeAddress: notASafe,
          chainId: session.safe.chainId,
        },
        policy: DEFAULT_POLICY,
      },
    );

    assertNotAPass(outcome, 'did not report a transaction hash');
  });
});

/**
 * A fork of the wrong chain would cross-check and execute perfectly well, against a Safe on a chain
 * nobody asked about. It is caught before any of that, so this case needs no chain of its own.
 */
test('a fork of a chain the file does not name is inconclusive', async () => {
  const safeAddress: Address = '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6';
  const outcome = await checkAgainstSafe(
    {
      safe: {
        rpcUrl: 'http://127.0.0.1:1',
        safeAddress,
        chainId: 137,
        mode: 'fork',
        threshold: 4,
        owners: [safeAddress],
      },
      stop: () => Promise.resolve(),
    },
    {
      transaction: {
        to: safeAddress,
        value: 0n,
        data: '0x',
        operation: Operation.Call,
        safeAddress,
        chainId: 1,
      },
      policy: DEFAULT_POLICY,
    },
  );

  assertNotAPass(outcome, 'the file declares chain 1 but the fork is chain 137');
});

test('a transaction file that cannot be read is inconclusive before any chain starts', async () => {
  assertNotAPass(
    await runCheck({
      filePath: fixture('nothing-here.json'),
      operation: Operation.Call,
      mode: 'local',
    }),
    'the transaction file could not be read',
  );
});

test('a policy file that cannot be read is inconclusive before any chain starts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'safe-policy-'));
  const path = join(directory, 'safe-policy.yml');
  await writeFile(path, 'protected_state:\n  owner: fail\n', 'utf8');

  assertNotAPass(
    await runCheck({
      filePath: fixture('benign.json'),
      operation: Operation.Call,
      mode: 'local',
      policyPath: path,
    }),
    'the policy could not be read',
  );
});

/**
 * The input layer wraps a batch into a delegatecall to the `MultiSendCallOnly` deployment recorded
 * for the *file's* chain, and local mode hosts that library at whatever address it is told to.
 * Chains enforcing EIP-155 replay protection carry a different deployment from mainnet's, so a file
 * declaring one of them targets an address nothing ever wrote code to.
 *
 * A delegatecall to an address holding no code succeeds and does nothing, so the failure is silent:
 * the batch would appear to execute, change no protected state, and pass. The inner calls here send
 * wei the Safe does not have, so they can only fail   and the batch can only fail with them   if
 * the library actually ran.
 */
test('a batch on a chain whose MultiSend lives elsewhere still executes through the library', async () => {
  const chainId = 10;
  assert.notEqual(
    resolveMultiSendCallOnly({ chainId }),
    resolveMultiSendCallOnly({ chainId: 1 }),
    'this test is only meaningful for a chain whose deployment is not the canonical one',
  );

  const directory = await mkdtemp(join(tmpdir(), 'safe-batch-'));
  const path = join(directory, 'batch.json');
  await writeFile(path, JSON.stringify(unaffordableBatch(chainId)), 'utf8');

  const outcome = await runCheck({
    filePath: path,
    operation: Operation.Call,
    mode: 'local',
    safeAddress: ATTACKER,
  });

  assertNotAPass(outcome, 'did not execute');
});

test('fork mode without an endpoint configured is inconclusive, not a crash', async () => {
  const rpcUrl = process.env['SAFE_STATEDIFF_RPC_URL'];
  delete process.env['SAFE_STATEDIFF_RPC_URL'];
  try {
    assertNotAPass(
      await runCheck({
        filePath: fixture('benign.json'),
        operation: Operation.Call,
        mode: 'fork',
      }),
      'no chain could be started',
    );
  } finally {
    if (rpcUrl !== undefined) process.env['SAFE_STATEDIFF_RPC_URL'] = rpcUrl;
  }
});

/** A batch of value transfers the Safe cannot afford, so executing it at all is observable. */
function unaffordableBatch(chainId: number): unknown {
  return {
    version: '1.0',
    chainId: String(chainId),
    meta: { name: 'unaffordable batch' },
    transactions: [
      { to: IMPOSTOR_SINGLETON, value: '1', data: '0x', contractMethod: null, contractInputsValues: {} },
      { to: ATTACKER, value: '1', data: '0x', contractMethod: null, contractInputsValues: {} },
    ],
  };
}
