import { readFile } from 'node:fs/promises';
import { parse, YAMLParseError } from 'yaml';
import { PolicyError, validatePolicyDocument, type Policy } from './schema.js';

/**
 * Read a policy file from disk.
 *
 * Parsing is kept separate from validation so a malformed document and a well-formed one stating an
 * unknown rule produce different messages: the first is a typing mistake in YAML, the second is a
 * mistaken belief about what this tool polices, and conflating them costs a reviewer time.
 */

export async function loadPolicy(filePath: string): Promise<Policy> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new PolicyError(`could not read the policy file '${filePath}': ${detail}`, { cause });
  }
  return parsePolicy(text, filePath);
}

export function parsePolicy(text: string, source = 'policy'): Policy {
  let document: unknown;
  try {
    document = parse(text);
  } catch (cause) {
    const detail =
      cause instanceof YAMLParseError || cause instanceof Error ? cause.message : String(cause);
    throw new PolicyError(`${source}: not valid YAML: ${detail}`, { cause });
  }

  if (document === null || document === undefined) {
    throw new PolicyError(`${source}: the file is empty, so it states no policy`);
  }
  return validatePolicyDocument(document, source);
}
