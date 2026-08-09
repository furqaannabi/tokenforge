// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDG
 * @notice Stand-in for USDG, the settlement currency coupons are paid in.
 *
 * @dev TESTNET ONLY. Minting is unrestricted so anyone demoing the repayment
 *      flow can fund themselves; that obviously makes it worthless as money and
 *      it must never be deployed to mainnet. Point `RepaymentVault` at the real
 *      USDG there.
 *
 *      Six decimals, matching the major dollar stablecoins. That mismatch
 *      against the note's 18 is deliberate: the distribution math has to be
 *      right across differing decimals, and a same-decimals token would hide
 *      any error there.
 */
contract MockUSDG is ERC20 {
    constructor() ERC20("Mock USDG", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Unrestricted faucet. Testnet only.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
