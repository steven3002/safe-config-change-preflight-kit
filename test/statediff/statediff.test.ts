import test from 'node:test';
import assert from 'node:assert/strict';
import { getAddress, pad, type Address, type Hex } from 'viem';
import { captureProtectedState, extendCapture } from '../../src/statediff/capture.js';
import { compareCaptures } from '../../src/statediff/compare.js';
import { classifyDeltas, isNonceOnlyDiff } from '../../src/statediff/classify.js';
import { excludeRunnerWrites } from '../../src/statediff/exclusions.js';
import { SENTINEL_ENTRY } from '../../src/safe/sentinel-list.js';
import {
  approvedHashSlot,
  fixedSlot,
  moduleLinkSlot,
  ownerLinkSlot,
} from '../../src/safe/slot-derivation.js';
import { SafeStorageSlot, TRANSACTION_GUARD_SLOT } from '../../src/safe/storage-layout.js';
import type { Finding } from '../../src/statediff/findings.js';
import { ZERO_WORD } from '../../src/execution/storage-reader.js';
import { FakeSafe, addressWord, word } from './fake-safe.js';

/**
 * The state-diff layer over a Safe whose storage is stated outright.
 *
 * Every one of these cases is reachable on a real chain, but stating the storage lets the broken
 * ones,  a truncated owner list, a cycle, a count that disagrees with the links,  be produced
 * exactly, which is what an attacker leaves behind and what a live fixture cannot easily make.
 */

const OWNER_A: Address = '0x1111111111111111111111111111111111111111';
const OWNER_B: Address = '0x2222222222222222222222222222222222222222';
const OWNER_C: Address = '0x3333333333333333333333333333333333333333';
const MODULE: Address = '0x00000000000000000000000000000000000000aa';
const ATTACKER: Address = '0x00000000000000000000000000000000000000ba';

const SINGLETON_SLOT = fixedSlot(SafeStorageSlot.singleton);
const THRESHOLD_SLOT = fixedSlot(SafeStorageSlot.threshold);
const NONCE_SLOT = fixedSlot(SafeStorageSlot.nonce);
const SAFE_TX_HASH: Hex = pad('0xabcd', { size: 32 });

/** Capture, mutate, capture, seal the union, diff and classify,  sections 3.4 through 3.9. */
async function diff(
  safe: FakeSafe,
  mutate: () => void,
  options: { readonly writtenSlots?: readonly Hex[]; } = {},
): Promise<Finding[]> {
  const reader = safe.reader();
  safe.mine();
  const before = await captureProtectedState(reader);

  mutate();
  safe.mine();

  const after = await captureProtectedState(reader, {
    additionalSlots: [...before.slots.keys()],
  });
  const sealed = await extendCapture(reader, before, after.slots.keys());
  const deltas = excludeRunnerWrites(
    compareCaptures(sealed, after),
    options.writtenSlots ?? [],
  );

  return classifyDeltas({ before: sealed, after, deltas, safeTxHash: SAFE_TX_HASH });
}

function find(findings: readonly Finding[], field: Finding['field']): Finding {
  const found = findings.find((finding) => finding.field === field);
  assert.ok(found !== undefined, `no ${field} finding in ${JSON.stringify(findings)}`);
  return found;
}

test('a singleton overwrite classifies as singleton with both addresses decoded', async () => {
  const safe = new FakeSafe([OWNER_A, OWNER_B], 2);
  safe.write(SINGLETON_SLOT, addressWord('0x41675C099F32341bf84BFc5382aF534df5C7461a'));

  const findings = await diff(safe, () => {
    safe.write(SINGLETON_SLOT, addressWord(ATTACKER));
  });

  assert.deepEqual(find(findings, 'singleton'), {
    field: 'singleton',
    slot: SINGLETON_SLOT,
    before: '0x41675C099F32341bf84BFc5382aF534df5C7461a',
    after: getAddress(ATTACKER),
    detail: 'singleton (masterCopy)',
  });
});

test('a threshold change classifies with numeric before and after values', async () => {
  const safe = new FakeSafe([OWNER_A, OWNER_B, OWNER_C], 3);

  const findings = await diff(safe, () => {
    safe.write(THRESHOLD_SLOT, word(1n));
  });

  const threshold = find(findings, 'threshold');
  assert.equal(threshold.before, 3);
  assert.equal(threshold.after, 1);
});

