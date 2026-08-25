import { gunzipSync } from 'node:zlib';
import { isHex, type Address, type Hex, type PublicClient } from 'viem';

/**
 * Ask Anvil which storage slots of a Safe it holds state for, so that a write to a slot no
 * enumeration predicted is still seen.
 *
 * This is the one place the Bybit lesson reappears one layer down: the attack the tool exists to
 * catch is a `delegatecall` writing storage directly, and it is under no obligation to write a slot
 * anybody listed in advance. `anvil_dumpState` answers with the accounts the node has state for and
 * every storage key it holds for each, with no enumeration supplied.
 *
 * Only the keys are used. The values are not: a fork dump holds what the node has cached rather
 * than the Safe's full storage, and it records slots that execution merely *read*,  the transaction
 * guard slot appears with a zero value on every run because `execTransaction` looks for a guard and
 * finds none. Reading each candidate back from the Safe on both sides of the diff makes a slot that
 * was only read produce no delta, and gives every value a single provenance.
 */

interface DumpedState {
  readonly accounts?: Record<string, { readonly storage?: Record<string, string>; }>;
}

export async function readTouchedSlots(
  client: PublicClient,
  safeAddress: Address,
): Promise<readonly Hex[]> {
  const dumped = await client.request({ method: 'anvil_dumpState' } as never);
  if (!isHex(dumped)) {
    throw new Error(`anvil_dumpState answered with ${typeof dumped}, not a hex payload`);
  }

  const state = parseDump(dumped);
  const wanted = safeAddress.toLowerCase();
  for (const [address, account] of Object.entries(state.accounts ?? {})) {
    if (address.toLowerCase() === wanted) {
      return Object.keys(account.storage ?? {}).filter((key) => isHex(key));
    }
  }
  return [];
}

/** The dump is gzipped JSON. Anvil documents no other encoding and none has been observed. */
function parseDump(payload: Hex): DumpedState {
  let json: string;
  try {
    json = gunzipSync(Buffer.from(payload.slice(2), 'hex')).toString('utf8');
  } catch (cause) {
    throw new Error(`anvil_dumpState returned a payload that is not gzipped: ${String(cause)}`);
  }
  return JSON.parse(json) as DumpedState;
}
