// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

/**
 * @notice Deploys the testnet settlement currency.
 *
 * @dev Only for networks without a real USDG. `run()` refuses to broadcast on
 *      X Layer mainnet, where the genuine token exists and a freely mintable
 *      impostor would be actively harmful.
 *
 * Usage:
 *   forge script script/DeployMockUSDG.s.sol:DeployMockUSDG \
 *     --rpc-url xlayer_testnet --account tokenforge-deployer --broadcast
 */
contract DeployMockUSDG is Script {
    error RefusingToDeployMockOnMainnet(uint256 chainId);

    /// @dev X Layer mainnet.
    uint256 internal constant XLAYER_MAINNET = 196;

    function run() external returns (MockUSDG usdg) {
        if (block.chainid == XLAYER_MAINNET) {
            revert RefusingToDeployMockOnMainnet(block.chainid);
        }

        vm.startBroadcast();
        usdg = new MockUSDG();
        // Seed the deployer so the repayment flow can be demonstrated at once.
        usdg.mint(msg.sender, 10_000_000e6);
        vm.stopBroadcast();

        console.log("chain id  ", block.chainid);
        console.log("MockUSDG  ", address(usdg));
        console.log("minted    ", usdg.balanceOf(msg.sender) / 1e6, "USDG to deployer");
    }
}