/**
 * The case a diff built from the baseline slot set cannot see. The link slot an added owner is
 * written to does not exist before the transaction, so it is absent from the earlier walk and a
 * capture that re-reads only the earlier walk's slots reports nothing at all.
 */
test('an added owner classifies as an owner-set change listing the added address', async () => {
  const safe = new FakeSafe([OWNER_A, OWNER_B], 2);

  const findings = await diff(safe, () => {
    safe.setOwners([OWNER_C, OWNER_A, OWNER_B]);
  });

  const owners = find(findings, 'owners');
  assert.deepEqual(owners.before, [OWNER_A, OWNER_B]);
  assert.deepEqual(owners.after, [OWNER_C, OWNER_A, OWNER_B]);
  assert.equal(owners.detail, `added ${OWNER_C}`);
  assert.equal(owners.slot, fixedSlot(SafeStorageSlot.owners));
  assert.ok(
    !findings.some((finding) => finding.slot === ownerLinkSlot(OWNER_C)),
    'an owner change must render as a set change, not as raw link writes',
  );
});

test('a removed owner classifies as an owner-set change listing the removed address', async () => {
  const safe = new FakeSafe([OWNER_A, OWNER_B, OWNER_C], 2);

  const findings = await diff(safe, () => {
    safe.setOwners([OWNER_A, OWNER_C]);
  });

  const owners = find(findings, 'owners');
  assert.deepEqual(owners.after, [OWNER_A, OWNER_C]);
  assert.equal(owners.detail, `removed ${OWNER_B}`);
});

/** The module list's counterpart of the trap above: an enabled module writes a slot nothing listed. */
test('an enabled module classifies as a module-set change listing the added module', async () => {
  const safe = new FakeSafe([OWNER_A], 1);

  const findings = await diff(safe, () => {
    safe.setModules([MODULE]);
  });

  const modules = find(findings, 'modules');
  assert.deepEqual(modules.before, []);
  assert.deepEqual(modules.after, [getAddress(MODULE)]);
  assert.equal(modules.detail, `added ${getAddress(MODULE)}`);
});

test('an unknown slot classifies as unrecognised rather than being dropped', async () => {
  const safe = new FakeSafe([OWNER_A], 1);
  const unknown: Hex = pad('0xdeadbeef', { size: 32 });

  const findings = await diff(safe, () => {
    safe.write(unknown, word(7n));
  });

  const unrecognised = find(findings, 'unrecognised');
  assert.equal(unrecognised.slot, unknown);
  assert.equal(unrecognised.before, ZERO_WORD);
  assert.equal(unrecognised.after, word(7n));
});

test('the runner-written approval slots are excluded and nothing wider is', async () => {
  const safe = new FakeSafe([OWNER_A, OWNER_B], 2);
  const runnerSlots = [OWNER_A, OWNER_B].map((owner) => approvedHashSlot(owner, SAFE_TX_HASH));
  const byTheTransaction = approvedHashSlot(OWNER_C, SAFE_TX_HASH);

  const findings = await diff(
    safe,
    () => {
      for (const slot of runnerSlots) safe.write(slot, word(1n));
      safe.write(byTheTransaction, word(1n));
    },
    { writtenSlots: runnerSlots },
  );

  assert.ok(
    !findings.some((finding) => runnerSlots.includes(finding.slot)),
    "the runner's own writes must not be reported as the transaction's",
  );
  const approval = findings.find((finding) => finding.slot === byTheTransaction);
  assert.ok(approval !== undefined, 'an approveHash by the transaction under test must survive');
  assert.equal(approval.after, word(1n));
});

/**
 * The reason the exclusion is scoped to the slot *and* the value the runner wrote: a transaction
 * that overwrites one of those entries with something else has changed protected state.
 */
test('a runner-written slot overwritten with another value is not excluded', async () => {
  const safe = new FakeSafe([OWNER_A], 1);
  const runnerSlot = approvedHashSlot(OWNER_A, SAFE_TX_HASH);

  const findings = await diff(
    safe,
    () => {
      safe.write(runnerSlot, word(99n));
    },
    { writtenSlots: [runnerSlot] },
  );

  const kept = findings.find((finding) => finding.slot === runnerSlot);
  assert.ok(kept !== undefined);
  assert.equal(kept.after, word(99n));
});

