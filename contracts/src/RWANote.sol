// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IHolderSync {
    /// @notice Settles a holder's accrued coupon before their balance changes.
    function syncHolder(address holder) external;
}

/**
 * @title RWANote
 * @notice An ERC-20 whose supply represents proportional rights to the
 *         repayments of one real-world debt instrument.
 *
 * @dev The economic terms are immutable. They are written once, at deployment,
 *      from values that passed both AI extraction and a deterministic
 *      validator, and no party — issuer, admin, or holder — can alter them
 *      afterwards. `documentHash` binds this token to the exact source file it
 *      was minted from: change one byte of the PDF and the hash no longer
 *      matches.
 *
 *      Plain ERC-20 with a transfer hook, described as ERC-3643-ready rather
 *      than ERC-3643-compliant. A full identity-registry implementation is out
 *      of scope; what exists here is the restriction point such a system would
 *      plug into.
 */
contract RWANote is ERC20 {
    enum Status {
        Active,
        Impaired,
        Matured
    }

    // --- Immutable economic terms ------------------------------------------

    /// @notice Face value of the loan, in the settlement currency's decimals.
    uint256 public immutable principal;
    /// @notice Annual coupon rate in basis points (850 = 8.50%).
    uint16 public immutable rateBps;
    /// @notice Unix timestamp at which the final payment falls due.
    uint64 public immutable maturity;
    /// @notice keccak256 of the source document bytes.
    bytes32 public immutable documentHash;
    /// @notice keccak256 of the encoded repayment schedule held by the vault.
    bytes32 public immutable scheduleHash;
    /// @notice The address permitted to issue notes of this kind.
    address public immutable issuer;
    /// @notice Whoever deployed this note — the factory, in the supported path.
    address public immutable deployer;

    // --- Mutable lifecycle state -------------------------------------------

    Status public status;

    /// @notice Settles coupons; the only address allowed to change `status`.
    address public vault;

    /**
     * @notice When true, transfers are limited to allowlisted addresses.
     * @dev The hook an ERC-3643 identity registry would drive. Off by default
     *      so the demo's secondary transfers work without onboarding.
     */
    bool public transferRestricted;
    mapping(address => bool) public allowlisted;

    event VaultSet(address indexed vault);
    event StatusChanged(Status previous, Status current);
    event TransferRestrictionSet(bool restricted);
    event AllowlistSet(address indexed account, bool allowed);

    error NotIssuer();
    error NotVault();
    error NotDeployer();
    error VaultAlreadySet();
    error ZeroAddress();
    error TransfersBlockedWhileImpaired();
    error RecipientNotAllowlisted(address account);

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer();
        _;
    }

    struct Terms {
        uint256 principal;
        uint16 rateBps;
        uint64 maturity;
        bytes32 documentHash;
        bytes32 scheduleHash;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address issuer_,
        address holder_,
        uint256 supply_,
        Terms memory terms_
    ) ERC20(name_, symbol_) {
        if (issuer_ == address(0) || holder_ == address(0)) revert ZeroAddress();

        issuer = issuer_;
        deployer = msg.sender;
        principal = terms_.principal;
        rateBps = terms_.rateBps;
        maturity = terms_.maturity;
        documentHash = terms_.documentHash;
        scheduleHash = terms_.scheduleHash;

        _mint(holder_, supply_);
    }

    // -----------------------------------------------------------------------
    // Wiring
    // -----------------------------------------------------------------------

    /**
     * @notice Binds the note to its repayment vault. Callable once, by the
     *         address that deployed the note.
     * @dev Exists only to break the deployment-order cycle: the vault's
     *      constructor needs the note's address to verify its schedule hash,
     *      so the note must exist first. The factory deploys both and calls
     *      this in the same transaction.
     *
     *      Restricted to the deployer because an unbound vault is the one
     *      lever over a note's status and coupon accounting. Without this,
     *      anyone could bind a hostile vault to a note deployed outside the
     *      factory and freeze or drain it.
     */
    function setVault(address vault_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (vault != address(0)) revert VaultAlreadySet();
        if (vault_ == address(0)) revert ZeroAddress();

        vault = vault_;
        emit VaultSet(vault_);
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /// @notice Only the vault may change status; it alone tracks the schedule.
    function setStatus(Status next) external {
        if (msg.sender != vault) revert NotVault();

        Status previous = status;
        if (previous == next) return;

        status = next;
        emit StatusChanged(previous, next);
    }

    // -----------------------------------------------------------------------
    // Transfer restrictions
    // -----------------------------------------------------------------------

    function setTransferRestricted(bool restricted) external onlyIssuer {
        transferRestricted = restricted;
        emit TransferRestrictionSet(restricted);
    }

    function setAllowlisted(address account, bool allowed) external onlyIssuer {
        allowlisted[account] = allowed;
        emit AllowlistSet(account, allowed);
    }

    /**
     * @dev The single restriction point.
     *
     *      Coupon entitlements are settled for both parties *before* the
     *      balance moves, so a buyer cannot acquire tokens and immediately
     *      claim a coupon that accrued while the seller held them.
     *
     *      Mint and burn are exempt from the allowlist so issuance and
     *      redemption keep working under restriction, but an impaired note
     *      freezes secondary transfers entirely.
     */
    function _update(address from, address to, uint256 value) internal override {
        bool isMint = from == address(0);
        bool isBurn = to == address(0);

        if (!isMint && !isBurn) {
            if (status == Status.Impaired) revert TransfersBlockedWhileImpaired();
            if (transferRestricted) {
                if (!allowlisted[from]) revert RecipientNotAllowlisted(from);
                if (!allowlisted[to]) revert RecipientNotAllowlisted(to);
            }
        }

        address vault_ = vault;
        if (vault_ != address(0)) {
            if (!isMint) IHolderSync(vault_).syncHolder(from);
            if (!isBurn) IHolderSync(vault_).syncHolder(to);
        }

        super._update(from, to, value);
    }

    /// @notice The immutable terms, as one struct, for off-chain consumers.
    function terms() external view returns (Terms memory) {
        return Terms(principal, rateBps, maturity, documentHash, scheduleHash);
    }
}
