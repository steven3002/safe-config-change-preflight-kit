import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, toBytes, type Address } from 'viem';
import {
  computeSafeTxHash,
  DOMAIN_SEPARATOR_TYPEHASH,
  encodeGetTransactionHashCall,
  identifySafeDomainVariant,
  LEGACY_DOMAIN_SEPARATOR_TYPEHASH,
  safeDomainSeparator,
  SAFE_TX_TYPEHASH,
} from '../../src/safe/transaction-hash.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';

const FORK_SAFE: Address = '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6';

/** Selector confirmed with `cast sig "changeThreshold(uint256)"`. */
const CHANGE_THRESHOLD_1 =
  '0x694e80c30000000000000000000000000000000000000000000000000000000000000001';

const CHANGE_THRESHOLD = withoutGasRefund({
  to: FORK_SAFE,
  value: 0n,
  data: CHANGE_THRESHOLD_1,
  operation: Operation.Call,
});

const DOMAIN = { safeAddress: FORK_SAFE, chainId: 1 };

test('each typehash is the keccak of the type string Safe declares', () => {
  assert.equal(
    keccak256(
      toBytes(
        'SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)',
      ),
    ),
    SAFE_TX_TYPEHASH,
  );
  assert.equal(
    keccak256(toBytes('EIP712Domain(uint256 chainId,address verifyingContract)')),
    DOMAIN_SEPARATOR_TYPEHASH,
  );
  assert.equal(
    keccak256(toBytes('EIP712Domain(address verifyingContract)')),
    LEGACY_DOMAIN_SEPARATOR_TYPEHASH,
  );
});

/**
 * Both values were read from mainnet Safe `0xe57012ae…` (v1.3.0) over `eth_call`: `domainSeparator()`
 * and `getTransactionHash(...)` for this exact transaction at nonce 0.
 */
test('the computed hash matches what the live v1.3.0 Safe reports', () => {
  assert.equal(
    safeDomainSeparator(DOMAIN),
    '0xeb27cc73fc8bbc29388b0b60caaddec38f97952e492b4d1ea18feb830c99ea12',
  );
  assert.equal(
    computeSafeTxHash(DOMAIN, CHANGE_THRESHOLD, 0n),
    '0x0f11a190718e12a03b427716353a57747a5714aa06853fefd3d2da5f6b255600',
  );
});

test('the pre-1.3.0 domain produces a different hash and is not silently substituted', () => {
  const modern = computeSafeTxHash(DOMAIN, CHANGE_THRESHOLD, 0n);
  const legacy = computeSafeTxHash(DOMAIN, CHANGE_THRESHOLD, 0n, 'legacy');
  assert.notEqual(modern, legacy);

  assert.equal(identifySafeDomainVariant(DOMAIN, CHANGE_THRESHOLD, 0n, modern), 'chain-id');
  assert.equal(identifySafeDomainVariant(DOMAIN, CHANGE_THRESHOLD, 0n, legacy), 'legacy');
});

test('a hash neither domain accounts for is reported as unexplained, not guessed at', () => {
  assert.equal(
    identifySafeDomainVariant(DOMAIN, CHANGE_THRESHOLD, 0n, `0x${'11'.repeat(32)}`),
    undefined,
  );
});

test('the legacy domain ignores the chain id, so the same Safe signs identically everywhere', () => {
  assert.equal(
    safeDomainSeparator(DOMAIN, 'legacy'),
    safeDomainSeparator({ safeAddress: FORK_SAFE, chainId: 137 }, 'legacy'),
  );
  assert.notEqual(
    safeDomainSeparator(DOMAIN),
    safeDomainSeparator({ safeAddress: FORK_SAFE, chainId: 137 }),
  );
});

test('the nonce is part of the signed struct', () => {
  assert.notEqual(
    computeSafeTxHash(DOMAIN, CHANGE_THRESHOLD, 0n),
    computeSafeTxHash(DOMAIN, CHANGE_THRESHOLD, 4n),
  );
});

/** `cast sig "getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256)"`. */
test('the cross-check call carries the getTransactionHash selector', () => {
  assert.equal(encodeGetTransactionHashCall(CHANGE_THRESHOLD, 0n).slice(0, 10), '0xd8d11f78');
});
