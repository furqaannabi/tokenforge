// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {Period, ScheduleLib} from "../src/Schedule.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

/**
 * Shared fixture: the Meridian note from the demo documents.
 *
 * $2,500,000 at 8.50%, interest-only, twelve quarterly coupons of $53,125 with
 * the principal repaid in a single instalment at maturity. Those figures are
 * the ones the front end's validator reproduces, so a divergence here is a
 * genuine disagreement between the two halves of the product.
 */
abstract contract TokenForgeFixture is Test {
    IssuerRegistry internal registry;
    NoteFactory internal factory;
    MockUSDG internal usdg;

    address internal admin = makeAddr("admin");
    address internal issuer = makeAddr("issuer");
    address internal representative = makeAddr("representative");
    address internal outsider = makeAddr("outsider");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    /// @dev Roughly 2026-09-30, the fixture's agreement date.
    uint64 internal constant START = 1_790_812_800;
    uint64 internal constant QUARTER = 91 days;
    uint64 internal constant GRACE = 10 days;

    uint256 internal constant PRINCIPAL = 2_500_000e6;
    uint256 internal constant COUPON = 53_125e6;
    uint16 internal constant RATE_BPS = 850;
    uint256 internal constant PERIODS = 12;
    /// @dev 1,000 note tokens; one token is a 0.1% share of the loan.
    uint256 internal constant SUPPLY = 1_000e18;

    bytes32 internal constant DOCUMENT_HASH = keccak256("MeridianFreight_LoanAgreement.pdf");

    function setUp() public virtual {
        vm.warp(START);

        registry = new IssuerRegistry(admin);
        factory = new NoteFactory(registry);
        usdg = new MockUSDG();

        vm.prank(admin);
        registry.admitIssuer(issuer, "Meridian Freight Holdings LLC", "Delaware, USA");

        // Enough to service the loan several times over.
        usdg.mint(issuer, 10_000_000e6);
    }

    // -- Fixture builders ----------------------------------------------------

    function _schedule() internal pure returns (Period[] memory schedule) {
        schedule = new Period[](PERIODS);
        for (uint256 i = 0; i < PERIODS; i++) {
            schedule[i] = Period({
                dueDate: START + uint64(i + 1) * QUARTER,
                principal: i == PERIODS - 1 ? PRINCIPAL : 0,
                interest: COUPON
            });
        }
    }

    function _terms(Period[] memory schedule) internal pure returns (RWANote.Terms memory) {
        return RWANote.Terms({
            principal: PRINCIPAL,
            rateBps: RATE_BPS,
            maturity: schedule[schedule.length - 1].dueDate,
            documentHash: DOCUMENT_HASH,
            scheduleHash: ScheduleLib.hash(schedule)
        });
    }

    function _mintParams() internal pure returns (NoteFactory.MintParams memory) {
        Period[] memory schedule = _schedule();
        return NoteFactory.MintParams({
            name: "Meridian Freight Senior Note",
            symbol: "MFH-26",
            issuer: address(0), // filled by the caller
            supply: SUPPLY,
            currency: MockUSDG(address(0)),
            gracePeriod: GRACE,
            terms: _terms(schedule),
            schedule: schedule
        });
    }

    /// @dev Mints the fixture note as `issuer`.
    function _mint() internal returns (RWANote note, RepaymentVault vault) {
        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;

        vm.prank(issuer);
        (note, vault) = factory.mintNote(params);
    }

    /// @dev Issuer funds and settles the next period.
    function _settle(RepaymentVault vault) internal {
        uint256 due = vault.periodAt(vault.nextPeriod()).principal
            + vault.periodAt(vault.nextPeriod()).interest;

        vm.startPrank(issuer);
        usdg.approve(address(vault), due);
        vault.settleNextPeriod();
        vm.stopPrank();
    }
}

// ---------------------------------------------------------------------------

