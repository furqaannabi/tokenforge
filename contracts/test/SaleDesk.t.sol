// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {SaleDesk} from "../src/SaleDesk.sol";
import {Period, ScheduleLib} from "../src/Schedule.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

/**
 * The primary offering.
 *
 * A note is minted entirely to its issuer, so every one of these tests starts
 * from "the issuer owns all of it" and asks how a stranger ends up holding
 * part of the loan.
 *
 * The fixture is deliberately round — 1,000 USDG over five periods, 1,000
 * tokens — because the interesting behaviour is what amortization does to a
 * pool of unsold tokens, and that is much easier to see in whole numbers.
 */
abstract contract SaleFixture is Test {
    IssuerRegistry internal registry;
    NoteFactory internal factory;
    MockUSDG internal usdg;
    SaleDesk internal desk;

    RWANote internal note;
    RepaymentVault internal vault;

    address internal admin = makeAddr("admin");
    address internal issuer = makeAddr("issuer");
    address internal outsider = makeAddr("outsider");
    address internal borrower = makeAddr("borrower");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal treasury = makeAddr("treasury");

    uint64 internal constant START = 1_790_812_800;
    uint64 internal constant PERIOD = 30 days;

    /// @dev 1,000 USDG lent, repaid as 1,100 over five equal instalments.
    uint256 internal constant PRINCIPAL = 1_000e6;
    uint256 internal constant PERIODS = 5;
    uint256 internal constant SUPPLY = 1_000e18;

    function setUp() public virtual {
        vm.warp(START);

        registry = new IssuerRegistry(admin);
        factory = new NoteFactory(registry);
        usdg = new MockUSDG();
        desk = new SaleDesk(treasury);

        vm.prank(admin);
        registry.admitIssuer(issuer, "Northbridge Credit Partners", "Delaware, USA");
        vm.prank(admin);
        registry.admitBorrower(borrower, "Northbridge Trading Ltd", "Delaware, USA");


        usdg.mint(issuer, 10_000e6);
        usdg.mint(alice, 10_000e6);
        usdg.mint(bob, 10_000e6);

        (note, vault) = _mint();
    }

    function _schedule() internal pure returns (Period[] memory schedule) {
        schedule = new Period[](PERIODS);
        for (uint256 i = 0; i < PERIODS; i++) {
            schedule[i] = Period({
                dueDate: START + uint64(i + 1) * PERIOD,
                principal: 200e6,
                interest: 20e6
            });
        }
    }

    function _mint() internal returns (RWANote note_, RepaymentVault vault_) {
        Period[] memory schedule = _schedule();

        NoteFactory.MintParams memory params = NoteFactory.MintParams({
            name: "Northbridge Working Capital Note",
            symbol: "NBC-26",
            issuer: issuer,
            borrower: borrower,
            supply: SUPPLY,
            currency: usdg,
            gracePeriod: 10 days,
            terms: RWANote.Terms({
                principal: PRINCIPAL,
                rateBps: 1000,
                maturity: schedule[schedule.length - 1].dueDate,
                documentHash: keccak256("Northbridge_LoanAgreement.pdf"),
                scheduleHash: ScheduleLib.hash(schedule)
            }),
            schedule: schedule
        });

        bytes32 approval = factory.mintHash(params);
        vm.prank(admin);
        registry.approveMint(issuer, approval);

        vm.prank(issuer);
        (note_, vault_) = factory.mintNote(params);

        vm.prank(borrower);
        note_.accept();
    }

    /// @dev Opens an offer holding `bps` of the supply, quoted at par.
    function _openAtPar(uint256 bps) internal returns (uint256 tokens) {
        tokens = (SUPPLY * bps) / 10_000;
        vm.startPrank(issuer);
        note.approve(address(desk), tokens);
        desk.openOffer(address(note), tokens);
        vm.stopPrank();
    }

    function _settle() internal {
        uint256 index = vault.nextPeriod();
        uint256 due = vault.periodAt(index).principal + vault.periodAt(index).interest;

        vm.warp(vault.periodAt(index).dueDate);
        vm.startPrank(issuer);
        usdg.approve(address(vault), due);
        vault.settleNextPeriod();
        vm.stopPrank();
    }
}

// ---------------------------------------------------------------------------

