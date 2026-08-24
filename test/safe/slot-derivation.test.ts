import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvedHashSlot,
  fixedSlot,
  mappingSlot,
  moduleLinkSlot,
  ownerLinkSlot,
} from '../../src/safe/slot-derivation.js';
import { SafeStorageSlot } from '../../src/safe/storage-layout.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const SENTINEL = '0x0000000000000000000000000000000000000001';
const HASH = '0x00000000000000000000000000000000000000000000000000000000000000ff';

/**
 * Vectors produced by `cast index` (foundry 1.7.1), an implementation independent of viem, so a
 * shared misunderstanding of the derivation cannot make these agree.
 */
test('mapping slots match an independently computed keccak', () => {
  assert.equal(
    mappingSlot(OWNER, 2n),
    '0x06bb1b9bc4293ba066a12274418b7ea4df183c2e4e6b39591987369520ca3956',
  );
  assert.equal(
    ownerLinkSlot(SENTINEL),
    '0xe90b7bceb6e7df5418fb78d8ee546e97c83a08bbccc01a0644d599ccd2a7c2e0',
  );
});

test('approvedHashes derives through both mapping levels', () => {
  assert.equal(
    mappingSlot(OWNER, SafeStorageSlot.approvedHashes),
    '0x53af0e871930bcbfa928134de0e9b13cc6c80108fbcb3f83dd5065dcc4143d67',
  );
  assert.equal(
    approvedHashSlot(OWNER, HASH),
    '0x14840ddf58cff748b4b7472a809036789b4a3e1405eabe8c3fc0e52f743ba8cc',
  );
});

test('the owner and module lists are derived from different base slots', () => {
  assert.notEqual(ownerLinkSlot(OWNER), moduleLinkSlot(OWNER));
  assert.equal(ownerLinkSlot(OWNER), mappingSlot(OWNER, SafeStorageSlot.owners));
  assert.equal(moduleLinkSlot(OWNER), mappingSlot(OWNER, SafeStorageSlot.modules));
});

test('a fixed slot index becomes a left-padded 32-byte key', () => {
  assert.equal(
    fixedSlot(SafeStorageSlot.threshold),
    '0x0000000000000000000000000000000000000000000000000000000000000004',
  );
  assert.equal(
    fixedSlot(SafeStorageSlot.singleton),
    '0x0000000000000000000000000000000000000000000000000000000000000000',
  );
});

test('a key wider than a word is rejected rather than silently truncated', () => {
  assert.throws(
    () => mappingSlot(`${HASH}ff`, 2n),
    (error: unknown) => error instanceof Error && error.message.includes('wider than 32 bytes'),
  );
});