contract IssuerRegistryTest is TokenForgeFixture {
    function test_AdmittedIssuerIsRegistered() public view {
        assertTrue(registry.isRegisteredIssuer(issuer));
        assertTrue(registry.isAuthorizedRepresentative(issuer, issuer));
    }

    function test_OutsiderIsNotRegistered() public view {
        assertFalse(registry.isRegisteredIssuer(outsider));
    }

    function test_OnlyAdminCanAdmit() public {
        vm.prank(outsider);
        vm.expectRevert(IssuerRegistry.NotAdmin.selector);
        registry.admitIssuer(outsider, "Rogue Co", "Nowhere");
    }

    function test_RevokedIssuerLosesMembership() public {
        vm.prank(admin);
        registry.revokeIssuer(issuer);

        assertFalse(registry.isRegisteredIssuer(issuer));
        assertFalse(registry.isAuthorizedRepresentative(issuer, issuer));
    }

    function test_RepresentativeAuthorization() public {
        assertFalse(registry.isAuthorizedRepresentative(issuer, representative));

        vm.prank(admin);
        registry.setRepresentative(issuer, representative, true);
        assertTrue(registry.isAuthorizedRepresentative(issuer, representative));

        vm.prank(admin);
        registry.setRepresentative(issuer, representative, false);
        assertFalse(registry.isAuthorizedRepresentative(issuer, representative));
    }

    /// @dev Admission survives revocation in the audit record.
    function test_AdmittedAtSurvivesRevocation() public {
        uint64 admittedAt = registry.issuerInfo(issuer).admittedAt;
        assertEq(admittedAt, START);

        vm.prank(admin);
        registry.revokeIssuer(issuer);
        assertEq(registry.issuerInfo(issuer).admittedAt, admittedAt);
    }

    function test_AdminHandoverIsTwoStep() public {
        vm.prank(admin);
        registry.transferAdmin(outsider);
        assertEq(registry.admin(), admin, "admin changes only on acceptance");

        vm.prank(outsider);
        registry.acceptAdmin();
        assertEq(registry.admin(), outsider);
    }

    function test_OnlyPendingAdminCanAccept() public {
        vm.prank(admin);
        registry.transferAdmin(outsider);

        vm.prank(alice);
        vm.expectRevert(IssuerRegistry.NotPendingAdmin.selector);
        registry.acceptAdmin();
    }
}

// ---------------------------------------------------------------------------