contract SaleDeskOfferTest is SaleFixture {
    function test_IssuerOffersAShareOfTheSupply() public {
        uint256 tokens = _openAtPar(3_000); // 30%

        assertEq(desk.available(address(note)), tokens);
        assertEq(desk.poolBps(address(note)), 3_000);
        assertEq(note.balanceOf(issuer), SUPPLY - tokens);
    }

    /// Par is one unit of principal per token: 1,000 USDG over 1,000 tokens.
    function test_ParPriceIsPrincipalOverOriginalSupply() public view {
        assertEq(desk.parPrice(address(note)), 1e6);
        assertEq(desk.price(address(note)), 1e6);
    }

    function test_QuoteScalesWithAmount() public {
        _openAtPar(10_000);
        assertEq(desk.quote(address(note), 100e18), 100e6);
        assertEq(desk.quote(address(note), 1e18), 1e6);
    }

    /**
     * The issuer chooses a size, and the proceeds follow from it.
     *
     * Selling a quarter of a 1,000 loan raises 250 because a token is a claim
     * on one unit of principal — not because anyone typed 250. There is no
     * price to set, so there is nothing to disagree about.
     */
    function test_ProceedsFollowFromTheShareOffered() public {
        uint256 tokens = _openAtPar(2_500); // 250 of 1,000 tokens

        assertEq(desk.quote(address(note), tokens), 250e6);
        assertEq(desk.poolBps(address(note)), 2_500);
    }

    /// There is no way for a seller to name their own price.
    function test_PriceIsAlwaysPar() public {
        _openAtPar(5_000);
        assertEq(desk.price(address(note)), desk.parPrice(address(note)));
    }

    function test_OnlyIssuerCanOpen() public {
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(SaleDesk.NotIssuer.selector, address(note), outsider)
        );
        desk.openOffer(address(note), 1e18);
    }

    function test_CannotOpenTwice() public {
        _openAtPar(1_000);
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(SaleDesk.OfferAlreadyOpen.selector, address(note))
        );
        desk.openOffer(address(note), 0);
    }
}

// ---------------------------------------------------------------------------

