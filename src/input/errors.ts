/**
 * Raised when a transaction input file cannot be read, parsed, or validated.
 *
 * Every rejection carries a message naming the offending field so a reviewer can fix the file
 * without reading this source. Input problems are a distinct failure class from execution
 * problems: they mean the check never started, not that it ran and found nothing.
 */
export class InputError extends Error {
  override readonly name = 'InputError';
}

/** Prefix an `InputError` message with the position of the offending transaction in the file. */
export function atTransaction(index: number, error: unknown): InputError {
  const detail = error instanceof Error ? error.message : String(error);
  return new InputError(`transactions[${index}]: ${detail}`, { cause: error });
}
