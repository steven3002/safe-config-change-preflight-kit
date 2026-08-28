import { getAddress, type Address } from 'viem';
import { createAnvilClients } from './anvil-client.js';
import { startAnvil, type AnvilInstance } from './anvil-process.js';
import { resolveForkEndpoint, type ForkEndpoint } from './fork-config.js';
import { readSafeState } from './safe-state.js';
import type { SafeSession } from './running-safe.js';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Start a chain forked from a live network at a fixed block, and measure a Safe that already
 * exists on it.
 *
 * The block is pinned because the tool's answer has to be reproducible: the same input checked
 * twice must produce the same baseline, or a merge gate reports a difference that came from the
 * chain moving rather than from the transaction under review.
 */

export interface ForkModeOptions {
  readonly safeAddress: Address;
  /** Endpoint and pinned block; resolved from the environment when not supplied. */
  readonly endpoint?: ForkEndpoint | undefined;
}

const MAX_START_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

export async function startForkedSafe(options: ForkModeOptions): Promise<SafeSession> {
  const endpoint = options.endpoint ?? resolveForkEndpoint();
  const safeAddress = getAddress(options.safeAddress);

  let lastCause: unknown;

  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
    let anvil: AnvilInstance | undefined;
    try {
      anvil = await startAnvil({
        forkUrl: endpoint.rpcUrl,
        forkBlockNumber: endpoint.blockNumber,
      });

      const clients = createAnvilClients(anvil.rpcUrl);
      const state = await readSafeState(clients.reader, safeAddress);

      return {
        safe: {
          rpcUrl: anvil.rpcUrl,
          safeAddress,
          chainId: await clients.reader.getChainId(),
          mode: 'fork',
          threshold: state.threshold,
          owners: state.owners,
        },
        stop: anvil.stop,
      };
    } catch (cause) {
      lastCause = cause;
      if (anvil !== undefined) {
        await anvil.stop();
      }
      if (attempt < MAX_START_ATTEMPTS) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  throw lastCause;
}