contract SaleDeskBuyTest is SaleFixture {
    function test_InvestorBuysAndIssuerIsPaid() public {
        _openAtPar(5_000);

        uint256 issuerBefore = usdg.balanceOf(issuer);

        vm.startPrank(alice);
        usdg.approve(address(desk), 101e6);
        desk.buy(address(note), 100e18, 101e6);
        vm.stopPrank();

        assertEq(note.balanceOf(alice), 100e18, "alice holds what she bought");
        assertEq(
            usdg.balanceOf(issuer) - issuerBefore,
            100e6 - 0.25e6,
            "issuer received par less their side of the fee"
        );
        assertEq(desk.available(address(note)), 400e18, "pool shrank by the sale");
        assertEq(desk.raised(address(note)), 100e6);
    }

    function test_CannotBuyMoreThanThePool() public {
        _openAtPar(1_000); // 100 tokens

        vm.startPrank(alice);
        usdg.approve(address(desk), 1_000e6);
        vm.expectRevert(
            abi.encodeWithSelector(
                SaleDesk.InsufficientPool.selector, address(note), 101e18, 100e18
            )
        );
        desk.buy(address(note), 101e18, 1_000e6);
        vm.stopPrank();
    }

    /// The cap still binds, even though nobody can move the price under a buyer.
    function test_BuyerCapIsEnforced() public {
        _openAtPar(10_000);

        vm.startPrank(alice);
        usdg.approve(address(desk), 1_000e6);
        vm.expectRevert(SaleDesk.CostAboveMax.selector);
        desk.buy(address(note), 100e18, 99e6); // 100 tokens cost 100
        vm.stopPrank();
    }

    function test_CannotBuyFromAClosedOffer() public {
        vm.startPrank(alice);
        usdg.approve(address(desk), 100e6);
        vm.expectRevert(
            abi.encodeWithSelector(SaleDesk.OfferNotOpen.selector, address(note))
        );
        desk.buy(address(note), 1e18, 100e6);
        vm.stopPrank();
    }

    /**
     * The fee, both legs of it, on a round trade.
     *
     * 0.25% each side of a 100 sale: the buyer parts with 100.25, the seller
     * keeps 99.75, and the treasury takes 0.50. The buyer receives the tokens
     * they paid the price for — the fee buys nothing extra, which is what makes
     * it a fee rather than a worse price.
     */
    function test_BothSidesPayTwentyFiveBasisPoints() public {
        _openAtPar(10_000);

        uint256 buyerBefore = usdg.balanceOf(alice);
        uint256 sellerBefore = usdg.balanceOf(issuer);
        uint256 treasuryBefore = usdg.balanceOf(treasury);

        vm.startPrank(alice);
        usdg.approve(address(desk), 200e6);
        desk.buy(address(note), 100e18, 200e6);
        vm.stopPrank();

        assertEq(buyerBefore - usdg.balanceOf(alice), 100.25e6, "buyer paid price plus 25bps");
        assertEq(usdg.balanceOf(issuer) - sellerBefore, 99.75e6, "seller kept price less 25bps");
        assertEq(usdg.balanceOf(treasury) - treasuryBefore, 0.5e6, "treasury took both legs");
        assertEq(note.balanceOf(alice), 100e18, "the fee bought no extra tokens");
    }

    /// Nothing is lost between the three of them.
    function test_TheThreeLegsReconcile() public {
        _openAtPar(10_000);

        uint256 buyerBefore = usdg.balanceOf(alice);
        uint256 sellerBefore = usdg.balanceOf(issuer);
        uint256 treasuryBefore = usdg.balanceOf(treasury);

        vm.startPrank(alice);
        usdg.approve(address(desk), 500e6);
        desk.buy(address(note), 333e18, 500e6);
        vm.stopPrank();

        uint256 paid = buyerBefore - usdg.balanceOf(alice);
        uint256 received = usdg.balanceOf(issuer) - sellerBefore;
        uint256 fee = usdg.balanceOf(treasury) - treasuryBefore;

        assertEq(paid, received + fee, "every unit the buyer paid arrived somewhere");
        assertEq(fee, desk.feesCollected(address(note)));
    }

    /// The cap covers the fee too, or it would not be a cap on what is paid.
    function test_MaxCostIncludesTheBuyersFee() public {
        _openAtPar(10_000);

        vm.startPrank(alice);
        usdg.approve(address(desk), 200e6);
        // 100 tokens cost 100 plus 0.25 of fee; a cap of exactly 100 is short.
        vm.expectRevert(SaleDesk.CostAboveMax.selector);
        desk.buy(address(note), 100e18, 100e6);
        vm.stopPrank();
    }

    /// The quoted totals match what the transfer actually moves.
    function test_QuotedTotalsMatchTheTrade() public {
        _openAtPar(10_000);

        uint256 total = desk.totalCost(address(note), 100e18);
        uint256 proceeds = desk.sellerProceeds(address(note), 100e18);

        uint256 buyerBefore = usdg.balanceOf(alice);
        uint256 sellerBefore = usdg.balanceOf(issuer);

        vm.startPrank(alice);
        usdg.approve(address(desk), total);
        desk.buy(address(note), 100e18, total);
        vm.stopPrank();

        assertEq(buyerBefore - usdg.balanceOf(alice), total);
        assertEq(usdg.balanceOf(issuer) - sellerBefore, proceeds);
    }

    /**
     * Rounding must never hand out a free token.
     *
     * `quote` divides by 1e18, so any amount small enough to round the cost to
     * zero would otherwise be bought for nothing. The pool is not big enough to
     * drain this way at any sensible gas price, but "costs nothing" is not a
     * property a sale should have at any size.
     */
    function test_DustPurchaseIsNotFree() public {
        _openAtPar(10_000);

        uint256 dust = 1e11; // 0.0000001 tokens — rounds to zero at par
        assertEq((dust * 1e6) / 1e18, 0, "the naive quote really is zero");
        assertGt(desk.quote(address(note), dust), 0, "but the desk charges for it");

        vm.startPrank(alice);
        usdg.approve(address(desk), 1e6);
        desk.buy(address(note), dust, 1e6);
        vm.stopPrank();

        assertGt(desk.raised(address(note)), 0, "the pool was paid something");
    }
}

// ---------------------------------------------------------------------------

