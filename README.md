# safe-statediff

A CLI and GitHub Action that gates Safe multisig transaction files on what they **actually do** to
the Safe's configuration.

Instead of decoding calldata to infer intent, `safe-statediff` executes the transaction against a
real Safe inside [Anvil](https://book.getfoundry.sh/anvil/), reads the Safe's protected storage
before and after, and applies a policy to the difference it observes.

---

## Why observation rather than decoding

A `delegatecall` runs another contract's code in the Safe's own storage context. A payload whose
only entry point is `transfer(address,uint256)` can therefore overwrite the Safe's implementation
pointer at slot 0, or rewrite its owner linked list, while presenting no Safe configuration selector
at all. This is the Bybit vector.

A decoder reading that calldata sees an ERC-20 transfer and reports no configuration change. It is
not that the decoder is wrong about the selector — it is that the selector is not where the change
lives. Executing the transaction and reading storage afterwards sees the change regardless of how it
was expressed.

The technique is not novel, and this project does not claim it. Optimism's
[`superchain-ops`](https://github.com/ethereum-optimism/superchain-ops) validates Safe operations
this way and ships an MIT-licensed `AccountAccessParser.sol` that hardcodes the same storage slots
used here. What this project adds is packaging: the same idea as an installable check that gates a
pull request.

---

## What it does

1. Reads a Safe Transaction Builder JSON file, single or batched. A batch is wrapped into one
   `MultiSendCallOnly` delegatecall, which is how Safe itself executes batches.
2. Starts an Anvil chain holding the Safe — either a pinned fork of a live network, or a freshly
   deployed Safe v1.4.1.
3. Cross-checks its computed `safeTxHash` against the Safe's own `getTransactionHash`, and stops if
   they disagree.
4. Reads every protected slot, plus every slot the chain reports touched, so that a write nobody
   predicted is still seen.
5. Satisfies the signature check by writing `approvedHashes` entries, **never** by lowering the
   threshold — the threshold is one of the values being measured.
6. Executes the transaction, reads the protected state again, and diffs the union of both reads.
7. Classifies each change and applies the policy to produce a verdict and an exit code.

---

## Quick start

### As a GitHub Action

```yaml
name: Safe transaction preflight
on: pull_request

jobs:
  preflight:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # The check spawns anvil, which the runner image does not carry.
      - uses: foundry-rs/foundry-toolchain@v1
        with:
          version: stable

      - uses: steven3002/safe-config-change-preflight-kit/action@main
        with:
          file: transactions/rotate-signer.json
          mode: fork
          rpc-url: ${{ secrets.SAFE_STATEDIFF_RPC_URL }}
          policy: safe-policy.yml
```

| Input | Default | Description |
|---|---|---|
| `file` | *(required)* | Path to the Transaction Builder JSON file. |
| `mode` | `fork` | `fork` or `local`. |
| `safe` | — | The Safe to check. Needed only when the file omits `meta.createdFromSafeAddress`. |
| `policy` | built-in | Path to a `safe-policy.yml`. |
| `operation` | `call` | `call` or `delegatecall`. Batched files are always delegatecall. |
| `rpc-url` | — | Archive-capable JSON-RPC endpoint. Required for `fork`. |
| `format` | `human` | `human` or `json`. |

The step exits non-zero on `FAIL` and `INCONCLUSIVE`, so it gates by default. It also publishes
`steps.<id>.outputs.verdict` for workflows that would rather branch than fail.

### As a CLI

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation) on `PATH` and Node 20.19
or later.

```bash
npm install
npm run build

# fork mode measures the Safe the file names, at a pinned block
export SAFE_STATEDIFF_RPC_URL=https://your-archive-endpoint
node dist/src/cli/main.js check transactions/rotate-signer.json --mode fork

# local mode needs no network
node dist/src/cli/main.js check transactions/rotate-signer.json --mode local
```

Run with `--help` for the full flag list.

---

## What a report looks like

```
Safe StateDiff CI Gate Report

Safe: 0xE57012ae69BE66aD9beC7dadb49C1b6C65bD4ca6

Result: FAIL

Execution mode: fork

Observed protected state changes:

1. threshold
   Before: 4
   After:  1
   Detail: threshold
   Policy: FAIL (threshold_decrease)

2. nonce
   Before: 4
   After:  5
   Detail: nonce
   Policy: REPORT (nonce)

CI decision:
FAIL
```

`--format json` emits the same result as a stable machine-readable object. Its key set is fixed and
pinned by tests; treat a rename as a breaking change.

---

## Policy

A policy assigns a disposition to each protected field. There is a built-in default, used whenever
no policy is named — **a `safe-policy.yml` sitting in your repository is not picked up
automatically; pass it with `--policy` or the `policy` input.**

A policy file states only what it changes. Fields you do not name keep their built-in disposition,
so narrowing one rule cannot silently stop policing another. Unknown keys are rejected rather than
ignored.

```yaml
protected_state:
  singleton: fail           # implementation pointer, slot 0 — the Bybit vector
  owners: fail              # the owner set
  owner_count: fail
  threshold_decrease: fail  # fewer signatures required
  threshold_increase: warn  # usually a team tightening its own controls
  nonce: report
  modules: warn
  guard: warn
  fallback_handler: warn
  module_guard: warn
  signed_messages: warn
  approved_hashes: warn
  unrecognised: fail        # a write to a slot the tool cannot name
```

Dispositions are `fail`, `warn`, `report` and `pass`, in descending severity. The verdict is the
most severe disposition any finding carries.

Two rules are worth understanding. **`unrecognised` fails by default**: a write to a Safe storage
slot that the tool cannot account for is the class of event that executing the transaction exists to
reveal, and passing it silently would waste the measurement. And **the nonce cannot be policed as
`warn` or `fail`** — every transaction that executes increments it, so such a rule would fire on
every run. It is an oracle for whether the transaction ran, not a finding about it.

---

## Exit codes

| Code | Verdict | Meaning |
|---|---|---|
| `0` | `PASS` | The Safe was measured and the policy is satisfied. |
| `0` | `WARN` | Measured; something is worth a human's attention but is not a gate failure. |
| `1` | `FAIL` | Measured; an observed change violates the policy. |
| `2` | `INCONCLUSIVE` | **The Safe was not measured.** |

`INCONCLUSIVE` is not a severity between `WARN` and `FAIL`; it means the check did not complete, and
it exists so that "we looked and it is fine" can never be confused with "we could not look". A
reverted transaction changes no protected state, so reporting "no changes" for one would be true and
badly misleading. Every inconclusive result carries a stated reason.

---

## Execution modes

**`fork`** forks a live network at a **pinned block** and measures the exact Safe the file names.
The pin is what makes a run reproducible: without it, two checks of the same file could disagree
because the chain moved rather than because the transaction did anything. A pinned read is a
historical one, so the endpoint must be **archive-capable** — not merely public.

**`local`** deploys a Safe v1.4.1 and its proxy factory into a fresh chain and measures that. It
needs no network and runs anywhere, and it covers a second Safe release: fork mode exercises v1.3.0,
local mode v1.4.1.

---

## Limitations

These are specific because vague limitations are not useful.

- **Transient state is invisible.** State written and reverted inside a single transaction leaves no
  trace in storage, so a diff cannot see it. Measured against a 160-transaction corpus, this yields
  **18.8% recall on `DisabledModule` events**. A nonce-only result is reported as its own outcome
  rather than as an unqualified pass, precisely because it is not proof of safety.

- **Fork mode is pinned, but the chain moves.** A run is reproducible against its pinned block; the
  live Safe may still change between a pull request opening and merging.

- **Version support is explicit, not universal.** Safe v1.3.0 and v1.4.1 are exercised. Every other
  version is untested — including v1.2.0 and earlier, whose EIP-712 domain binds no chain id and
  which the hash cross-check will therefore refuse rather than guess at.

- **Public RPC endpoints are not dependable for unattended runs.** Archive capability is necessary
  but not sufficient: starting a fork issues a burst of requests, and endpoints that answer a single
  read may refuse the burst or rate-limit under back-to-back runs. A fork start is retried, and a
  failure that survives the retries surfaces as `INCONCLUSIVE` rather than as a finding. Supply your
  own endpoint for anything you intend to rely on.

- **Not a security oracle.** This reports observed protected-state changes against a policy you
  wrote. It does not prove a transaction is safe, audit bytecode, or detect exploits.

- **Calldata decoding is out of scope**, deliberately. Decoding is the signal this tool exists to
  supplement, not to reproduce.

---

## The adversarial fixtures

`fixtures/mastercopy-overwrite.json` and `fixtures/owner-threshold-rewrite.json` demonstrate the
attack class the tool exists to catch. Both present an ERC-20 `transfer` selector and both are
executed as a `delegatecall`, so a decoder reads them as routine token movements.

**Run either through the CLI and you will get `INCONCLUSIVE`, not `FAIL` — and that is correct.**
Each names an address that has to hold the attack code, and no chain the tool starts carries any. A
`delegatecall` into an address with no code succeeds and does nothing, so the transaction's entire
effect would be code that was never there. The check reports that it could not measure what it was
asked to, and names the address.

Neither the Transaction Builder format nor this CLI can deploy a contract, and no flag is provided
to write code to a chain before a check: such a flag has no honest use in a tool whose output is a
merge decision. To see the fixtures fail, place the code first with `anvil_setCode` against a chain
you control. `test/check/attacker.ts` builds both payloads and shows exactly how the tests do it.

`fixtures/change-threshold.json` needs none of that. It is a plain `changeThreshold(1)` against the
Safe it names, so it reaches `FAIL` through the CLI unaided, and it is what this repository's own
workflow uses to prove the gate can tell a failure from a pass.

---

## Development

```bash
npm install
npm run build
npm run lint

# fork tests skip by name without an endpoint
SAFE_STATEDIFF_RPC_URL=https://your-archive-endpoint npm test
```

---

## License

MIT.
