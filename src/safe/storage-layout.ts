import type { Hex } from 'viem';

/**
 * The Safe contract's storage map: the fixed slots the singleton declares in order, and the three
 * slots held at hashed addresses outside that sequence.
 *
 * Every value here is read from Safe's own source rather than inferred. Getting one wrong does not
 * crash anything,   it produces a plausible slot that quietly makes every reported diff wrong.
 */

/**
 * Declaration order of `contracts/libraries/SafeStorage.sol`, which the singleton and every library
 * delegatecalled by a Safe share. The order `nonce` -> `_deprecatedDomainSeparator` ->
 * `signedMessages` -> `approvedHashes` is identical in v1.1.1, v1.2.0, v1.3.0, v1.4.1 and v1.5.0,
 * so slot 8 is stable across the whole version range this tool may meet.
 */
export const SafeStorageSlot = {
  /** The implementation the proxy delegatecalls into; the slot the Bybit attack overwrote. */
  singleton: 0n,
  /** `mapping(address => address)`,   the sentinel-terminated module linked list. */
  modules: 1n,
  /** `mapping(address => address)`,   the sentinel-terminated owner linked list. */
  owners: 2n,
  ownerCount: 3n,
  threshold: 4n,
  nonce: 5n,
  /**
   * Written by v1.1.1 and v1.2.0 at setup and unused from v1.3.0 onward, where the domain separator
   * is recomputed on demand. Retained so the layout stays stable across an upgrade.
   */
  deprecatedDomainSeparator: 6n,
  /** `mapping(bytes32 => uint256)`. */
  signedMessages: 7n,
  /** `mapping(address => mapping(bytes32 => uint256))`,   how this tool satisfies signatures. */
  approvedHashes: 8n,
} as const;

export type SafeStorageField = keyof typeof SafeStorageSlot;

/**
 * `keccak256("fallback_manager.handler.address")`, matching `FALLBACK_HANDLER_STORAGE_SLOT` in
 * `contracts/base/FallbackManager.sol`.
 */
export const FALLBACK_HANDLER_SLOT: Hex =
  '0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5';

/**
 * `keccak256("guard_manager.guard.address")`, matching `GUARD_STORAGE_SLOT` in
 * `contracts/base/GuardManager.sol`.
 */
export const TRANSACTION_GUARD_SLOT: Hex =
  '0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8';

/**
 * `keccak256("module_manager.module_guard.address")`, matching `MODULE_GUARD_STORAGE_SLOT` in
 * `contracts/base/ModuleManager.sol`.
 *
 * The preimage is `module_manager.module_guard.address`, not `module_guard.guard.address`. The
 * second reads just as plausibly and hashes to
 * `0x5138944402b93afc8ee9ca0568d4180777bccac088f595e33c67e41e181501fe`, which is not this slot.
 */
export const MODULE_GUARD_SLOT: Hex =
  '0xb104e0b93118902c651344349b610029d694cfdec91c589c91ebafbcd0289947';

/** The preimages the three slots above hash from, kept so a test can rederive rather than retype. */
export const DERIVED_SLOT_PREIMAGES = {
  fallbackHandler: 'fallback_manager.handler.address',
  transactionGuard: 'guard_manager.guard.address',
  moduleGuard: 'module_manager.module_guard.address',
} as const;
