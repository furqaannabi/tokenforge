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
 *      privileges beyond a treasury address, fixed at deployment. Authority
 *      over an offering is read from the note's own `issuer()` at call time.
 *
 * Usage:
 *   forge script script/DeploySaleDesk.s.sol:DeploySaleDesk \
 *     --rpc-url xlayer_testnet --account tokenforge-deployer --broadcast
 */
contract DeploySaleDesk is Script {
    function run() external returns (SaleDesk desk) {
        // Falls back to the broadcaster so a plain run needs no config.
        address treasury = vm.envOr("TREASURY", address(0));
        if (treasury == address(0)) treasury = msg.sender;

        vm.startBroadcast();
        desk = new SaleDesk(treasury);
        vm.stopBroadcast();

        console.log("treasury  ", treasury);

        console.log("chain id  ", block.chainid);
        console.log("SaleDesk  ", address(desk));
    }
}
