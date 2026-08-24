import { decodeFunctionResult, getAddress, type Address } from 'viem';
import {
  SAFE_PROXY_FACTORY_CREATION_BYTECODE,
  SAFE_SINGLETON_CREATION_BYTECODE,
} from '../safe/deployment-bytecode.js';
import {
  SAFE_PROXY_FACTORY_ABI,
  encodeCreateProxyWithNonce,
  encodeSafeSetup,
} from '../safe/safe-setup.js';
import { createAnvilClients, resolveFundedAccount } from './anvil-client.js';
import { startAnvil } from './anvil-process.js';
import { deployContract, sendAndConfirm, type Sender } from './contract-deployment.js';
import { hostMultiSendCallOnly } from './multisend-host.js';
import { readSafeState } from './safe-state.js';
import type { SafeSession } from './running-safe.js';

/**
 * Start a bare chain, deploy Safe v1.4.1 and its proxy factory into it, and create a Safe.
 *
 * Local mode needs no network and no funded account of the caller's, so it runs anywhere CI does.
 * It also gives the tool a second Safe release to exercise: fork mode measures a v1.3.0 Safe, this
 * measures a v1.4.1 one, and the two differ in exactly the places most likely to be got wrong.
 */

/**
 * The owner set a local Safe is built with unless a caller says otherwise.
 *
 * These addresses hold no keys and need none: signatures are satisfied through the Safe's own
 * `approvedHashes` mapping rather than by signing, so an owner here is an identity in storage and
 * nothing more. Three owners at a threshold of two gives a baseline where both a threshold rise and
 * a threshold fall are expressible.
 */
export const DEFAULT_LOCAL_OWNERS: readonly Address[] = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
];

export const DEFAULT_LOCAL_THRESHOLD = 2;

const PROXY_SALT_NONCE = 0n;

export interface LocalModeOptions {
  readonly owners?: readonly Address[] | undefined;
  readonly threshold?: number | undefined;
  /** Where to host `MultiSendCallOnly`; defaults to the canonical deployment address. */
  readonly multiSendAddress?: Address | undefined;
}

export async function startLocalSafe(options: LocalModeOptions = {}): Promise<SafeSession> {
  const anvil = await startAnvil();

  try {
    const clients = createAnvilClients(anvil.rpcUrl);
    const sender: Sender = {
      reader: clients.reader,
      wallet: clients.wallet,
      account: await resolveFundedAccount(clients.wallet),
    };

    const singleton = await deployContract(sender, SAFE_SINGLETON_CREATION_BYTECODE);
    const factory = await deployContract(sender, SAFE_PROXY_FACTORY_CREATION_BYTECODE);
    const initializer = encodeSafeSetup({
      owners: options.owners ?? DEFAULT_LOCAL_OWNERS,
      threshold: options.threshold ?? DEFAULT_LOCAL_THRESHOLD,
    });

    const safeAddress = await createProxy(sender, factory, singleton, initializer);
    await hostMultiSendCallOnly(clients, options.multiSendAddress);

    const state = await readSafeState(clients.reader, safeAddress);
    return {
      safe: {
        rpcUrl: anvil.rpcUrl,
        safeAddress,
        chainId: await clients.reader.getChainId(),
        mode: 'local',
        threshold: state.threshold,
        owners: state.owners,
      },
      stop: anvil.stop,
    };
  } catch (cause) {
    await anvil.stop();
    throw cause;
  }
}

/**
 * Create the proxy, taking its address from the factory's own return value.
 *
 * The address is read by simulating the call first and then sending the identical one, rather than
 * by recomputing the CREATE2 address here. Recomputing would restate the factory's salt derivation
 * in a second place, where it could drift from the deployed one without anything noticing.
 */
async function createProxy(
  sender: Sender,
  factory: Address,
  singleton: Address,
  initializer: `0x${string}`,
): Promise<Address> {
  const data = encodeCreateProxyWithNonce(singleton, initializer, PROXY_SALT_NONCE);

  const simulated = await sender.reader.call({ account: sender.account, to: factory, data });
  if (simulated.data === undefined) {
    throw new Error('the proxy factory returned no address when creating the Safe');
  }
  const proxy = decodeFunctionResult({
    abi: SAFE_PROXY_FACTORY_ABI,
    functionName: 'createProxyWithNonce',
    data: simulated.data,
  });

  await sendAndConfirm(sender, { to: factory, data }, 'Safe proxy creation');
  return getAddress(proxy);
}
