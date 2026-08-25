import type { Hex } from 'viem';

/**
 * A classified storage delta: one statement about the Safe's protected state, decoded far enough
 * that a reviewer can act on it without reading a slot map.
 */

/**
 * The protected fields this tool names. `unrecognised` is not a fallback to be tidied away later —
 * it is the loudest finding here. A slot that changed and cannot be named is a write nobody
 * predicted, which is exactly the class of event executing the transaction exists to reveal.
 */
export type FindingField =
  | 'singleton'
  | 'owners'
  | 'ownerCount'
  | 'threshold'
  | 'nonce'
  | 'modules'
  | 'guard'
  | 'fallbackHandler'
  | 'moduleGuard'
  | 'signedMessages'
  | 'approvedHashes'
  | 'unrecognised';

/**
 * A decoded slot value: an address, an integer, the raw word when neither applies, or a set of
 * addresses where the field is a linked list rather than a single word.
 */
export type FindingValue = string | number | readonly string[];

export interface Finding {
  readonly field: FindingField;
  /**
   * The slot the finding is anchored to. For a field held in a linked list this is the mapping's
   * own slot rather than any one link, because the finding is about the set and not about the
   * individual writes that rearranged it.
   */
  readonly slot: Hex;
  readonly before: FindingValue;
  readonly after: FindingValue;
  /** Human phrasing where the values alone do not carry the change, such as added and removed owners. */
  readonly detail?: string;
}
