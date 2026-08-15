# TokenForge contracts

Foundry. Deployed and verified on X Layer testnet — addresses in
[deployments/xlayer-testnet.json](deployments/xlayer-testnet.json).

```bash
forge test          # 122 tests
forge coverage      # 96% of lines, 76% of branches
```

| Contract | |
|---|---|
| `IssuerRegistry` | Who may issue, who may borrow, and which exact mints are cleared. Separate rolls, per-issuer representatives, two-step admin handover |
| `NoteFactory` | The only supported way on-chain. Requires a registered issuer, a registered borrower, and an admin approval of the exact parameters; claims the document hash and deploys note and vault atomically |
| `RWANote` | ERC-20 with immutable terms, a named borrower, a `Pending` state until they accept, impairment, and a transfer restriction hook |
| `RepaymentVault` | Schedule, USDG deposits, pro-rata claims, redemption, impairment and cure. Collects from the borrower against a standing approval once a period is due |
| `SaleDesk` | The primary offering. The issuer places a share of a note; the price is par, computed by the desk, and nobody can set it. Charges 25 bps to each side of a trade |
| `Schedule` | The `Period` type and the canonical schedule hash, shared by the above |

## A worked example

```bash
forge test --match-contract Example -vv
```

Runs an amortizing loan end to end and prints what the contracts do. 1,000 USDG
at 10% over the term, so 1,100 is repaid in total. Split into 100 tokens, Alice
holding 60 and Bob 40, in five instalments of 200 principal plus 20 interest:

```text
period | outstanding | alice bal | bob bal | alice unclaimed | alice paid | bob unclaimed
     0 |        1000 |        60 |      40 |               0 |          0 |             0
     1 |         800 |        48 |      32 |               0 |        132 |            88
     2 |         600 |        36 |      24 |               0 |        264 |           176
     3 |         400 |        24 |      16 |               0 |        396 |           264
     4 |         200 |        12 |       8 |               0 |        528 |           352
     5 |           0 |         0 |       0 |               0 |        660 |           440
```

Alice claims after every instalment, which is why her unclaimed column stays at
zero — each 132, being 60% of a 220 instalment, moves straight into *paid*. Bob
never claims, so his accumulates instead. Both finish with exactly their share
of 1,100: 660 and 440.

Balances fall in step with outstanding principal, while shares — and therefore
ownership — never move.

## Three parties

`issuer` and `borrower` are different addresses and the distinction carries
weight. The issuer originated the loan and is selling it to recover capital
early; the borrower owes the money; holders own the repayments. With one address
doing two jobs, the originator appeared to owe a debt to the people they had
just sold it to.

A note carrying the borrower's signature mints `Active`: `NoteFactory` rebuilds
the message the borrower signed, recovers it, and checks it against the address
named to repay. Without one it mints `Pending`. Until the named borrower calls `accept()` from their own
key, nothing transfers, nothing can be offered, and the vault refuses payment —
because until then the terms are the issuer's assertion about somebody else.

`accept()` is the only thing restricted to the borrower. `settleNextPeriod`
stays open to anyone: a guarantor or a servicer may legitimately pay, and
requiring one specific key would let losing it strand a performing loan.

`Pending` is appended to the `Status` enum rather than placed first, so `Active`
stays zero and notes from earlier factories keep their meaning.

## Automated repayment

`collectFromBorrower` pulls the instalment from the borrower against an
allowance they granted once, so a schedule needs one authorization rather than
a signature per month. It is callable by anyone, deliberately: a contract
cannot wake itself up, and making the keeper privileged would put one key
between a borrower and their own repayment record.

What makes that safe is that it moves nobody's money but the borrower's, only
as far as they authorised — revoke the allowance and it reverts — and only once
the period is due. `settleNextPeriod` still pays from the caller's own balance
and still allows early payment: settling your own debt early is your business,
pulling someone else's money early is not.

The payment lands in the vault and distributes pro-rata as any other does. A
direct transfer to a single investor would not work here, because a note is
held fractionally by many wallets.

## Approval binds to the whole mint

`approveMint` is keyed by `NoteFactory.mintHash` — a commitment to every value
the note will carry — rather than by the document. Approving the document alone
would have left the principal, supply, borrower and schedule free to change
between the admin's decision and the transaction while the approval still held.
The schedule is covered through `terms.scheduleHash`, which the vault's
constructor independently refuses to contradict.

`hashMintArgs` in `packages/core` reproduces the hash off-chain, and
`MintHashParityTest` pins a shared constant so a divergence fails there rather
than as a mint the chain refuses for no visible reason.

## Five decisions worth knowing

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

**The sale desk holds no price and no money.** A token is a claim on one unit of
principal, so par is arithmetic on the note's own terms — `openOffer` takes no
price argument and there is nothing to set. The pool is the desk's own balance
of the note rather than a stored figure, so it amortizes along with everything
else: after a 20% paydown a half-sold note is still half sold. Payment goes
straight from buyer to seller in the same call that delivers the tokens, so the
desk never holds anyone's money between calls. `quote` rounds *up*, because
rounding down let amounts small enough to zero the cost be taken for free.

**The fee is charged to both sides and is immutable.** 25 basis points from the
buyer on top of the price, 25 from the seller out of the proceeds, both moved to
the treasury in the same call that delivers the tokens. Quoting one side only
would have hidden half the cost from whoever did not see it. The rate and the
treasury are fixed at deployment for the same reason the price is not the
issuer's to set: a desk that could reprice its own cut after an offer opened
would change what a sale costs between a buyer's quote and their confirmation.
`maxCost` covers the fee as well as the price, or it would not be a cap on what
the buyer actually parts with.

**Revoking an issuer does not touch notes already issued.** Their terms are
immutable and their holders' claims should survive the issuer losing the right
to create more.

## Testing

`AutomatedRepaymentTest` covers the authorization: that nothing is collectible
without one, that one approval covers every instalment, that collection is
refused before the due date, that any keeper can trigger it and pays nothing
itself, and that revoking the allowance stops it.

`MintApprovalTest` covers the binding: that a registered issuer still needs an
approval, and that changing the supply, principal, borrower or schedule
afterwards is refused.

`PartiesTest` and `AcceptanceTest` cover the three-party model: that the issuer
and borrower are distinct, that the borrower holds none of the loan, that a
borrower's payment reaches a holder who bought part of it, and that transfers
and settlement both refuse a note nobody has accepted.

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
