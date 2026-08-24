import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, size } from 'viem';
import {
  SAFE_PROXY_FACTORY_CREATION_BYTECODE,
  SAFE_PROXY_FACTORY_CREATION_BYTECODE_HASH,
  SAFE_SINGLETON_CREATION_BYTECODE,
  SAFE_SINGLETON_CREATION_BYTECODE_HASH,
} from '../../src/safe/deployment-bytecode.js';
import {
  MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE,
  MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE_HASH,
} from '../../src/safe/multisend-call-only-bytecode.js';

/**
 * Vendored bytecode is the one kind of constant here that no reader can check by eye. Each blob is
 * pinned by its hash and its length, so an accidental edit fails rather than deploying something
 * subtly different from the audited contract.
 */

const VENDORED: [string, `0x${string}`, `0x${string}`, number][] = [
  [
    'MultiSendCallOnly v1.3.0 runtime code',
    MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE,
    MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE_HASH,
    410,
  ],
  [
    'Safe v1.4.1 singleton creation code',
    SAFE_SINGLETON_CREATION_BYTECODE,
    SAFE_SINGLETON_CREATION_BYTECODE_HASH,
    23_620,
  ],
  [
    'SafeProxyFactory v1.4.1 creation code',
    SAFE_PROXY_FACTORY_CREATION_BYTECODE,
    SAFE_PROXY_FACTORY_CREATION_BYTECODE_HASH,
    3_086,
  ],
];

for (const [description, bytecode, expectedHash, expectedSize] of VENDORED) {
  test(`${description} matches its recorded hash and length`, () => {
    assert.equal(size(bytecode), expectedSize);
    assert.equal(keccak256(bytecode), expectedHash);
  });
}
