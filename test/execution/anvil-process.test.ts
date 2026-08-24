import test from 'node:test';
import assert from 'node:assert/strict';
import { startAnvil } from '../../src/execution/anvil-process.js';
import { anvilChildren, awaitNoAnvilChildren } from './child-processes.js';

/**
 * The Anvil lifecycle: a spawned instance answers, a stopped one is gone, and a start that fails
 * leaves nothing behind. A leaked Anvil is a hung CI job, so the absence of one is asserted rather
 * than assumed.
 */

async function chainId(rpcUrl: string): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  });
  const body = (await response.json()) as { result: string };
  return body.result;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('a spawned instance answers on the port it reports', async () => {
  const anvil = await startAnvil();
  try {
    assert.ok(anvil.port > 0);
    assert.equal(anvil.rpcUrl, `http://127.0.0.1:${anvil.port}`);
    assert.equal(await chainId(anvil.rpcUrl), '0x7a69');
  } finally {
    await anvil.stop();
  }
});

test('two instances take different ports', async () => {
  const first = await startAnvil();
  const second = await startAnvil();
  try {
    assert.notEqual(first.port, second.port);
  } finally {
    await Promise.all([first.stop(), second.stop()]);
  }
});

test('stopping terminates the process and can be repeated', async () => {
  const anvil = await startAnvil();
  const pid = anvil.pid;
  assert.ok(pid !== undefined);
  assert.ok(isAlive(pid));

  await anvil.stop();
  assert.equal(isAlive(pid), false);
  await anvil.stop();

  await assert.rejects(chainId(anvil.rpcUrl));
});

test('a fork without a pinned block is refused before anything is spawned', async () => {
  const before = anvilChildren();
  await assert.rejects(
    startAnvil({ forkUrl: 'http://127.0.0.1:1' }),
    /pinned to a block number/u,
  );
  assert.deepEqual(anvilChildren(), before);
});

test('a start that fails leaves no process behind', async () => {
  await assert.rejects(
    startAnvil({
      forkUrl: 'http://127.0.0.1:1',
      forkBlockNumber: 1n,
      readinessTimeoutMs: 20_000,
    }),
  );
  await awaitNoAnvilChildren();
});
