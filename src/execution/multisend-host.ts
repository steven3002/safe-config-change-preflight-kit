import { keccak256, type Address, type PublicClient, type TestClient } from 'viem';
import {
  MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE,
  MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE_HASH,
} from '../safe/multisend-call-only-bytecode.js';
import { resolveMultiSendCallOnly } from '../safe/multisend.js';

/**
 * Place the `MultiSendCallOnly` runtime code at the address a batched transaction targets, for a
 * chain that has none.
 *
 * Roughly half of real Transaction Builder exports are batches, and a batch executes as one Safe
 * transaction only by delegatecalling this library. A freshly started chain holds code at no
 * address at all, so without this a batch would fail on a local Safe for a reason that has nothing
 * to do with the transaction under review. Etching keeps the address the input layer already
 * resolved correct in both modes, so no later stage has to know which mode is running.
 */

/**
 * Chain 1's deployment, resolved from the deployment registry rather than written down here. The
 * address is what a batch built for mainnet already points at.
 */
export const CANONICAL_MULTI_SEND_CALL_ONLY: Address = resolveMultiSendCallOnly({ chainId: 1 });

export async function hostMultiSendCallOnly(
  clients: { readonly test: TestClient<'anvil'>; readonly reader: PublicClient },
  address: Address = CANONICAL_MULTI_SEND_CALL_ONLY,
): Promise<Address> {
  await clients.test.setCode({ address, bytecode: MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE });

  const placed = await clients.reader.getCode({ address });
  if (placed === undefined || keccak256(placed) !== MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE_HASH) {
    throw new Error(
      `MultiSendCallOnly was not placed at ${address}: the code there does not hash to ` +
        MULTI_SEND_CALL_ONLY_RUNTIME_BYTECODE_HASH,
    );
  }
  return address;
}
