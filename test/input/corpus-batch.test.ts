import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodeFunctionData } from 'viem';
import { parseSafeTransaction } from '../../src/input/tx-builder.js';
import { MULTI_SEND_ABI, unpackMultiSendTransactions } from '../../src/safe/multisend.js';
import { Operation } from '../../src/safe/transaction-parameters.js';

/**
 * A real Transaction Builder export, taken verbatim from `BalancerMaxis/multisig-ops`
 * (`BIPs/00batched/2023/2023-W45/1-0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f.json`). Roughly half
 * of that repository's exports carry more than one transaction, so this shape is the common case
 * rather than an edge case, and the file carries the per-transaction `meta` annotations that the
 * repository's own tooling adds ,  fields Safe's format does not define.
 *
 * Tests execute from `dist/`, so the fixture is read from the source tree rather than from a path
 * relative to this compiled file's directory.
 */
const FIXTURE = readFileSync(
  fileURLToPath(new URL('../../../test/input/fixtures/corpus-batch.json', import.meta.url)),
  'utf8',
);

test('a batched export from the real corpus becomes one MultiSendCallOnly delegatecall', () => {
  const transaction = parseSafeTransaction(FIXTURE, { operation: Operation.Call });

  assert.equal(transaction.to, '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D');
  assert.equal(transaction.operation, Operation.DelegateCall);
  assert.equal(transaction.value, 0n);
  assert.equal(transaction.safeAddress, '0x10A19e7eE7d7F8a52822f6817de8ea18204F2e4f');
  assert.equal(transaction.chainId, 1);

  const { args } = decodeFunctionData({ abi: MULTI_SEND_ABI, data: transaction.data });
  const inner = unpackMultiSendTransactions(args[0]);

  const declared = (JSON.parse(FIXTURE) as { transactions: { to: string }[] }).transactions;
  assert.equal(inner.length, declared.length);
  assert.deepEqual(
    inner.map((call) => call.to.toLowerCase()),
    declared.map((call) => call.to.toLowerCase()),
  );
  assert.ok(
    inner.every((call) => call.operation === Operation.Call),
    'MultiSendCallOnly reverts on an inner delegatecall, so every inner call must be a call',
  );
});

/** `cast sig "transfer(address,uint256)"` ,  the selector the Bybit payload presented. */
test('the batch carries an inner transfer, which no Safe selector would reveal', () => {
  const transaction = parseSafeTransaction(FIXTURE, { operation: Operation.Call });
  const { args } = decodeFunctionData({ abi: MULTI_SEND_ABI, data: transaction.data });
  const selectors = unpackMultiSendTransactions(args[0]).map((call) => call.data.slice(0, 10));

  assert.ok(selectors.includes('0xa9059cbb'), `expected a transfer among ${selectors.join(', ')}`);
});

test('the fixture keeps the shape the repository files it in', () => {
  const parsed = JSON.parse(FIXTURE) as {
    chainId: string;
    meta: { createdFromSafeAddress: string };
    transactions: { data: string | null; contractMethod: unknown }[];
  };

  assert.equal(typeof parsed.chainId, 'string', 'chainId is a string in Safe`s own BatchFile type');
  assert.ok(parsed.transactions.length > 1);
  assert.ok(
    parsed.transactions.every((call) => call.data === null && call.contractMethod !== undefined),
    'the declarative form leaves data null and describes the call instead',
  );
});

test('a batch is wrapped whatever the caller asked --operation to be', () => {
  for (const operation of [Operation.Call, Operation.DelegateCall]) {
    assert.equal(
      parseSafeTransaction(FIXTURE, { operation }).operation,
      Operation.DelegateCall,
      'MultiSend.multiSend only runs under delegatecall',
    );
  }
});
