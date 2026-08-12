// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {Period} from "../src/Schedule.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";

/**
 * `NoteFactory.mintHash` against a value the front end computes independently.
 *
 * The admin approves this hash and the factory checks it, so the two
 * implementations must agree byte for byte or every approved mint reverts for
 * no visible reason. `hashMintArgs` in web/lib/contracts/mint.ts produces the
 * constant below for the same inputs; if either side changes, this fails.
 */
contract MintHashParityTest is Test {
    bytes32 internal constant EXPECTED =
        0x74dc9f0b32becdf19405cd99473a3a851c6e1a822223d01cf702774e5a3e0bf2;

    function test_MatchesTheFrontEnd() public {
        NoteFactory f = new NoteFactory(new IssuerRegistry(address(this)));
        Period[] memory s = new Period[](1);
        s[0] = Period({dueDate: 1798675200, principal: 0, interest: 53125000000});
        NoteFactory.MintParams memory p = NoteFactory.MintParams({
            name: "Meridian Freight Senior Note",
            symbol: "MFH-26",
            issuer: 0x35134987bB541607Cd45e62Dd1feA4F587607817,
            borrower: 0x832DF21E7d063F0738183cA5960Bda081D4b9146,
            supply: 1000e18,
            currency: MockUSDG(0x6AF29b12f4df68C9416A0DC87B80a718ed054A94),
            gracePeriod: 864000,
            terms: RWANote.Terms({
                principal: 2500000000000,
                rateBps: 850,
                maturity: 1798675200,
                documentHash: keccak256("doc"),
                scheduleHash: keccak256("sched")
            }),
            schedule: s
        });
        assertEq(f.mintHash(p), EXPECTED, "web/lib/contracts/mint.ts disagrees");
    }
}
