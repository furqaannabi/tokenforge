// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {Period, ScheduleLib} from "../src/Schedule.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

/**
 * A worked example, printed rather than asserted.
 *
 *   forge test --match-contract Example -vv
 *
 * A 1,000 USDG loan split into 100 tokens. Alice takes 60, Bob 40. Five
 * instalments each return 20% of principal plus 10 USDG of interest.
 *
 * Alice claims her cash after every instalment. Bob never claims until the
 * end. They finish with exactly their share, which is the point.
 */
contract ExampleTest is Test {
    uint256 constant LOAN = 1_000e6;
    uint256 constant TOKENS = 100e18;
    uint256 constant PERIODS = 5;
    uint256 constant PRINCIPAL_EACH = 200e6;
    uint256 constant INTEREST_EACH = 10e6;

    RWANote note;
    RepaymentVault vault;
    MockUSDG usdg;
    address issuer = makeAddr("issuer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.warp(1_790_812_800);
        IssuerRegistry registry = new IssuerRegistry(address(this));
        NoteFactory factory = new NoteFactory(registry);
        usdg = new MockUSDG();
        registry.admitIssuer(issuer, "Example Co", "Delaware, USA");
        usdg.mint(issuer, 10_000e6);

        Period[] memory schedule = new Period[](PERIODS);
        for (uint256 i = 0; i < PERIODS; i++) {
            schedule[i] = Period({
                dueDate: uint64(block.timestamp + (i + 1) * 90 days),
                principal: PRINCIPAL_EACH,
                interest: INTEREST_EACH
            });
        }

        vm.prank(issuer);
        (note, vault) = factory.mintNote(
            NoteFactory.MintParams({
                name: "Example Note",
                symbol: "EX",
                issuer: issuer,
                supply: TOKENS,
                currency: usdg,
                gracePeriod: 10 days,
                terms: RWANote.Terms({
                    principal: LOAN,
                    rateBps: 500,
                    maturity: schedule[PERIODS - 1].dueDate,
                    documentHash: keccak256("Example.pdf"),
                    scheduleHash: ScheduleLib.hash(schedule)
                }),
                schedule: schedule
            })
        );

        vm.startPrank(issuer);
        note.transfer(alice, 60e18);
        note.transfer(bob, 40e18);
        vm.stopPrank();
    }

    function test_Walkthrough() public {
        console.log("1,000 USDG loan, 100 tokens. Alice 60, Bob 40.");
        console.log("Five instalments: 200 USDG principal + 10 USDG interest each.");
        console.log("");
        console.log("period | outstanding | alice bal | bob bal | supply | alice owed | bob owed");

        _row(0);
        for (uint256 i = 1; i <= PERIODS; i++) {
            vm.startPrank(issuer);
            usdg.approve(address(vault), PRINCIPAL_EACH + INTEREST_EACH);
            vault.settleNextPeriod();
            vm.stopPrank();

            _row(i);

            // Alice collects every period; Bob leaves his to accumulate.
            if (vault.claimable(alice) > 0) {
                vm.prank(alice);
                vault.claim();
            }
        }

        vm.prank(bob);
        vault.claim();

        console.log("");
        console.log("shares never move, so ownership is unchanged throughout:");
        console.log("  alice shares", note.sharesOf(alice) / 1e18, "of", note.totalShares() / 1e18);
        console.log("  bob   shares", note.sharesOf(bob) / 1e18);
        console.log("");
        console.log("cash received (USDG):");
        console.log("  alice", usdg.balanceOf(alice) / 1e6, "= 60% of 1,050");
        console.log("  bob  ", usdg.balanceOf(bob) / 1e6, "= 40% of 1,050");
        console.log("");
        console.log("alice claimed after every instalment, bob waited. Same outcome.");
    }

    function _row(uint256 period) internal view {
        console.log(
            string.concat(
                _pad(period, 6), " | ",
                _pad((LOAN - note.principalRepaid()) / 1e6, 11), " | ",
                _pad(note.balanceOf(alice) / 1e18, 9), " | ",
                _pad(note.balanceOf(bob) / 1e18, 7), " | ",
                _pad(note.totalSupply() / 1e18, 6), " | ",
                _pad(vault.claimable(alice) / 1e6, 10), " | ",
                _pad(vault.claimable(bob) / 1e6, 8)
            )
        );
    }

    /// @dev Right-aligns a figure so the columns line up in the console.
    function _pad(uint256 value, uint256 width) internal pure returns (string memory) {
        string memory text = vm.toString(value);
        bytes memory raw = bytes(text);
        if (raw.length >= width) return text;

        bytes memory padded = new bytes(width);
        uint256 offset = width - raw.length;
        for (uint256 i = 0; i < width; i++) {
            padded[i] = i < offset ? bytes1(" ") : raw[i - offset];
        }
        return string(padded);
    }
}
