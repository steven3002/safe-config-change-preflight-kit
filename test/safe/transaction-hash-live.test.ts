import test from 'node:test';
import assert from 'node:assert/strict';
import { isHex, type Address, type Hex } from 'viem';
import {
  computeSafeTxHash,
  encodeGetTransactionHashCall,
  identifySafeDomainVariant,
} from '../../src/safe/transaction-hash.js';
import { Operation, withoutGasRefund } from '../../src/safe/transaction-parameters.js';
import type { SafeTxParameters } from '../../src/safe/transaction-parameters.js';

/**
 * Cross-check the computed `safeTxHash` against a real Safe's own `getTransactionHash`.
 *
 * A unit test of an encoder against vectors the same encoder produced proves only that it agrees
 * with itself. This asks the contract. It needs one `eth_call` and no Anvil, and the network call
 * lives here rather than in `safe/`, which stays free of I/O.
 *
 * Without an RPC endpoint the test skips and says so, rather than passing quietly.
 */

const RPC_URL = process.env['SAFE_STATEDIFF_RPC_URL'];

/** Mainnet Safe running v1.3.0, whose domain separator therefore binds the chain id. */
const FORK_SAFE: Address = '0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6';
const MAINNET = 1;

const CASES: [string, SafeTxParameters, bigint][] = [
  [
    'changeThreshold(1) as a call',
    withoutGasRefund({
      to: FORK_SAFE,
      value: 0n,
      data: '0x694e80c30000000000000000000000000000000000000000000000000000000000000001',
      operation: Operation.Call,
    }),
    0n,
  ],
  [
    'an empty delegatecall carrying value at a non-zero nonce',
    withoutGasRefund({
      to: '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D',
      value: 10n ** 18n,
      data: '0x',
      operation: Operation.DelegateCall,
    }),
    4n,
  ],
];

async function ethCall(to: Address, data: Hex): Promise<Hex> {
  const response = await fetch(RPC_URL as string, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to, data }, 'latest'],
    }),
  });
  if (!response.ok) {
    throw new Error(`RPC returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error !== undefined) {
    throw new Error(`RPC error: ${body.error.message ?? 'unknown'}`);
  }
  if (!isHex(body.result)) {
    throw new Error(`RPC returned a non-hex result: ${JSON.stringify(body.result)}`);
  }
  return body.result;
}

test(
  'the computed safeTxHash equals getTransactionHash() on a live v1.3.0 Safe',
  {
    skip:
      RPC_URL === undefined
        ? 'set SAFE_STATEDIFF_RPC_URL to cross-check the hash against a live Safe'
        : false,
  },
  async () => {
    const domain = { safeAddress: FORK_SAFE, chainId: MAINNET };

    for (const [description, transaction, nonce] of CASES) {
      const reported = await ethCall(
        FORK_SAFE,
        encodeGetTransactionHashCall(transaction, nonce),
      );

      assert.equal(
        computeSafeTxHash(domain, transaction, nonce),
        reported,
        `computed hash disagrees with the Safe for ${description}`,
      );
      assert.equal(
        identifySafeDomainVariant(domain, transaction, nonce, reported),
        'chain-id',
        `${description} should resolve to the v1.3.0 domain`,
      );
    }
  },
);