contract NoteFactoryTest is TokenForgeFixture {
    /// @notice The refusal beat: an address outside the registry cannot mint.
    function test_UnregisteredIssuerCannotMint() public {
        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = outsider;
        params.currency = usdg;

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(NoteFactory.IssuerNotRegistered.selector, outsider)
        );
        factory.mintNote(params);
    }

    function test_RevokedIssuerCannotMint() public {
        vm.prank(admin);
        registry.revokeIssuer(issuer);

        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(NoteFactory.IssuerNotRegistered.selector, issuer)
        );
        factory.mintNote(params);
    }

    function test_StrangerCannotMintOnBehalfOfRegisteredIssuer() public {
        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;

        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(
                NoteFactory.NotAuthorizedRepresentative.selector, issuer, outsider
            )
        );
        factory.mintNote(params);
    }

    function test_AuthorizedRepresentativeCanMint() public {
        vm.prank(admin);
        registry.setRepresentative(issuer, representative, true);

        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;

        vm.prank(representative);
        (RWANote note,) = factory.mintNote(params);

        assertEq(note.issuer(), issuer);
        assertEq(note.balanceOf(issuer), SUPPLY, "supply goes to the issuer, not the signer");
    }

    function test_MintWiresNoteAndVaultTogether() public {
        (RWANote note, RepaymentVault vault) = _mint();

        assertEq(note.vault(), address(vault));
        assertEq(address(vault.note()), address(note));
        assertEq(vault.periodCount(), PERIODS);
        assertEq(uint8(note.status()), uint8(RWANote.Status.Active));
    }

    function test_TermsAreRecordedImmutably() public {
        (RWANote note,) = _mint();

        assertEq(note.principal(), PRINCIPAL);
        assertEq(note.rateBps(), RATE_BPS);
        assertEq(note.documentHash(), DOCUMENT_HASH);
        assertEq(note.maturity(), START + uint64(PERIODS) * QUARTER);
        assertEq(note.scheduleHash(), ScheduleLib.hash(_schedule()));
    }

    /// @notice One agreement cannot be sold twice through two tokens.
    function test_SameDocumentCannotBeTokenizedTwice() public {
        (RWANote note,) = _mint();

        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                NoteFactory.DocumentAlreadyTokenized.selector,
                DOCUMENT_HASH,
                address(note)
            )
        );
        factory.mintNote(params);
    }

    function test_ZeroDocumentHashRejected() public {
        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;
        params.terms.documentHash = bytes32(0);

        vm.prank(issuer);
        vm.expectRevert(NoteFactory.ZeroDocumentHash.selector);
        factory.mintNote(params);
    }

    /**
     * @notice A schedule that does not reproduce the note's committed hash
     *         cannot be deployed against it.
     * @dev This is what stops the terms a human approved being swapped for
     *      different ones between review and deployment.
     */
    function test_ScheduleMustMatchCommittedHash() public {
        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;

        // Terms still commit to the honest schedule; the deployed one pays the
        // issuer's investors a tenth of what was agreed.
        params.schedule[3].interest = COUPON / 10;

        bytes32 approved = ScheduleLib.hash(_schedule());
        bytes32 tampered = ScheduleLib.hash(params.schedule);
        assertTrue(approved != tampered, "fixture must actually differ");

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                RepaymentVault.ScheduleHashMismatch.selector, approved, tampered
            )
        );
        factory.mintNote(params);
    }

    function test_DeploymentIsRecorded() public {
        (RWANote note, RepaymentVault vault) = _mint();

        assertEq(factory.deploymentCount(), 1);
        NoteFactory.Deployment memory record = factory.deploymentAt(0);

        assertEq(record.note, address(note));
        assertEq(record.vault, address(vault));
        assertEq(record.issuer, issuer);
        assertEq(record.documentHash, DOCUMENT_HASH);
        assertTrue(factory.isTokenized(DOCUMENT_HASH));
    }
}

// ---------------------------------------------------------------------------