test('a nonce-only diff is distinguishable in the returned data', async () => {
  const safe = new FakeSafe([OWNER_A], 1);

  const findings = await diff(safe, () => {
    safe.write(NONCE_SLOT, word(1n));
  });

  assert.equal(findings.length, 1);
  const nonce = find(findings, 'nonce');
  assert.equal(nonce.before, 0);
  assert.equal(nonce.after, 1);
  assert.equal(isNonceOnlyDiff(findings), true);
});

test('a diff carrying anything besides the nonce is not a nonce-only diff', async () => {
  const safe = new FakeSafe([OWNER_A], 1);

  const findings = await diff(safe, () => {
    safe.write(NONCE_SLOT, word(1n));
    safe.write(THRESHOLD_SLOT, word(2n));
  });

  assert.equal(isNonceOnlyDiff(findings), false);
});

/**
 * `execTransaction` reads the transaction-guard slot on every run to find no guard is set. A diff
 * that treated an unwritten slot as distinct from a zero one would report a guard change every
 * single time,  a false positive on one of the tool's headline detections.
 */
test('a slot that was only read produces no finding', async () => {
  const safe = new FakeSafe([OWNER_A], 1);

  const findings = await diff(safe, () => {
    safe.write(TRANSACTION_GUARD_SLOT, ZERO_WORD);
    safe.write(NONCE_SLOT, word(1n));
  });

  assert.equal(isNonceOnlyDiff(findings), true);
});

test('a guard being set classifies as guard with the address decoded', async () => {
  const safe = new FakeSafe([OWNER_A], 1);

  const findings = await diff(safe, () => {
    safe.write(TRANSACTION_GUARD_SLOT, addressWord(ATTACKER));
  });

  const guard = find(findings, 'guard');
  assert.equal(guard.before, '0x0000000000000000000000000000000000000000');
  assert.equal(guard.after, getAddress(ATTACKER));
});

/** A corrupted list is a finding, not a crash: reconstruction terminates and reports what it saw. */
test('a truncated owner list is reported rather than thrown away', async () => {
  const safe = new FakeSafe([OWNER_A, OWNER_B, OWNER_C], 2);

  const findings = await diff(safe, () => {
    safe.write(ownerLinkSlot(OWNER_B), ZERO_WORD);
  });

  const owners = find(findings, 'owners');
  assert.deepEqual(owners.after, [OWNER_A, OWNER_B]);
  assert.match(owners.detail ?? '', /breaks after 2 entries/u);

  const count = find(findings, 'ownerCount');
  assert.match(count.detail ?? '', /ownerCount reads 3 but the owner list walks to 2 entries/u);
});

test('an owner list that cycles terminates and is reported', async () => {
  const safe = new FakeSafe([OWNER_A, OWNER_B, OWNER_C], 2);

  const findings = await diff(safe, () => {
    safe.write(ownerLinkSlot(OWNER_C), addressWord(OWNER_A));
  });

  const owners = find(findings, 'owners');
  assert.match(owners.detail ?? '', /cycles after 3 entries/u);
});

test('a module list pointed at a cycle terminates and is reported', async () => {
  const safe = new FakeSafe([OWNER_A], 1);
  safe.setModules([MODULE]);

  const findings = await diff(safe, () => {
    safe.write(moduleLinkSlot(MODULE), addressWord(MODULE));
  });

  const modules = find(findings, 'modules');
  assert.match(modules.detail ?? '', /cycles after 1 entries/u);
});

test('comparing captures that do not cover the same slots is refused', async () => {
  const safe = new FakeSafe([OWNER_A], 1);
  const reader = safe.reader();
  safe.mine();
  const before = await captureProtectedState(reader);

  safe.setOwners([OWNER_A, OWNER_B]);
  safe.mine();
  const after = await captureProtectedState(reader);

  assert.throws(
    () => compareCaptures(before, after),
    (error: unknown) =>
      error instanceof Error && error.message.includes('do not cover the same slots'),
  );
});

test('the capture enumerates the sentinel link of both lists', async () => {
  const safe = new FakeSafe([OWNER_A], 1);
  const capture = await captureProtectedState(safe.reader());

  assert.ok(capture.slots.has(ownerLinkSlot(SENTINEL_ENTRY)));
  assert.ok(capture.slots.has(moduleLinkSlot(SENTINEL_ENTRY)));
  assert.deepEqual(capture.owners.entries, [OWNER_A]);
  assert.equal(capture.owners.termination, 'sentinel');
});
