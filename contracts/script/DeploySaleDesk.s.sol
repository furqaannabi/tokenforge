// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {SaleDesk} from "../src/SaleDesk.sol";

/**
 * @notice Deploys the primary offering desk.
 *
 * @dev One desk serves every note, so this runs once per network rather than
 *      once per issuance. It takes no constructor arguments and holds no
 *      privileges: authority over an offering is read from the note's own
 *      `issuer()` at call time, so there is nothing here to configure and
 *      nothing to get wrong.
 *
 * Usage:
 *   forge script script/DeploySaleDesk.s.sol:DeploySaleDesk \
 *     --rpc-url xlayer_testnet --account tokenforge-deployer --broadcast
 */
contract DeploySaleDesk is Script {
    function run() external returns (SaleDesk desk) {
        vm.startBroadcast();
        desk = new SaleDesk();
        vm.stopBroadcast();

        console.log("chain id  ", block.chainid);
        console.log("SaleDesk  ", address(desk));
    }
}
