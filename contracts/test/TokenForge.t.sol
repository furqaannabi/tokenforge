// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {Period, ScheduleLib} from "../src/Schedule.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

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
    /// @dev Owes the money. The issuer originated the loan and sells it on.
    address internal borrower = makeAddr("borrower");
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
        // Both ends of a loan are admitted through the same registry.
        vm.prank(admin);
        registry.admitBorrower(borrower, "Meridian Freight Operating Co", "Delaware, USA");

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

    function _mintParams() internal view returns (NoteFactory.MintParams memory) {
        Period[] memory schedule = _schedule();
        return NoteFactory.MintParams({
            name: "Meridian Freight Senior Note",
            symbol: "MFH-26",
            issuer: address(0), // filled by the caller
            borrower: borrower,
            supply: SUPPLY,
            currency: MockUSDG(address(0)),
            gracePeriod: GRACE,
            terms: _terms(schedule),
            schedule: schedule
        });
    }

    /// @dev Clears an exact set of mint parameters, as the admin would.
    function _approveMint(NoteFactory.MintParams memory params) internal {
        // Read the hash before the prank: a call in the argument list consumes
        // it, and the approval would arrive from the test contract instead.
        bytes32 approval = factory.mintHash(params);
        vm.prank(admin);
        registry.approveMint(params.issuer, approval);
    }

    /// @dev Mints the fixture note as `issuer`, accepted by the borrower.
    function _mint() internal returns (RWANote note, RepaymentVault vault) {
        (note, vault) = _mintPending();
        vm.prank(borrower);
        note.accept();
    }

    /// @dev Mints but leaves the note awaiting the borrower's signature.
    function _mintPending() internal returns (RWANote note, RepaymentVault vault) {
        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;

        _approveMint(params);
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

/**
 * Three parties, and the note keeps them apart.
 *
 * The issuer originated the loan and is selling it to get their capital back
 * early. The borrower owes the money. The holders own the repayments. Before
 * `borrower` existed the first two were the same address, which made the
 * originator appear to owe a debt to the people they had just sold it to.
 */
contract PartiesTest is TokenForgeFixture {
    function test_IssuerAndBorrowerAreDifferentParties() public {
        (RWANote note,) = _mint();

        assertEq(note.issuer(), issuer);
        assertEq(note.borrower(), borrower);
        assertTrue(note.issuer() != note.borrower());
    }

    /// The supply is minted to the issuer to sell. The borrower owns none of it.
    function test_BorrowerHoldsNoneOfTheLoan() public {
        (RWANote note,) = _mint();

        assertEq(note.balanceOf(issuer), SUPPLY);
        assertEq(note.balanceOf(borrower), 0);
    }

    /**
     * The borrower pays, and the money reaches the holders.
     *
     * This is the whole three-party loop in one test: the issuer sells a stake
     * to Alice, the borrower settles a period out of their own balance, and
     * Alice can claim a share of it.
     */
    function test_BorrowerRepaysAndHoldersAreDistributed() public {
        (RWANote note, RepaymentVault vault) = _mint();

        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 4);

        uint256 due = vault.periodAt(0).principal + vault.periodAt(0).interest;
        usdg.mint(borrower, due);

        uint256 issuerBefore = usdg.balanceOf(issuer);

        vm.startPrank(borrower);
        usdg.approve(address(vault), due);
        vault.settleNextPeriod();
        vm.stopPrank();

        assertEq(
            usdg.balanceOf(issuer),
            issuerBefore,
            "the originator pays nothing to service a loan they sold"
        );
        assertEq(vault.claimable(alice), due / 4, "the holder is owed her share");

        uint256 aliceBefore = usdg.balanceOf(alice);
        vm.prank(alice);
        vault.claim();
        assertEq(usdg.balanceOf(alice) - aliceBefore, due / 4);
    }

    /**
     * Paying is open to anyone, and deliberately so.
     *
     * A guarantor, a servicer, or the originator covering a shortfall may all
     * legitimately settle. Restricting it to the borrower would let one lost
     * key strand a performing loan.
     */
    function test_AnyoneMaySettleOnTheBorrowersBehalf() public {
        (, RepaymentVault vault) = _mint();

        uint256 due = vault.periodAt(0).principal + vault.periodAt(0).interest;
        usdg.mint(outsider, due);

        vm.startPrank(outsider);
        usdg.approve(address(vault), due);
        vault.settleNextPeriod();
        vm.stopPrank();

        assertEq(vault.nextPeriod(), 1);
    }
}

