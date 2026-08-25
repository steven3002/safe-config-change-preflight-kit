/**
 * Parse JSON while preserving every numeric literal as its source text.
 *
 * Transaction Builder encodes tuple parameter values as embedded JSON, and those tuples routinely
 * carry `uint256` amounts. `JSON.parse` would silently round any literal above 2^53 to the nearest
 * double,   `5927159439709870321853251` becomes `5927159439709871000000000`,   and the resulting
 * calldata would encode an amount nobody wrote. Keeping numbers as text defers the conversion to
 * the Solidity type, where it can be done exactly.
 */

export type JsonScalar = { readonly kind: 'scalar'; readonly text: string };
export type JsonArray = { readonly kind: 'array'; readonly items: readonly JsonNode[] };
export type JsonObject = { readonly kind: 'object'; readonly entries: ReadonlyMap<string, JsonNode> };
export type JsonNode = JsonScalar | JsonArray | JsonObject;

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const NUMBER_START = /[-0-9]/;
const NUMBER_BODY = /[-+0-9eE.]/;

class Reader {
  private index = 0;

  constructor(private readonly text: string) {}

  parseDocument(): JsonNode {
    const node = this.parseNode();
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      throw new SyntaxError(`unexpected trailing content at position ${this.index}`);
    }
    return node;
  }

  private parseNode(): JsonNode {
    this.skipWhitespace();
    const char = this.peek();
    if (char === '[') return this.parseArray();
    if (char === '{') return this.parseObject();
    if (char === '"') return { kind: 'scalar', text: this.parseString() };
    if (NUMBER_START.test(char)) return { kind: 'scalar', text: this.parseNumber() };
    return { kind: 'scalar', text: this.parseKeyword() };
  }

  private parseArray(): JsonArray {
    this.expect('[');
    const items: JsonNode[] = [];
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.index += 1;
      return { kind: 'array', items };
    }
    for (;;) {
      items.push(this.parseNode());
      this.skipWhitespace();
      const char = this.next();
      if (char === ']') return { kind: 'array', items };
      if (char !== ',') throw new SyntaxError(`expected ',' or ']' at position ${this.index - 1}`);
    }
  }

  private parseObject(): JsonObject {
    this.expect('{');
    const entries = new Map<string, JsonNode>();
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.index += 1;
      return { kind: 'object', entries };
    }
    for (;;) {
      this.skipWhitespace();
      const key = this.parseString();
      this.skipWhitespace();
      this.expect(':');
      entries.set(key, this.parseNode());
      this.skipWhitespace();
      const char = this.next();
      if (char === '}') return { kind: 'object', entries };
      if (char !== ',') throw new SyntaxError(`expected ',' or '}' at position ${this.index - 1}`);
    }
  }

  /** Delegates escape handling to `JSON.parse` on the isolated string literal. */
  private parseString(): string {
    const start = this.index;
    this.expect('"');
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      this.index += 1;
      if (char === '\\') {
        this.index += 1;
        continue;
      }
      if (char === '"') {
        return JSON.parse(this.text.slice(start, this.index)) as string;
      }
    }
    throw new SyntaxError(`unterminated string starting at position ${start}`);
  }

  private parseNumber(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.text.length && NUMBER_BODY.test(this.text[this.index] as string)) {
      this.index += 1;
    }
    return this.text.slice(start, this.index);
  }

  private parseKeyword(): string {
    for (const keyword of ['true', 'false', 'null']) {
      if (this.text.startsWith(keyword, this.index)) {
        this.index += keyword.length;
        return keyword;
      }
    }
    throw new SyntaxError(`unexpected token at position ${this.index}`);
  }

  private skipWhitespace(): void {
    while (this.index < this.text.length && WHITESPACE.has(this.text[this.index] as string)) {
      this.index += 1;
    }
  }

  private peek(): string {
    if (this.index >= this.text.length) throw new SyntaxError('unexpected end of input');
    return this.text[this.index] as string;
  }

  private next(): string {
    const char = this.peek();
    this.index += 1;
    return char;
  }

  private expect(char: string): void {
    if (this.next() !== char) {
      throw new SyntaxError(`expected '${char}' at position ${this.index - 1}`);
    }
  }
}

export function parseJsonPreservingNumbers(text: string): JsonNode {
  return new Reader(text).parseDocument();
}
