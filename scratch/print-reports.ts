import { renderHumanReport } from '../src/report/human.js';
import { renderJsonReport } from '../src/report/json.js';
import { conclusive, inconclusive } from '../src/check/outcome.js';
import { DEFAULT_POLICY } from '../src/policy/schema.js';

const failOutcome = conclusive('fork', 'FAIL', [
  { field: 'singleton', slot: '0x000', before: '0xA1', after: '0xB2' },
  { field: 'threshold', slot: '0x004', before: 2, after: 1 }
], false, '0xe57012ae69be66ad9bec7dadb49c1b6c65bd4ca6', DEFAULT_POLICY);

console.log("FAIL:");
console.log(renderHumanReport(failOutcome));

console.log("\nJSON FAIL:");
console.log(renderJsonReport(failOutcome));

const warnOutcome = conclusive('fork', 'WARN', [
  { field: 'threshold', slot: '0x004', before: 2, after: 3 }
], false, '0xe57012ae69be66ad9bec7dadb49c1b6c65bd4ca6', DEFAULT_POLICY);

console.log("\nWARN:");
console.log(renderHumanReport(warnOutcome));
