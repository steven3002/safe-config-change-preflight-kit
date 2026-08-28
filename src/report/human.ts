import type { Outcome } from '../check/outcome.js';
import { policeFindings } from '../policy/evaluate.js';

export function renderHumanReport(outcome: Outcome): string {
  const lines: string[] = [];
  lines.push('Safe StateDiff CI Gate Report');
  lines.push('');
  lines.push(`Safe: ${outcome.safeAddress ?? 'unknown'}`);
  lines.push('');
  lines.push(`Result: ${outcome.verdict}`);
  lines.push('');
  lines.push(`Execution mode: ${outcome.mode}`);
  lines.push('');

  if (outcome.verdict === 'INCONCLUSIVE') {
    lines.push(`Reason: ${outcome.reason}`);
    lines.push('');
    lines.push('CI decision:');
    lines.push(outcome.verdict);
    return lines.join('\n') + '\n';
  }

  lines.push('Observed protected state changes:');
  lines.push('');

  if (outcome.nonceOnly) {
    lines.push('executed-with-no-observable-change');
    lines.push('');
    lines.push('CAVEAT: state written and reverted inside one transaction leaves no trace in storage at all.');
    lines.push('The measured recall loss is real (18.8% on DisabledModule).');
    lines.push('');
  } else if (outcome.findings.length > 0) {
    if (!outcome.policy) {
      throw new Error('Conclusive outcome is missing its policy');
    }
    const policed = policeFindings(outcome.findings, outcome.policy);
    let index = 1;
    for (const { finding, disposition, rule } of policed) {
      lines.push(`${index}. ${finding.field}`);
      
      const beforeStr = Array.isArray(finding.before) ? finding.before.join(', ') : String(finding.before);
      const afterStr = Array.isArray(finding.after) ? finding.after.join(', ') : String(finding.after);
      
      lines.push(`   Before: ${beforeStr}`);
      lines.push(`   After:  ${afterStr}`);
      if (finding.detail) {
        lines.push(`   Detail: ${finding.detail}`);
      }
      lines.push(`   Policy: ${disposition.toUpperCase()} (${rule})`);
      lines.push('');
      index++;
    }
  } else {
    lines.push('None.');
    lines.push('');
  }

  lines.push('CI decision:');
  lines.push(outcome.verdict);
  
  return lines.join('\n') + '\n';
}
