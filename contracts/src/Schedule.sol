// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @notice One scheduled payment on a note.
 * @dev Interest-only structures carry `principal == 0` until the final period.
 */
struct Period {
    /// @notice Unix timestamp the payment falls due.
    uint64 dueDate;
    uint256 principal;
    uint256 interest;
}

/**
 * @title ScheduleLib
 * @notice The canonical encoding of a repayment schedule.
 *
 * @dev `RWANote` stores only the hash of its schedule, and `RepaymentVault`
 *      refuses to deploy against a schedule that does not reproduce it. Both
 *      sides — and any off-chain tool preparing a mint — must agree on exactly
 *      how that hash is computed, which is why it lives in one place rather
 *      than being spelled out at each call site.
 */
library ScheduleLib {
    error ScheduleEmpty();
    error ScheduleNotAscending(uint256 index);

    function hash(Period[] memory schedule) internal pure returns (bytes32) {
        return keccak256(abi.encode(schedule));
    }

    /// @notice Reverts unless due dates strictly increase.
    function validate(Period[] memory schedule) internal pure {
        uint256 length = schedule.length;
        if (length == 0) revert ScheduleEmpty();

        for (uint256 i = 1; i < length; i++) {
            if (schedule[i].dueDate <= schedule[i - 1].dueDate) {
                revert ScheduleNotAscending(i);
            }
        }
    }

    /// @notice Sum of every principal and interest payment in the schedule.
    function total(Period[] memory schedule) internal pure returns (uint256 sum) {
        for (uint256 i = 0; i < schedule.length; i++) {
            sum += schedule[i].principal + schedule[i].interest;
        }
    }
}
