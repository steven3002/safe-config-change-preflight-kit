import type { Address, PublicClient } from 'viem';

/**
 * How much code the chain under test holds at an address.
 *
 * A `delegatecall` to an address holding no code succeeds and does nothing, so a transaction whose
 * whole effect is the target's code measures as a clean run against a chain where that code is
 * absent. Local mode deploys a Safe and nothing else, and a fork is pinned to one block, so this is
 * an ordinary condition rather than an exotic one, and it has to be detected rather than passed.
 */
export async function readCodeSize(reader: PublicClient, address: Address): Promise<number> {
  const code = await reader.getCode({ address });
  return code === undefined ? 0 : (code.length - 2) / 2;
}