contract SaleDeskPoolTest is SaleFixture {
    function test_IssuerAddsToThePool() public {
        _openAtPar(1_000);

        vm.startPrank(issuer);
        note.approve(address(desk), 50e18);
        desk.fundPool(address(note), 50e18);
        vm.stopPrank();

        assertEq(desk.available(address(note)), 150e18);
        assertEq(desk.poolBps(address(note)), 1_500);
    }

    function test_IssuerTakesUnsoldTokensBack() public {
        _openAtPar(4_000);

        vm.startPrank(alice);
        usdg.approve(address(desk), 101e6);
        desk.buy(address(note), 100e18, 101e6);
        vm.stopPrank();

        // 300 unsold remain; the issuer reclaims 200 of them.
        vm.prank(issuer);
        desk.withdrawPool(address(note), 200e18);

        assertEq(desk.available(address(note)), 100e18);
        assertEq(note.balanceOf(issuer), SUPPLY - 400e18 + 200e18);
    }

    function test_OnlyIssuerCanWithdraw() public {
        _openAtPar(1_000);
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(SaleDesk.NotIssuer.selector, address(note), outsider)
        );
        desk.withdrawPool(address(note), 1e18);
    }

    function test_ClosingReturnsEverythingUnsold() public {
        _openAtPar(2_000);

        vm.prank(issuer);
        desk.closeOffer(address(note));

        assertEq(desk.available(address(note)), 0);
        assertEq(note.balanceOf(issuer), SUPPLY);
    }
}

// ---------------------------------------------------------------------------

/**
 * What amortization does to an offering.
 *
 * This is the case a fixed "tokens remaining" counter would get wrong. The
 * pool is a live balance, so when principal is repaid the unsold tokens lose
 * value in step with everyone else's — and the percentage of the loan on offer
 * does not move, because both sides of that ratio shrink together.
 */
contract SaleDeskAmortizationTest is SaleFixture {
    function test_PoolAmortizesWithTheNote() public {
        _openAtPar(5_000); // 500 of 1,000 tokens

        assertEq(desk.available(address(note)), 500e18);

        _settle(); // 200 of 1,000 principal returns — a 20% paydown

        assertEq(note.totalSupply(), 800e18, "supply fell by a fifth");
        assertEq(desk.available(address(note)), 400e18, "so did the pool");
        assertEq(desk.poolBps(address(note)), 5_000, "still half the loan");
    }

    /**
     * Par per token does not move as the note amortizes.
     *
     * A token is a claim on one unit of *original* principal, and a holder who
     * buys after a paydown gets fewer tokens for the same money rather than the
     * same tokens at a higher price. Dividing by `totalSupply` here instead of
     * `totalShares` would quote a rising price for a loan being paid off.
     */
    function test_ParPriceSurvivesAPaydown() public {
        _openAtPar(10_000);
        _settle();

        assertEq(desk.parPrice(address(note)), 1e6, "still one unit per token");
        assertEq(desk.quote(address(note), 100e18), 100e6);
    }

    function test_BuyerAfterAPaydownGetsNoPastDistributions() public {
        _openAtPar(10_000);
        _settle();

        vm.startPrank(alice);
        usdg.approve(address(desk), 101e6);
        desk.buy(address(note), 100e18, 101e6);
        vm.stopPrank();

        assertEq(
            vault.claimable(alice),
            0,
            "the repayment that happened before she bought is not hers"
        );
    }

    /**
     * The unsold pool earns, and what it earns belongs to the seller.
     *
     * Tokens parked at the desk are a holding like any other, so the vault
     * accrues to this contract. Without a way out those distributions would sit
     * in a contract that has no other means of spending them.
     */
    function test_SweepForwardsTheUnsoldPoolsEarningsToTheSeller() public {
        _openAtPar(5_000);
        _settle();

        uint256 owed = vault.claimable(address(desk));
        assertGt(owed, 0, "the pool accrued its half of the instalment");

        uint256 before = usdg.balanceOf(issuer);
        desk.sweep(address(note));

        assertEq(usdg.balanceOf(issuer) - before, owed, "forwarded in full");
        assertEq(vault.claimable(address(desk)), 0);
    }

    /// Sweeping with nothing owed should be a no-op, not a revert.
    function test_SweepWithNothingOwedIsQuiet() public {
        _openAtPar(5_000);
        desk.sweep(address(note));
        assertEq(vault.claimable(address(desk)), 0);
    }
}