/**
 * Nothing happens until the borrower signs.
 *
 * A minted note is the issuer's assertion about someone else. These tests are
 * the difference between that and a debt the borrower acknowledged.
 */
contract AcceptanceTest is TokenForgeFixture {
    function test_NoteStartsPending() public {
        (RWANote note,) = _mintPending();
        assertEq(uint8(note.status()), uint8(RWANote.Status.Pending));
    }

    function test_BorrowerAcceptsAndTheNoteGoesActive() public {
        (RWANote note,) = _mintPending();

        vm.prank(borrower);
        note.accept();

        assertEq(uint8(note.status()), uint8(RWANote.Status.Active));
    }

    function test_NobodyElseCanAcceptOnTheBorrowersBehalf() public {
        (RWANote note,) = _mintPending();

        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(RWANote.NotBorrower.selector, issuer));
        note.accept();
    }

    function test_AcceptingTwiceReverts() public {
        (RWANote note,) = _mint(); // already accepted

        vm.prank(borrower);
        vm.expectRevert(RWANote.NotPending.selector);
        note.accept();
    }

    /// A stake cannot change hands in an instrument nobody has affirmed.
    function test_TransfersAreBlockedWhilePending() public {
        (RWANote note,) = _mintPending();

        vm.prank(issuer);
        vm.expectRevert(RWANote.NotAcceptedYet.selector);
        note.transfer(alice, 1e18);
    }

    /// Nor can money be taken against one.
    function test_SettlementIsBlockedWhilePending() public {
        (, RepaymentVault vault) = _mintPending();

        uint256 due = vault.periodAt(0).principal + vault.periodAt(0).interest;
        vm.startPrank(issuer);
        usdg.approve(address(vault), due);
        vm.expectRevert(RepaymentVault.NotAcceptedYet.selector);
        vault.settleNextPeriod();
        vm.stopPrank();
    }

    /**
     * The two roles are separate rights.
     *
     * Reading borrowers out of the issuer list handed every admitted borrower
     * the right to mint — a company allowed to owe money became one allowed to
     * create notes.
     */
    function test_BorrowerIsNotThereforeAnIssuer() public {
        assertTrue(registry.isRegisteredBorrower(borrower));
        assertFalse(registry.isRegisteredIssuer(borrower), "borrowing is not issuing");
    }

    function test_IssuerIsNotThereforeABorrower() public view {
        assertTrue(registry.isRegisteredIssuer(issuer));
        assertFalse(registry.isRegisteredBorrower(issuer));
    }

    /// Both ends of the loan must be admitted before either can be named.
    function test_UnregisteredBorrowerCannotBeNamed() public {
        NoteFactory.MintParams memory params = _mintParams();
        params.issuer = issuer;
        params.borrower = outsider;
        params.currency = usdg;

        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(NoteFactory.BorrowerNotRegistered.selector, outsider)
        );
        factory.mintNote(params);
    }
}

/**
 * Automated repayment.
 *
 * A contract cannot wake itself up, so something off-chain has to call — but
 * the money moved is the borrower's, and only as far as their own standing
 * approval allows. These tests are the difference between automation and a
 * service quietly holding a mandate over someone's balance.
 */
