import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toBytes } from 'viem';
import {
  DERIVED_SLOT_PREIMAGES,
  FALLBACK_HANDLER_SLOT,
  MODULE_GUARD_SLOT,
  SafeStorageSlot,
  TRANSACTION_GUARD_SLOT,
} from '../../src/safe/storage-layout.js';

test('the fixed slots follow SafeStorage.sol declaration order', () => {
  assert.deepEqual(SafeStorageSlot, {
    singleton: 0n,
    modules: 1n,
    owners: 2n,
    ownerCount: 3n,
    threshold: 4n,
    nonce: 5n,
    deprecatedDomainSeparator: 6n,
    signedMessages: 7n,
    approvedHashes: 8n,
  });
});

test('each derived slot is the keccak of the preimage it claims', () => {
  assert.equal(
    keccak256(toBytes(DERIVED_SLOT_PREIMAGES.fallbackHandler)),
    FALLBACK_HANDLER_SLOT,
  );
  assert.equal(
    keccak256(toBytes(DERIVED_SLOT_PREIMAGES.transactionGuard)),
    TRANSACTION_GUARD_SLOT,
  );
  assert.equal(keccak256(toBytes(DERIVED_SLOT_PREIMAGES.moduleGuard)), MODULE_GUARD_SLOT);
});

/**
 * `module_guard.guard.address` reads as plausibly as the real preimage and hashes to a different,
 * equally plausible-looking slot. Reading that slot would report a module guard that is always
 * unset, so the wrong constant is pinned here explicitly rather than left to a reviewer's eye.
 */
test('the module guard preimage is the module manager one, not the guard manager one', () => {
  assert.equal(DERIVED_SLOT_PREIMAGES.moduleGuard, 'module_manager.module_guard.address');
  assert.equal(
    keccak256(toBytes('module_guard.guard.address')),
    '0x5138944402b93afc8ee9ca0568d4180777bccac088f595e33c67e41e181501fe',
  );
  assert.notEqual(MODULE_GUARD_SLOT, '0x5138944402b93afc8ee9ca0568d4180777bccac088f595e33c67e41e181501fe');
});
