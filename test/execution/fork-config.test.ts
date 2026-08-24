import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FORK_BLOCK_NUMBER,
  FORK_BLOCK_VARIABLE,
  RPC_URL_VARIABLE,
  resolveForkEndpoint,
} from '../../src/execution/fork-config.js';

test('the endpoint comes from the environment and the block defaults to the pin', () => {
  const endpoint = resolveForkEndpoint({ [RPC_URL_VARIABLE]: ' https://example.invalid/rpc ' });
  assert.equal(endpoint.rpcUrl, 'https://example.invalid/rpc');
  assert.equal(endpoint.blockNumber, DEFAULT_FORK_BLOCK_NUMBER);
});

test('the pinned block can be moved', () => {
  const endpoint = resolveForkEndpoint({
    [RPC_URL_VARIABLE]: 'https://example.invalid/rpc',
    [FORK_BLOCK_VARIABLE]: '19000000',
  });
  assert.equal(endpoint.blockNumber, 19_000_000n);
});

test('a missing endpoint names the variable that supplies it', () => {
  assert.throws(() => resolveForkEndpoint({}), new RegExp(RPC_URL_VARIABLE, 'u'));
  assert.throws(() => resolveForkEndpoint({ [RPC_URL_VARIABLE]: '  ' }), /needs an Ethereum/u);
});

test('a block that is not a number is refused rather than silently unpinned', () => {
  assert.throws(
    () =>
      resolveForkEndpoint({
        [RPC_URL_VARIABLE]: 'https://example.invalid/rpc',
        [FORK_BLOCK_VARIABLE]: 'latest',
      }),
    /not a block number/u,
  );
  assert.throws(
    () =>
      resolveForkEndpoint({
        [RPC_URL_VARIABLE]: 'https://example.invalid/rpc',
        [FORK_BLOCK_VARIABLE]: '0',
      }),
    /positive block number/u,
  );
});