contract AutomatedRepaymentTest is TokenForgeFixture {
    RWANote internal note;
    RepaymentVault internal vault;

    function setUp() public override {
        super.setUp();
        (note, vault) = _mint();
        usdg.mint(borrower, 10_000_000e6);
    }

    function _due() internal view returns (uint256) {
        uint256 i = vault.nextPeriod();
        return vault.periodAt(i).principal + vault.periodAt(i).interest;
    }

    function test_NothingIsCollectibleWithoutAuthorization() public {
        vm.warp(vault.periodAt(0).dueDate);
        assertFalse(vault.collectible(), "no allowance, nothing to pull");
        assertEq(vault.authorizedAmount(), 0);
    }

    /// One approval covers the whole schedule; no signature per instalment.
    function test_OneAuthorizationCoversEveryInstalment() public {
        vm.prank(borrower);
        usdg.approve(address(vault), type(uint256).max);

        for (uint256 i = 0; i < PERIODS; i++) {
            vm.warp(vault.periodAt(vault.nextPeriod()).dueDate);
            assertTrue(vault.collectible());
            vault.collectFromBorrower();
        }

        assertEq(vault.nextPeriod(), PERIODS);
        assertEq(uint8(note.status()), uint8(RWANote.Status.Matured));
    }

    function test_CollectionIsRefusedBeforeTheDueDate() public {
        vm.prank(borrower);
        usdg.approve(address(vault), type(uint256).max);

        uint64 due = vault.periodAt(0).dueDate;
        vm.warp(due - 1);

        assertFalse(vault.collectible());
        vm.expectRevert(
            abi.encodeWithSelector(RepaymentVault.NotDueYet.selector, 0, due)
        );
        vault.collectFromBorrower();
    }

    /// The borrower may still pay early out of their own pocket.
    function test_BorrowerCanStillPayEarlyThemselves() public {
        uint256 due = _due();
        vm.startPrank(borrower);
        usdg.approve(address(vault), due);
        vault.settleNextPeriod();
        vm.stopPrank();

        assertEq(vault.nextPeriod(), 1);
    }

    /**
     * Anyone may trigger it, and it costs them nothing.
     *
     * The keeper is an outsider here. The money leaves the borrower, and the
     * outsider is out only their gas — which is what makes a permissionless
     * keeper safe rather than merely convenient.
     */
    function test_AnyKeeperCanTriggerItAndPaysNothing() public {
        vm.prank(borrower);
        usdg.approve(address(vault), type(uint256).max);
        vm.warp(vault.periodAt(0).dueDate);

        uint256 due = _due();
        uint256 keeperBefore = usdg.balanceOf(outsider);
        uint256 borrowerBefore = usdg.balanceOf(borrower);

        vm.prank(outsider);
        vault.collectFromBorrower();

        assertEq(usdg.balanceOf(outsider), keeperBefore, "keeper paid nothing");
        assertEq(borrowerBefore - usdg.balanceOf(borrower), due, "borrower paid");
    }

    /// Revoking the approval stops it. The mandate is the borrower's to end.
    function test_RevokingTheApprovalStopsCollection() public {
        vm.prank(borrower);
        usdg.approve(address(vault), type(uint256).max);
        vm.warp(vault.periodAt(0).dueDate);
        vault.collectFromBorrower();

        vm.prank(borrower);
        usdg.approve(address(vault), 0);

        vm.warp(vault.periodAt(1).dueDate);
        assertFalse(vault.collectible(), "authorization withdrawn");
        vm.expectRevert();
        vault.collectFromBorrower();
    }

    /// Collected money reaches holders the same way a manual payment does.
    function test_CollectedPaymentReachesHolders() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 4);

        vm.prank(borrower);
        usdg.approve(address(vault), type(uint256).max);
        vm.warp(vault.periodAt(0).dueDate);

        uint256 due = _due();
        vault.collectFromBorrower();

        assertEq(vault.claimable(alice), due / 4);
    }
}

// ---------------------------------------------------------------------------

/**
 * The admin clears a document before it can be tokenized.
 *
 * Registry membership answers whether a company may issue at all. This answers
 * whether it may issue *this* — the judgement a reviewer actually makes about
 * one agreement.
 */
