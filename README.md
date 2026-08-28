# Safe StateDiff CI Gate

A GitHub Action and CLI that checks Safe multisig transaction files before they are merged.

Rather than decoding calldata and inferring what a transaction *intends* to do, this tool **executes the transaction against a real Safe inside Anvil**, reads the Safe's protected storage before and after, and reports the observed state delta. It then applies a policy file to that delta to produce a CI verdict.

## Why this exists

A `delegatecall` to a contract exposing `transfer(address,uint256)` can rewrite a Safe's owner set or replace its implementation pointer without presenting any Safe configuration selectors. Calldata decoders see nothing in this case; execution and observation see the truth.

This execution-based technique is proven in Optimism's `superchain-ops` repository, which hardcodes the same slot constants this tool depends on. This project simply makes that proven technique installable as a generic CI gate.

## Execution Modes

The tool uses Anvil to execute the transaction and supports two modes:

1. **Fork Mode (`fork`)**: Forks a live chain at a pinned block and measures the exact Safe the transaction targets. This requires an archive-capable JSON-RPC endpoint.
2. **Local Mode (`local`)**: Deploys a fresh Safe v1.4.1 locally and measures the transaction against it. This serves as version coverage and a fixture harness.

## Policy File

The tool reads `safe-policy.yml` from the root of your repository to decide whether an observed change should pass or fail. Each protected field carries a disposition of `pass`, `report`, `warn`, or `fail`.

Example `safe-policy.yml`:
```yaml
protected_state:
  singleton: fail
  owners: fail
  owner_count: fail
  threshold_decrease: fail
  threshold_increase: warn
  nonce: report
  modules: warn
  guard: warn
  fallback_handler: warn
  module_guard: warn
  signed_messages: warn
  approved_hashes: warn
  unrecognised: fail
```

## Exit Codes

- `0` (PASS/WARN): The transaction executed and the observed changes complied with the policy.
- `1` (FAIL): The transaction executed but the observed changes violated the policy.
- `2` (INCONCLUSIVE): The transaction could not be executed or measured (e.g. hash mismatch, reverted transaction, or out of gas). The CI gate treats this as a failure.

## Limitations

- **Transient state is invisible**: Any state written and reverted within one transaction leaves no diff. Measured against a 160-transaction corpus, this leads to an 18.8% recall on `DisabledModule` events.
- **Fork results depend on chain state**: A pinned block makes a run reproducible, but state may drift between a pull request opening and merging.
- **Version support is explicit, not universal**: Safe v1.3.0 and v1.4.1 are exercised. Other versions are untested.
- **Not a security oracle**: The tool reports observed protected-state deltas against a policy. It does not prove a transaction is safe, audit bytecode, or detect exploits.
- **GitHub-hosted Runner requirements**: The provided GitHub Action uses `foundry-rs/foundry-toolchain` to install Anvil, as `ubuntu-latest` does not have Foundry pre-installed.
- **RPC Availability**: A public RPC endpoint will fail intermittently under back-to-back runs, even when archive-capable. The tool's fork start will retry, but if it ultimately fails, it correctly surfaces as `INCONCLUSIVE`.

## Usage

```yaml
jobs:
  check-safe-tx:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
        with:
          version: stable

      - name: Run Safe StateDiff
        uses: ./
        with:
          file: 'path/to/transaction.json'
          mode: 'fork'
          rpc-url: ${{ secrets.RPC_URL }}
```


## Testing Adversarial Fixtures

The repository includes two adversarial fixtures that demonstrate how calldata-invisible attacks are caught by StateDiff:
1. `fixtures/mastercopy-overwrite.json`
2. `fixtures/owner-threshold-rewrite.json`

Both perform a `delegatecall` to an address containing malicious code. Since a `delegatecall` to an empty address succeeds and does nothing, these will correctly report `INCONCLUSIVE` if you run them without the malicious code present on-chain.

To see them fail as expected (`FAIL`), run Anvil locally and etch the attacker code into the target address first:

```bash
# You must first etch the attack payloads to their expected addresses on the local chain.
# See test/check/attacker.ts for the generation of these payloads.

safe-statediff check fixtures/mastercopy-overwrite.json --mode local
safe-statediff check fixtures/owner-threshold-rewrite.json --mode local
```