contract RepaymentTest is TokenForgeFixture {
    RWANote internal note;
    RepaymentVault internal vault;

    function setUp() public override {
        super.setUp();
        (note, vault) = _mint();
    }

    function test_OutstandingStartsAtTotalObligation() public view {
        // Twelve coupons plus the principal at maturity.
        assertEq(vault.outstanding(), COUPON * PERIODS + PRINCIPAL);
    }

    function test_SoleHolderReceivesWholeCoupon() public {
        _settle(vault);

        assertEq(vault.claimable(issuer), COUPON);

        vm.prank(issuer);
        uint256 claimed = vault.claim();
        assertEq(claimed, COUPON);
    }

    /// @notice A 10% holder receives exactly 10% of each coupon.
    function test_CouponSplitsProRata() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 10);

        _settle(vault);

        assertEq(vault.claimable(alice), COUPON / 10, "alice holds 10%");
        assertEq(vault.claimable(issuer), COUPON - COUPON / 10);

        vm.prank(alice);
        vault.claim();
        assertEq(usdg.balanceOf(alice), COUPON / 10);
    }

    /**
     * @notice The case the accumulator exists for.
     *
     * Alice holds through the first coupon, then sells the whole position to
     * Bob before the second. Each must end up with exactly the coupon that
     * accrued while they held the tokens — no double-claim, no forfeiture.
     */
    function test_TransferSplitsCouponsByWhoHeldThem() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 10);

        _settle(vault); // Coupon 1 — Alice holds

        vm.prank(alice);
        note.transfer(bob, SUPPLY / 10);

        _settle(vault); // Coupon 2 — Bob holds

        assertEq(vault.claimable(alice), COUPON / 10, "alice keeps coupon 1");
        assertEq(vault.claimable(bob), COUPON / 10, "bob earns coupon 2 only");

        vm.prank(alice);
        vault.claim();
        vm.prank(bob);
        vault.claim();

        assertEq(usdg.balanceOf(alice), COUPON / 10);
        assertEq(usdg.balanceOf(bob), COUPON / 10);

        vm.prank(alice);
        vm.expectRevert(RepaymentVault.NothingToClaim.selector);
        vault.claim();
    }

    /// @notice Buying in after a coupon settles does not capture it.
    function test_LateBuyerCannotClaimEarlierCoupon() public {
        _settle(vault); // Coupon 1 — issuer is the only holder

        vm.prank(issuer);
        note.transfer(bob, SUPPLY / 10);

        assertEq(vault.claimable(bob), 0);

        vm.prank(bob);
        vm.expectRevert(RepaymentVault.NothingToClaim.selector);
        vault.claim();
    }

    function test_PeriodsSettleInOrder() public {
        _settle(vault);
        assertEq(vault.nextPeriod(), 1);
        _settle(vault);
        assertEq(vault.nextPeriod(), 2);
    }

    function test_CannotSettleBeyondTheSchedule() public {
        for (uint256 i = 0; i < PERIODS; i++) {
            _settle(vault);
        }

        vm.startPrank(issuer);
        usdg.approve(address(vault), type(uint256).max);
        vm.expectRevert(RepaymentVault.AllPeriodsSettled.selector);
        vault.settleNextPeriod();
        vm.stopPrank();
    }

    function test_NoteMaturesAfterFinalPeriod() public {
        for (uint256 i = 0; i < PERIODS; i++) {
            _settle(vault);
        }

        assertEq(uint8(note.status()), uint8(RWANote.Status.Matured));
        assertEq(vault.outstanding(), 0);
        assertEq(vault.totalDeposited(), COUPON * PERIODS + PRINCIPAL);
    }

    /// @notice Every deposit is claimable; the vault does not trap funds.
    function test_HoldersCanClaimEverythingDeposited() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 4);

        for (uint256 i = 0; i < PERIODS; i++) {
            _settle(vault);
        }

        vm.prank(alice);
        vault.claim();
        vm.prank(issuer);
        vault.claim();

        // Integer division can strand at most a few wei of dust per deposit.
        assertApproxEqAbs(vault.totalClaimed(), vault.totalDeposited(), PERIODS);
    }
}

// ---------------------------------------------------------------------------

contract ImpairmentTest is TokenForgeFixture {
    RWANote internal note;
    RepaymentVault internal vault;

    function setUp() public override {
        super.setUp();
        (note, vault) = _mint();
    }

    function test_NotOverdueWithinGracePeriod() public {
        vm.warp(START + QUARTER + GRACE);
        assertFalse(vault.isOverdue());

        vm.expectRevert(RepaymentVault.NotOverdue.selector);
        vault.flagImpaired();
    }

    function test_AnyoneCanFlagImpairmentPastGrace() public {
        vm.warp(START + QUARTER + GRACE + 1);
        assertTrue(vault.isOverdue());

        // Permissionless: a holder should not need the issuer's cooperation.
        vm.prank(alice);
        vault.flagImpaired();

        assertEq(uint8(note.status()), uint8(RWANote.Status.Impaired));
    }

    function test_ImpairmentBlocksTransfers() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 10);

        vm.warp(START + QUARTER + GRACE + 1);
        vault.flagImpaired();

        vm.prank(alice);
        vm.expectRevert(RWANote.TransfersBlockedWhileImpaired.selector);
        note.transfer(bob, 1e18);
    }

    /// @notice Claims already earned survive impairment.
    function test_ImpairmentDoesNotBlockClaims() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 10);
        _settle(vault);

        vm.warp(START + 2 * QUARTER + GRACE + 1);
        vault.flagImpaired();

        vm.prank(alice);
        assertEq(vault.claim(), COUPON / 10);
    }

    function test_SettlingArrearsCuresImpairment() public {
        vm.warp(START + QUARTER + GRACE + 1);
        vault.flagImpaired();
        assertEq(uint8(note.status()), uint8(RWANote.Status.Impaired));

        _settle(vault);

        assertEq(uint8(note.status()), uint8(RWANote.Status.Active));

        vm.prank(issuer);
        note.transfer(alice, 1e18); // transfers work again
    }

    /**
     * @notice Paying one instalment does not cure arrears when the *next*
     *         payment is itself already overdue.
     */
    function test_CureFailsWhileStillBehind() public {
        vm.warp(START + 3 * QUARTER + GRACE + 1);
        vault.flagImpaired();

        _settle(vault); // clears period 1, but 2 and 3 are also past due

        assertEq(
            uint8(note.status()),
            uint8(RWANote.Status.Impaired),
            "still behind, so still impaired"
        );
    }
}

