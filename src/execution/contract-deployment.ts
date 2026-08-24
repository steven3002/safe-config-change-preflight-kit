import type { Address, Hex, PublicClient, WalletClient } from 'viem';

/**
 * Send a transaction to an Anvil instance and wait for it to succeed, including the transaction
 * that deploys a contract.
 *
 * A reverted transaction here is a failure of the harness, not a finding about the transaction
 * under review, so it throws rather than being reported as observed state.
 */

export interface Sender {
  readonly reader: PublicClient;
  readonly wallet: WalletClient;
  readonly account: Address;
}

export async function deployContract(sender: Sender, creationBytecode: Hex): Promise<Address> {
  const receipt = await sendAndConfirm(sender, { data: creationBytecode }, 'contract deployment');
  if (receipt.contractAddress === null || receipt.contractAddress === undefined) {
    throw new Error('a deployment transaction succeeded but reported no contract address');
  }
  return receipt.contractAddress;
}

export interface OutgoingCall {
  readonly to?: Address | undefined;
  readonly data: Hex;
  readonly value?: bigint | undefined;
}

export async function sendAndConfirm(
  sender: Sender,
  call: OutgoingCall,
  description: string,
): Promise<Awaited<ReturnType<PublicClient['waitForTransactionReceipt']>>> {
  const hash = await sender.wallet.sendTransaction({
    account: sender.account,
    chain: null,
    ...(call.to === undefined ? {} : { to: call.to }),
    data: call.data,
    ...(call.value === undefined ? {} : { value: call.value }),
  });

  const receipt = await sender.reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`${description} reverted (transaction ${hash})`);
  }
  return receipt;
}
