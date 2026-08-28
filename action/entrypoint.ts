import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const file = process.env.INPUT_FILE;
const mode = process.env.INPUT_MODE;
const safe = process.env.INPUT_SAFE;
const policy = process.env.INPUT_POLICY;
const operation = process.env.INPUT_OPERATION;
const rpcUrl = process.env.INPUT_RPC_URL;

if (!file) {
  console.error("Error: Input 'file' is required.");
  process.exit(1);
}

const args: string[] = ['dist/src/cli/main.js', 'check', file];

if (mode) {
  args.push('--mode', mode);
}
if (safe) {
  args.push('--safe', safe);
}
if (policy) {
  args.push('--policy', policy);
}
if (operation) {
  args.push('--operation', operation);
}

const env: Record<string, string> = { ...process.env } as Record<string, string>;
if (rpcUrl) {
  env.SAFE_STATEDIFF_RPC_URL = rpcUrl;
}

const cliPath = join(__dirname, '../../dist/src/cli/main.js');
args[0] = cliPath;

const result = spawnSync('node', args, {
  stdio: 'inherit',
  env,
});

if (result.error) {
  console.error(`Failed to spawn CLI: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== null) {
  process.exit(result.status);
} else {
  process.exit(1);
}