// ---------------------------------------------------------------------------

contract TransferRestrictionTest is TokenForgeFixture {
    RWANote internal note;

    function setUp() public override {
        super.setUp();
        (note,) = _mint();
    }

    function test_TransfersOpenByDefault() public {
        vm.prank(issuer);
        note.transfer(alice, 1e18);
        assertEq(note.balanceOf(alice), 1e18);
    }

    function test_RestrictionBlocksNonAllowlisted() public {
        vm.startPrank(issuer);
        note.setTransferRestricted(true);
        note.setAllowlisted(issuer, true);

        vm.expectRevert(
            abi.encodeWithSelector(RWANote.RecipientNotAllowlisted.selector, alice)
        );
        note.transfer(alice, 1e18);

        note.setAllowlisted(alice, true);
        note.transfer(alice, 1e18);
        vm.stopPrank();

        assertEq(note.balanceOf(alice), 1e18);
    }

    function test_OnlyIssuerControlsAllowlist() public {
        vm.prank(outsider);
        vm.expectRevert(RWANote.NotIssuer.selector);
        note.setAllowlisted(outsider, true);
    }

    function test_VaultCannotBeRebound() public {
        vm.prank(address(factory));
        vm.expectRevert(RWANote.VaultAlreadySet.selector);
        note.setVault(outsider);
    }

    function test_OnlyDeployerCanBindVault() public {
        vm.prank(outsider);
        vm.expectRevert(RWANote.NotDeployer.selector);
        note.setVault(outsider);
    }

    function test_OnlyVaultCanChangeStatus() public {
        vm.prank(issuer);
        vm.expectRevert(RWANote.NotVault.selector);
        note.setStatus(RWANote.Status.Impaired);
    }
}

// ---------------------------------------------------------------------------

