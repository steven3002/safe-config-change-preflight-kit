import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  type Address,
  type PublicClient,
  type TestClient,
  type WalletClient,
} from 'viem';

/**
 * Build the viem clients this layer talks to an Anvil instance through, and pick the account that
 * pays for the transactions it sends.
 */

export interface AnvilClients {
  readonly reader: PublicClient;
  readonly test: TestClient<'anvil'>;
  readonly wallet: WalletClient;
}

export function createAnvilClients(rpcUrl: string): AnvilClients {
  const transport = http(rpcUrl);
  return {
    reader: createPublicClient({ transport }),
    test: createTestClient({ mode: 'anvil', transport }),
    wallet: createWalletClient({ transport }),
  };
}

/**
 * The first account Anvil unlocks, used to deploy contracts in local mode.
 *
 * Anvil funds and unlocks its own accounts, so the node signs for this address and no private key
 * is held here. The account is a payer of gas and nothing else: it is never a Safe owner, and no
 * state it touches is measured.
 */
export async function resolveFundedAccount(wallet: WalletClient): Promise<Address> {
  const [account] = await wallet.getAddresses();
  if (account === undefined) {
    throw new Error('anvil unlocked no accounts, so there is nothing to send transactions from');
  }
  return account;
}
