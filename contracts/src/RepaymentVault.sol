// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RWANote} from "./RWANote.sol";
import {Period, ScheduleLib} from "./Schedule.sol";

/**
 * @title RepaymentVault
 * @notice Holds one note's repayment schedule, receives the issuer's deposits
 *         in the settlement currency, and distributes them pro-rata to holders.
 *
 * @dev Distribution uses the standard accumulator pattern: each deposit raises
 *      a running coupon-per-token figure, and every holder carries a checkpoint
 *      of the value they were last settled at. `RWANote` calls `syncHolder` for
 *      both parties before any balance change, so entitlements are always
 *      credited to whoever actually held the tokens while the coupon accrued.
 *      Selling immediately after a deposit does not forfeit that coupon, and
 *      buying immediately after one does not capture it.
 *
 *      Periods settle strictly in order. A loan cannot skip a missed payment,
 *      and impairment is defined against the earliest unsettled period.
 */
contract RepaymentVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ScheduleLib for Period[];

    /// @dev Fixed-point scale for the coupon-per-token accumulator.
    uint256 private constant ACC_PRECISION = 1e18;

    RWANote public immutable note;
    /// @notice Settlement currency. USDG on X Layer for this deployment.
    IERC20 public immutable currency;
    address public immutable issuer;
    /// @notice Seconds after a due date before the note may be flagged impaired.
    uint64 public immutable gracePeriod;

    Period[] private _schedule;

    /// @notice Index of the earliest period not yet settled.
    uint256 public nextPeriod;

    /**
     * @dev Cumulative settlement currency paid per *share*, scaled by 1e18.
     *
     * Per share rather than per token, because a token's value amortizes as
     * principal comes back while a share is a fixed slice of the loan. Dividing
     * by a shrinking supply would pay latecomers more than prompt holders for
     * the same position.
     */
    uint256 public accPerShare;

    mapping(address holder => uint256) private _checkpoint;
    mapping(address holder => uint256) private _accrued;

    /// @notice Total deposited by the issuer, for reconciliation.
    uint256 public totalDeposited;

    /// @notice Taken from collections and paid to the protocol treasury.
    uint256 public totalFees;

    /// @notice Where this note's fee goes. Frozen at mint.
    address public immutable treasury;

    /// @notice This note's fee, in basis points. Frozen at mint.
    uint16 public immutable feeBps;
    /// @notice Total withdrawn by holders.
    uint256 public totalClaimed;

    event PeriodSettled(uint256 indexed period, uint256 amount, uint256 accPerToken);
    event Claimed(address indexed holder, uint256 amount);
    event Impaired(uint256 indexed period, uint64 dueDate);
    event Cured(uint256 indexed period);
    event Matured();
    event ProtocolFeePaid(uint256 indexed period, uint256 amount);

    error NotIssuer();
    error NotNote();
    error ScheduleHashMismatch(bytes32 expected, bytes32 actual);
    error AllPeriodsSettled();
    error NothingToClaim();
    error NoSupply();
    error NotDueYet(uint256 period, uint64 dueDate);
    error NotOverdue();

    constructor(
        RWANote note_,
        IERC20 currency_,
        address issuer_,
        uint64 gracePeriod_,
        Period[] memory schedule_,
        address treasury_,
        uint16 feeBps_
    ) {
        schedule_.validate();

        // The note's immutable scheduleHash is what the reviewer approved. If
        // the schedule handed to this vault does not reproduce it, the two
        // disagree about what was signed and deployment must fail.
        bytes32 actual = schedule_.hash();
        if (actual != note_.scheduleHash()) {
            revert ScheduleHashMismatch(note_.scheduleHash(), actual);
        }

        for (uint256 i = 0; i < schedule_.length; i++) {
            _schedule.push(schedule_[i]);
        }

        note = note_;
        currency = currency_;
        treasury = treasury_;
        feeBps = feeBps_;
        issuer = issuer_;
        gracePeriod = gracePeriod_;
    }

    /// @notice Canonical hash of a schedule, matching `RWANote.scheduleHash`.
    function hashSchedule(Period[] memory schedule_) external pure returns (bytes32) {
        return schedule_.hash();
    }

    // -----------------------------------------------------------------------
    // Settlement
    // -----------------------------------------------------------------------

    /**
     * @notice Issuer deposits the next period's payment.
     * @dev Pulls `principal + interest` for the earliest unsettled period and
     *      credits it across the supply. Anyone may fund a payment on the
     *      issuer's behalf — what matters to holders is that it arrives.
     */
    /**
     * @notice Pays the next instalment from the caller's own balance.
     * @dev Early payment is allowed. A borrower who wants to clear a period
     *      ahead of its due date is doing nothing anyone needs protecting from.
     */
    function settleNextPeriod() external nonReentrant returns (uint256 amount) {
        return _settle(msg.sender, false);
    }

    /**
     * @notice Collects the next instalment from the issuer, once it is due.
     *
     * @dev The automation half of repayment, and deliberately callable by
     *      anyone: a contract cannot wake itself up, so something off-chain has
     *      to make the call. Making that a privileged role would mean one key
     *      standing between a borrower and their own repayment record.
     *
     *      What stops it being abusive is that it moves nobody's money but the
     *      issuer's, and only with their standing approval on the settlement
     *      currency — revoke the allowance and this reverts. It also refuses to
     *      run before the due date, which `settleNextPeriod` does not: paying
     *      early out of your own balance is your business, pulling someone
     *      else's money early is not.
     */
    function collectScheduledPayment() external nonReentrant returns (uint256 amount) {
        return _settle(note.issuer(), true);
    }

    /// @notice What the issuer has authorised this vault to pull.
    function authorizedAmount() external view returns (uint256) {
        return currency.allowance(note.issuer(), address(this));
    }

    /// @notice Whether `collectScheduledPayment` would succeed right now.
    function collectible() external view returns (bool) {
        uint256 index = nextPeriod;
        if (index >= _schedule.length) return false;

        Period memory period = _schedule[index];
        if (block.timestamp < period.dueDate) return false;

        uint256 due = period.principal + period.interest;
        address payer = note.issuer();
        return
            currency.allowance(payer, address(this)) >= due &&
            currency.balanceOf(payer) >= due;
    }

    function _settle(address payer, bool requireDue)
        private
        returns (uint256 amount)
    {
        uint256 index = nextPeriod;
        if (index >= _schedule.length) revert AllPeriodsSettled();

        uint256 shares = note.totalShares();
        if (shares == 0) revert NoSupply();

        Period memory period = _schedule[index];
        amount = period.principal + period.interest;

        if (requireDue && block.timestamp < period.dueDate) {
            revert NotDueYet(index, period.dueDate);
        }

        currency.safeTransferFrom(payer, address(this), amount);
        totalDeposited += amount;

        /*
         * The fee comes out of what was collected, not on top of it.
         *
         * Adding it on top would change what the borrower owes, and the whole
         * point of hashing the schedule is that the obligation is exactly what
         * was signed. So holders receive the instalment net of servicing, which
         * is how a participation in a loan actually works — and the rate was
         * fixed when the note was minted, so a buyer could see it.
         */
        uint256 fee = (amount * feeBps) / 10_000;
        if (fee > 0) {
            totalFees += fee;
            currency.safeTransfer(treasury, fee);
            emit ProtocolFeePaid(index, fee);
        }

        accPerShare += ((amount - fee) * ACC_PRECISION) / shares;
        nextPeriod = index + 1;

        // Principal returned shrinks every balance in step. Interest does not:
        // it is a payment on the loan, not a repayment of it.
        if (period.principal > 0) note.amortize(period.principal);

        emit PeriodSettled(index, amount, accPerShare);

        if (nextPeriod == _schedule.length) {
            note.setStatus(RWANote.Status.Matured);
            emit Matured();
        } else if (note.status() == RWANote.Status.Impaired) {
            // The arrears are cleared; only re-impair if the new earliest
            // unsettled period is itself already past its grace period.
            if (!_isOverdue(nextPeriod)) {
                note.setStatus(RWANote.Status.Active);
                emit Cured(index);
            }
        }
    }

    /**
     * @notice Flags the note impaired once a payment is later than its grace
     *         period allows. Permissionless — a holder should not need the
     *         issuer's cooperation to have arrears recognised.
     */
    function flagImpaired() external {
        uint256 index = nextPeriod;
        if (index >= _schedule.length) revert AllPeriodsSettled();
        if (!_isOverdue(index)) revert NotOverdue();

        note.setStatus(RWANote.Status.Impaired);
        emit Impaired(index, _schedule[index].dueDate);
    }

    function _isOverdue(uint256 index) internal view returns (bool) {
        // Grace periods are measured in days, so the seconds of drift a
        // validator could introduce cannot change this answer.
        // forge-lint: disable-next-line(block-timestamp)
        return block.timestamp > uint256(_schedule[index].dueDate) + gracePeriod;
    }

    // -----------------------------------------------------------------------
    // Distribution
    // -----------------------------------------------------------------------

    /// @notice Called by the note before any balance change.
    function syncHolder(address holder) external {
        if (msg.sender != address(note)) revert NotNote();
        _sync(holder);
    }

    function _sync(address holder) internal {
        uint256 acc = accPerShare;
        uint256 checkpoint = _checkpoint[holder];
        if (acc != checkpoint) {
            _accrued[holder] +=
                (note.sharesOf(holder) * (acc - checkpoint)) / ACC_PRECISION;
            _checkpoint[holder] = acc;
        }
    }

    function claim() external nonReentrant returns (uint256 amount) {
        _sync(msg.sender);

        amount = _accrued[msg.sender];
        if (amount == 0) revert NothingToClaim();

        _accrued[msg.sender] = 0;
        totalClaimed += amount;

        currency.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @notice Settlement currency a holder could claim right now.
    function claimable(address holder) external view returns (uint256) {
        uint256 pending =
            (note.sharesOf(holder) * (accPerShare - _checkpoint[holder])) / ACC_PRECISION;
        return _accrued[holder] + pending;
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function schedule() external view returns (Period[] memory) {
        return _schedule;
    }

    function periodCount() external view returns (uint256) {
        return _schedule.length;
    }

    function periodAt(uint256 index) external view returns (Period memory) {
        return _schedule[index];
    }

    /// @notice Total still owed across every unsettled period.
    function outstanding() external view returns (uint256 total) {
        for (uint256 i = nextPeriod; i < _schedule.length; i++) {
            total += _schedule[i].principal + _schedule[i].interest;
        }
    }

    function isOverdue() external view returns (bool) {
        uint256 index = nextPeriod;
        if (index >= _schedule.length) return false;
        return _isOverdue(index);
    }
}