/// @notice Guard clauses and malformed input — the paths that should never run.
contract ValidationTest is TokenForgeFixture {
    function test_RegistryRejectsZeroAdmin() public {
        vm.expectRevert(IssuerRegistry.ZeroAddress.selector);
        new IssuerRegistry(address(0));
    }

    function test_RegistryRejectsZeroIssuer() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistry.ZeroAddress.selector);
        registry.admitIssuer(address(0), "Nobody", "Nowhere");
    }

    function test_CannotAdmitTwice() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistry.AlreadyRegistered.selector);
        registry.admitIssuer(issuer, "Meridian Freight Holdings LLC", "Delaware, USA");
    }

    function test_CannotRevokeUnregistered() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistry.NotRegistered.selector);
        registry.revokeIssuer(outsider);
    }

    function test_CannotSetRepresentativeForUnregisteredIssuer() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistry.NotRegistered.selector);
        registry.setRepresentative(outsider, representative, true);
    }

    function test_TransferAdminRejectsZero() public {
        vm.prank(admin);
        vm.expectRevert(IssuerRegistry.ZeroAddress.selector);
        registry.transferAdmin(address(0));
    }

    function test_FactoryRejectsZeroSupply() public {
        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;
        params.supply = 0;

        vm.prank(issuer);
        vm.expectRevert(NoteFactory.ZeroSupply.selector);
        factory.mintNote(params);
    }

    function test_VaultRejectsEmptySchedule() public {
        (RWANote note,) = _mint();

        vm.expectRevert(ScheduleLib.ScheduleEmpty.selector);
        new RepaymentVault(note, usdg, issuer, GRACE, new Period[](0));
    }

    /// @dev Out-of-order due dates would break settlement and impairment both.
    function test_VaultRejectsUnsortedSchedule() public {
        (RWANote note,) = _mint();

        Period[] memory unsorted = _schedule();
        (unsorted[2], unsorted[3]) = (unsorted[3], unsorted[2]);

        vm.expectRevert(abi.encodeWithSelector(ScheduleLib.ScheduleNotAscending.selector, 3));
        new RepaymentVault(note, usdg, issuer, GRACE, unsorted);
    }

    function test_VaultRejectsDuplicateDueDates() public {
        (RWANote note,) = _mint();

        Period[] memory duplicated = _schedule();
        duplicated[5].dueDate = duplicated[4].dueDate;

        vm.expectRevert(abi.encodeWithSelector(ScheduleLib.ScheduleNotAscending.selector, 5));
        new RepaymentVault(note, usdg, issuer, GRACE, duplicated);
    }

    function test_ScheduleTotalMatchesObligation() public pure {
        assertEq(ScheduleLib.total(_schedule()), COUPON * PERIODS + PRINCIPAL);
    }

    function test_OnlyNoteCanSyncHolders() public {
        (, RepaymentVault vault) = _mint();

        vm.prank(outsider);
        vm.expectRevert(RepaymentVault.NotNote.selector);
        vault.syncHolder(alice);
    }

    function test_ClaimingNothingReverts() public {
        (, RepaymentVault vault) = _mint();

        vm.prank(alice);
        vm.expectRevert(RepaymentVault.NothingToClaim.selector);
        vault.claim();
    }

    function test_HashScheduleMatchesLibrary() public {
        (, RepaymentVault vault) = _mint();
        assertEq(vault.hashSchedule(_schedule()), ScheduleLib.hash(_schedule()));
    }
}

// ---------------------------------------------------------------------------

contract DistributionFuzzTest is TokenForgeFixture {
    RWANote internal note;
    RepaymentVault internal vault;

    function setUp() public override {
        super.setUp();
        (note, vault) = _mint();
    }

    /**
     * @notice However the position is split, holders can never claim more than
     *         the issuer deposited.
     */
    function testFuzz_ClaimsNeverExceedDeposits(uint256 aliceShare, uint8 couponCount)
        public
    {
        aliceShare = bound(aliceShare, 0, SUPPLY);
        uint256 count = bound(couponCount, 1, PERIODS);

        if (aliceShare > 0) {
            vm.prank(issuer);
            note.transfer(alice, aliceShare);
        }

        for (uint256 i = 0; i < count; i++) {
            _settle(vault);
        }

        uint256 total = vault.claimable(alice) + vault.claimable(issuer);
        assertLe(total, vault.totalDeposited(), "distribution cannot exceed deposits");
        // Only rounding dust may be stranded — at most 1 wei per holder per deposit.
        assertApproxEqAbs(total, vault.totalDeposited(), 2 * count);
    }

    /// @notice Splitting a position never creates or destroys entitlement.
    function testFuzz_TransferPreservesTotalEntitlement(uint256 amount) public {
        amount = bound(amount, 0, SUPPLY);

        _settle(vault);
        uint256 before = vault.claimable(issuer);

        vm.prank(issuer);
        note.transfer(alice, amount);

        assertEq(
            vault.claimable(issuer) + vault.claimable(alice),
            before,
            "a transfer moves tokens, not accrued coupons"
        );
    }
}