contract MintApprovalTest is TokenForgeFixture {
    function _params() internal view returns (NoteFactory.MintParams memory params) {
        params = _mintParams();
        params.issuer = issuer;
        params.currency = usdg;
    }

    function test_RegisteredIssuerStillNeedsApproval() public {
        NoteFactory.MintParams memory params = _params();

        bytes32 expected = factory.mintHash(params);
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                NoteFactory.MintNotApproved.selector, issuer, expected
            )
        );
        factory.mintNote(params);
    }

    function test_ApprovalLetsExactlyThoseParametersThrough() public {
        NoteFactory.MintParams memory params = _params();
        _approveMint(params);

        vm.prank(issuer);
        (RWANote note,) = factory.mintNote(params);
        assertEq(note.documentHash(), DOCUMENT_HASH);
    }

    /**
     * The point of hashing the whole mint rather than the document.
     *
     * An interface that could raise the supply, move the borrower, or restate
     * the principal after the admin decided would make the approval a
     * formality. Each of these is the approved document and the approved
     * issuer, and each is refused.
     */
    function test_SupplyCannotBeChangedAfterApproval() public {
        NoteFactory.MintParams memory params = _params();
        _approveMint(params);

        params.supply = SUPPLY * 2;
        bytes32 tampered = factory.mintHash(params);
        vm.prank(issuer);
        vm.expectRevert(
            abi.encodeWithSelector(
                NoteFactory.MintNotApproved.selector, issuer, tampered
            )
        );
        factory.mintNote(params);
    }

    function test_PrincipalCannotBeChangedAfterApproval() public {
        NoteFactory.MintParams memory params = _params();
        _approveMint(params);

        params.terms.principal = PRINCIPAL + 1;
        vm.prank(issuer);
        vm.expectRevert();
        factory.mintNote(params);
    }

    function test_BorrowerCannotBeChangedAfterApproval() public {
        NoteFactory.MintParams memory params = _params();
        _approveMint(params);

        params.borrower = outsider;
        vm.prank(issuer);
        vm.expectRevert();
        factory.mintNote(params);
    }

    function test_ScheduleCannotBeChangedAfterApproval() public {
        NoteFactory.MintParams memory params = _params();
        _approveMint(params);

        Period[] memory tampered = _schedule();
        tampered[0].interest = COUPON * 2;
        params.schedule = tampered;
        params.terms.scheduleHash = ScheduleLib.hash(tampered);

        vm.prank(issuer);
        vm.expectRevert();
        factory.mintNote(params);
    }

    /// An approval belongs to one issuer; another cannot ride on it.
    function test_ApprovalDoesNotTransferToAnotherIssuer() public {
        NoteFactory.MintParams memory params = _params();
        _approveMint(params);

        address rival = makeAddr("rival");
        vm.prank(admin);
        registry.admitIssuer(rival, "Rival Capital", "Delaware, USA");

        params.issuer = rival;
        vm.prank(rival);
        vm.expectRevert();
        factory.mintNote(params);
    }

    function test_OnlyAdminApproves() public {
        vm.prank(issuer);
        vm.expectRevert(IssuerRegistry.NotAdmin.selector);
        registry.approveMint(issuer, keccak256("anything"));
    }

    function test_ApprovalCanBeWithdrawnBeforeItIsUsed() public {
        NoteFactory.MintParams memory params = _params();
        bytes32 h = factory.mintHash(params);
        _approveMint(params);
        assertTrue(registry.isMintApproved(issuer, h));

        vm.prank(admin);
        registry.revokeMintApproval(issuer, h);
        assertFalse(registry.isMintApproved(issuer, h));
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
        _approveMint(params);

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

        // The admin cleared these terms, which commit to the honest schedule.
        // Swapping the array afterwards leaves the approval intact — that is
        // precisely the substitution the vault's own check exists to catch.
        _approveMint(params);

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

/// @notice Amortization: balances fall as principal comes back.
contract AmortizationTest is TokenForgeFixture {
    RWANote internal note;
    RepaymentVault internal vault;

    function setUp() public override {
        super.setUp();
        (note, vault) = _mint();
    }

    function _settleAll() internal {
        for (uint256 i = 0; i < PERIODS; i++) {
            _settle(vault);
        }
    }

    /// @notice Interest is a payment on the loan, not a repayment of it.
    function test_InterestOnlyPeriodsDoNotAmortize() public {
        _settle(vault); // coupon only; principal comes at maturity

        assertEq(note.principalRepaid(), 0);
        assertEq(note.totalSupply(), SUPPLY, "supply is untouched by a coupon");
        assertEq(note.balanceOf(issuer), SUPPLY);
    }

    /// @notice The final period returns the principal, and the note is spent.
    function test_PrincipalRepaymentRetiresTheSupply() public {
        _settleAll();

        assertEq(note.principalRepaid(), PRINCIPAL);
        assertEq(note.principalIndex(), 0, "nothing outstanding");
        assertEq(note.totalSupply(), 0, "no tokens left to represent a claim");
        assertEq(note.balanceOf(issuer), 0);
        // Ownership survives as the record of who is owed the cash.
        assertEq(note.totalShares(), SUPPLY);
    }

    /**
     * @notice The property the whole design exists for.
     *
     * Two identical positions must earn identically, regardless of who
     * collects their cash first. Alice claims after every period; Bob never
     * claims until the end.
     */
    function test_CollectingEarlyEarnsNoLessThanWaiting() public {
        vm.startPrank(issuer);
        note.transfer(alice, SUPPLY / 4);
        note.transfer(bob, SUPPLY / 4);
        vm.stopPrank();

        for (uint256 i = 0; i < PERIODS; i++) {
            _settle(vault);
            if (vault.claimable(alice) > 0) {
                vm.prank(alice);
                vault.claim();
            }
        }

        vm.prank(bob);
        vault.claim();

        assertEq(
            usdg.balanceOf(alice),
            usdg.balanceOf(bob),
            "claiming promptly must not cost anything"
        );
    }

    /// @notice Amortization moves every balance by the same fraction.
    function test_BalancesFallInStep() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 4);

        uint256 aliceBefore = note.balanceOf(alice);
        uint256 issuerBefore = note.balanceOf(issuer);

        _settleAll();

        assertEq(note.balanceOf(alice), 0);
        assertEq(note.balanceOf(issuer), 0);
        assertGt(aliceBefore, 0);
        assertGt(issuerBefore, 0);
    }

    /// @notice Shares are the ownership record and amortization cannot touch them.
    function test_SharesSurviveAmortization() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 4);

        uint256 shares = note.sharesOf(alice);
        _settleAll();

        assertEq(note.sharesOf(alice), shares, "ownership is unchanged");
        assertEq(note.balanceOf(alice), 0, "but it is worth nothing now");
    }

    /// @notice Entitlement follows shares, so a transfer still moves the claim.
    function test_TransferMovesTheClaimAfterAmortization() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 4);

        _settle(vault);

        uint256 owed = vault.claimable(alice);
        assertGt(owed, 0);

        // Read before the prank: vm.prank applies to the next call, and an
        // argument that is itself a call would consume it.
        uint256 position = note.balanceOf(alice);

        // Alice sells her whole position; the coupon she already earned stays.
        vm.prank(alice);
        note.transfer(bob, position);

        assertEq(vault.claimable(alice), owed, "earned coupons do not transfer");
        assertEq(note.sharesOf(bob), SUPPLY / 4, "the position does");
    }

    function test_OnlyVaultCanAmortize() public {
        vm.prank(issuer);
        vm.expectRevert(RWANote.NotVault.selector);
        note.amortize(1);
    }

    /// @notice Everything deposited remains claimable after full amortization.
    function test_ClaimsStillWorkOnASpentNote() public {
        vm.prank(issuer);
        note.transfer(alice, SUPPLY / 4);

        _settleAll();
        assertEq(note.balanceOf(alice), 0);

        vm.prank(alice);
        assertGt(vault.claim(), 0, "a spent token still owes its holder cash");

        vm.prank(issuer);
        vault.claim();
        assertApproxEqAbs(vault.totalClaimed(), vault.totalDeposited(), PERIODS);
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

// ---------------------------------------------------------------------------

/**
 * @notice An amortizing loan, where principal returns a slice at a time.
 *
 * The fixture above is interest-only, so its supply survives untouched until
 * the final period. This one repays 10% of principal every period, which is
 * where the design earns its keep: a holder watches their balance fall in step
 * with what they have been repaid.
 */
contract AmortizingScheduleTest is TokenForgeFixture {
    uint256 internal constant LOAN = 1_000e6; // 1,000 USDG
    uint256 internal constant TOKENS = 100e18; // 100 tokens
    uint256 internal constant INSTALMENTS = 10; // 10% of principal each
    uint256 internal constant PRINCIPAL_PER_PERIOD = LOAN / INSTALMENTS;
    uint256 internal constant INTEREST_PER_PERIOD = 5e6;

    RWANote internal note;
    RepaymentVault internal vault;

    function _amortizingSchedule() internal pure returns (Period[] memory schedule) {
        schedule = new Period[](INSTALMENTS);
        for (uint256 i = 0; i < INSTALMENTS; i++) {
            schedule[i] = Period({
                dueDate: START + uint64(i + 1) * QUARTER,
                principal: PRINCIPAL_PER_PERIOD,
                interest: INTEREST_PER_PERIOD
            });
        }
    }

    function setUp() public override {
        super.setUp();

        Period[] memory schedule = _amortizingSchedule();
        NoteFactory.MintParams memory params = NoteFactory.MintParams({
            name: "Amortizing Note",
            symbol: "AMRT",
            issuer: issuer,
            borrower: borrower,
            supply: TOKENS,
            currency: usdg,
            gracePeriod: GRACE,
            terms: RWANote.Terms({
                principal: LOAN,
                rateBps: 500,
                maturity: schedule[INSTALMENTS - 1].dueDate,
                documentHash: keccak256("Amortizing.pdf"),
                scheduleHash: ScheduleLib.hash(schedule)
            }),
            schedule: schedule
        });

        _approveMint(params);
        _approveMint(params);
        vm.prank(issuer);
        (note, vault) = factory.mintNote(params);

        vm.prank(borrower);
        note.accept();
    }

    /// @notice 1,000 USDG, 100 tokens, 10% repaid: 100 tokens become 90.
    function test_TenPercentRepaidRetiresTenPercentOfTheBalance() public {
        vm.prank(issuer);
        note.transfer(alice, TOKENS);
        assertEq(note.balanceOf(alice), 100e18);

        _settle(vault);

        assertEq(note.balanceOf(alice), 90e18, "10% of the position is repaid");
        assertEq(note.totalSupply(), 90e18);
        assertEq(vault.claimable(alice), PRINCIPAL_PER_PERIOD + INTEREST_PER_PERIOD);
    }

    /// @notice The balance tracks outstanding principal at every step.
    function test_BalanceTracksOutstandingPrincipal() public {
        vm.prank(issuer);
        note.transfer(alice, TOKENS);

        for (uint256 i = 1; i <= INSTALMENTS; i++) {
            _settle(vault);

            uint256 outstanding = LOAN - (PRINCIPAL_PER_PERIOD * i);
            assertEq(
                note.balanceOf(alice),
                (TOKENS * outstanding) / LOAN,
                "balance is the share of principal still owed"
            );
        }

        assertEq(note.balanceOf(alice), 0, "fully repaid leaves nothing");
        assertEq(note.totalSupply(), 0);
    }

    /// @notice Two equal holders are repaid equally, whenever they collect.
    function test_AmortizationIsEvenAcrossHolders() public {
        vm.startPrank(issuer);
        note.transfer(alice, TOKENS / 2);
        note.transfer(bob, TOKENS / 2);
        vm.stopPrank();

        // Alice collects after every instalment; Bob waits until the end.
        for (uint256 i = 0; i < INSTALMENTS; i++) {
            _settle(vault);
            vm.prank(alice);
            vault.claim();
        }

        vm.prank(bob);
        vault.claim();

        assertEq(note.balanceOf(alice), note.balanceOf(bob));
        assertEq(
            usdg.balanceOf(alice),
            usdg.balanceOf(bob),
            "collecting early must not cost anything"
        );
        assertEq(
            usdg.balanceOf(alice),
            (LOAN + INTEREST_PER_PERIOD * INSTALMENTS) / 2,
            "each holder receives half of principal plus interest"
        );
    }
}
