# TokenForge contracts

Foundry. Deployed and verified on X Layer testnet — addresses in
[deployments/xlayer-testnet.json](deployments/xlayer-testnet.json).

```bash
forge test          # 67 tests
forge coverage      # 96% of lines, 76% of branches
```

| Contract | |
|---|---|
| `IssuerRegistry` | Who may issue. Admission, revocation, per-issuer representatives, two-step admin handover |
| `NoteFactory` | The only supported way on-chain. Enforces registry membership, claims the document hash, deploys note and vault atomically |
| `RWANote` | ERC-20 with immutable terms, impairment state, and a transfer restriction hook |
| `RepaymentVault` | Schedule, USDG deposits, pro-rata claims, redemption, impairment and cure |
| `Schedule` | The `Period` type and the canonical schedule hash, shared by the above |

## A worked example

```bash
forge test --match-contract Example -vv
```

Runs an amortizing loan end to end and prints what the contracts do. 1,000 USDG
split into 100 tokens, Alice holding 60 and Bob 40, repaid in five instalments
of 200 principal plus 10 interest:

```text
period | outstanding | alice bal | bob bal | alice unclaimed | alice paid | bob unclaimed
     0 |        1000 |        60 |      40 |               0 |          0 |             0
     1 |         800 |        48 |      32 |               0 |        126 |            84
     2 |         600 |        36 |      24 |               0 |        252 |           168
     3 |         400 |        24 |      16 |               0 |        378 |           252
     4 |         200 |        12 |       8 |               0 |        504 |           336
     5 |           0 |         0 |       0 |               0 |        630 |           420
```

Alice claims after every instalment, which is why her unclaimed column stays at
zero — each 126, being 60% of a 210 instalment, moves straight into *paid*. Bob
never claims, so his accumulates instead. Both finish with exactly their share
of 1,050: 630 and 420.

Balances fall in step with outstanding principal, while shares — and therefore
ownership — never move.

## Four decisions worth knowing

**Distribution uses an accumulator, not per-period snapshots.** The note calls
`syncHolder` for both parties before any balance change, so a coupon lands with
whoever held the tokens while it accrued. Selling straight after a deposit does
not forfeit it; buying straight after one does not capture it.

**The vault refuses to deploy against a schedule that does not reproduce the
note's committed `scheduleHash`.** That is what stops the terms a human approved
being swapped for different ones between review and deployment.

**Balances amortize; supply tracks outstanding principal.** `RWANote` stores
*shares*, and `balanceOf` is a share multiplied by the fraction of principal
still owed. Repay 10% of a 1,000 USDG loan and a 100-token holder is left with
90 — the repaid portion is retired without anyone burning anything.

That burn has to be simultaneous to be fair. If holders retired tokens
individually, whoever redeemed last would collect a larger share of the next
payment, because their unburned tokens still represent principal they had
already been credited. Two identical positions would earn differently purely on
timing.

Distribution therefore runs on shares, not balances: a share is a fixed slice of
the loan, while a balance is what that slice is currently worth. Coupons are
claimed separately and whenever the holder likes.

One trade-off worth knowing: the `Transfer` event carries the share amount, not
the balance amount, because it is emitted by the inherited ERC-20 accounting.
Read `sharesOf` alongside it. This is the usual cost of a rebasing token.

**Revoking an issuer does not touch notes already issued.** Their terms are
immutable and their holders' claims should survive the issuer losing the right
to create more.

## Testing

The fixture is the Meridian note from the demo documents — $2.5M at 8.50%,
twelve $53,125 quarterly coupons — the same figures the TypeScript validator
reproduces, so a divergence between the two halves of the product shows up as a
failing test rather than a mystery.

The mock settlement currency is 6 decimals against the note's 18 on purpose. A
same-decimals token would hide a decimals error in the distribution math.

## Deploying

```bash
cast wallet import tokenforge-deployer --interactive
forge script script/Deploy.s.sol:Deploy \
  --rpc-url xlayer_testnet --account tokenforge-deployer --broadcast
```

Verification goes through OKLink's plugin endpoint rather than an `[etherscan]`
entry, and needs **no API key**. Flags are documented in `foundry.toml`. OKLink
wants about a minute after deployment before it will accept a new address, so
pair it with `--watch`.

`MockUSDG` is testnet only — minting is unrestricted, which makes it worthless
as money. Its deploy script refuses to broadcast on chain 196, where the real
USDG exists and a freely mintable impostor would be actively harmful.
