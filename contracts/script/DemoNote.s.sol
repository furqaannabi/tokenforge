// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NoteFactory} from "../src/NoteFactory.sol";
import {RWANote} from "../src/RWANote.sol";
import {RepaymentVault} from "../src/RepaymentVault.sol";
import {Period, ScheduleLib} from "../src/Schedule.sol";

/**
 * @notice Mints a small amortizing note so the on-chain flow can be exercised.
 *
 * 1,000 USDG at 10% over the term, five instalments of 200 principal plus 20
 * interest — the same figures as the worked example, on a real network.
 */
contract DemoNote is Script {
    function run() external returns (RWANote note, RepaymentVault vault) {
        NoteFactory factory = NoteFactory(vm.envAddress("FACTORY"));
        address issuer = vm.envAddress("ISSUER");
        IERC20 usdg = IERC20(vm.envAddress("USDG"));

        Period[] memory schedule = new Period[](5);
        for (uint256 i = 0; i < 5; i++) {
            schedule[i] = Period({
                dueDate: uint64(block.timestamp + (i + 1) * 90 days),
                principal: 200e6,
                interest: 20e6
            });
        }

        vm.startBroadcast();
        (note, vault) = factory.mintNote(
            NoteFactory.MintParams({
                name: "Demo Amortizing Note",
                symbol: "DEMO",
                issuer: issuer,
                supply: 1_000e18,
                currency: usdg,
                gracePeriod: 10 days,
                terms: RWANote.Terms({
                    principal: 1_000e6,
                    rateBps: 1000,
                    maturity: schedule[4].dueDate,
                    documentHash: keccak256(abi.encodePacked("demo", block.timestamp)),
                    scheduleHash: ScheduleLib.hash(schedule)
                }),
                schedule: schedule
            })
        );
        vm.stopBroadcast();

        console.log("RWANote        ", address(note));
        console.log("RepaymentVault ", address(vault));
    }
}
