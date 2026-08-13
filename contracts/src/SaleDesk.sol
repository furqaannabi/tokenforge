// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IRWANote {
    function issuer() external view returns (address);
    function principal() external view returns (uint256);
    function totalShares() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function vault() external view returns (address);
    function status() external view returns (uint8);
}

interface IRepaymentVault {
    function currency() external view returns (address);
    function claim() external returns (uint256);
    function claimable(address) external view returns (uint256);
}

/**
 * @title SaleDesk
 * @notice The primary offering: how a note reaches anyone other than its issuer.
 *
 * @dev `NoteFactory` mints the whole supply to the issuer, which is faithful to
 *      how private credit works — the originator funds the loan and then sells
 *      participations in it. Without somewhere to sell them, though, every note
 *      stays where it was minted. This is that somewhere.
 *
 *      One desk serves every note. Each note is its own ERC-20, so the pool
 *      available for a note is simply this contract's balance of it and no
 *      per-note accounting is needed — which matters, because those balances
 *      amortize and any number this contract wrote down would go stale the
 *      moment a period settled.
 *
 *      Compliance is not re-implemented here. `RWANote._update` already applies
 *      the note's own allowlist to every transfer, so a restricted note refuses
 *      a buyer the issuer has not admitted, and it refuses this desk too unless
 *      the issuer allowlists it. That is the correct place for the rule to live.
 */
contract SaleDesk is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /**
     * @notice Protocol fee on a primary sale, in basis points, charged to each
     *         side. 25 bps is 0.25%.
     *
     * @dev Immutable, and set once at deployment. A desk that could reprice its
     *      own cut after an offer opened would let the protocol change what a
     *      sale costs between a buyer's quote and their confirmation — the same
     *      objection that took the price out of the issuer's hands.
     *
     *      Charged symmetrically: the buyer pays the price plus 25 bps, the
     *      seller receives the price less 25 bps. On a 1,000 sale the buyer
     *      pays 1,002.50, the seller receives 997.50, and 5.00 reaches the
     *      treasury. Quoting one side only would have hidden half the cost from
     *      whichever party did not see it.
     */
    uint16 public constant FEE_BPS = 25;

    uint16 private constant BPS = 10_000;

    /// @notice Where the fee goes. Immutable for the same reason as the rate.
    address public immutable treasury;

    /// @notice Fee collected per note, both sides together.
    mapping(address note => uint256) public feesCollected;

    /**
     * @notice An open offering.
     * @dev No price is stored, because the issuer does not set one. A token is
     *      a claim on one unit of principal, so the price follows from the
     *      note's own terms and this contract computes it. Letting a seller
     *      name their own number would have made the quote a matter of opinion
     *      and handed them a way to reprice between a buyer's quote and their
     *      confirmation.
     */
    struct Offer {
        address seller;
        bool open;
    }

    /// @notice Note address to its offering.
    mapping(address note => Offer) public offers;

    /// @notice Total settlement currency this desk has taken for a note.
    mapping(address note => uint256) public raised;

    event OfferOpened(address indexed note, address indexed seller);
    event OfferClosed(address indexed note);
    event PoolFunded(address indexed note, uint256 amount);
    event PoolWithdrawn(address indexed note, uint256 amount);
    event Bought(
        address indexed note,
        address indexed buyer,
        uint256 amount,
        uint256 cost
    );
    /// @dev Both legs of the fee for one trade, so the take is auditable.
    event FeeCharged(
        address indexed note,
        uint256 fromBuyer,
        uint256 fromSeller
    );
    event Swept(address indexed note, uint256 amount);

    error NotIssuer(address note, address caller);
    error OfferNotOpen(address note);
    error OfferAlreadyOpen(address note);
    error InsufficientPool(address note, uint256 requested, uint256 available);
    error ZeroAmount();
    error NoteNotActive(address note);
    error CostAboveMax();
    error ZeroTreasury();

    constructor(address treasury_) {
        if (treasury_ == address(0)) revert ZeroTreasury();
        treasury = treasury_;
    }

    modifier onlyIssuer(address note) {
        address issuer = IRWANote(note).issuer();
        if (msg.sender != issuer) revert NotIssuer(note, msg.sender);
        _;
    }

    // --- The issuer's side --------------------------------------------------

    /**
     * @notice Opens an offering and funds it in one transaction.
     * @param note The note being offered.
     * @param amount Tokens to place in the pool. The caller must have approved
     *        this desk for at least this much first.
     * @dev There is no price argument. The only decision an issuer makes here
     *      is how much of the loan to place; what it costs is arithmetic on the
     *      note's own terms.
     */
    function openOffer(address note, uint256 amount)
        external
        onlyIssuer(note)
        nonReentrant
    {
        if (offers[note].open) revert OfferAlreadyOpen(note);
        if (IRWANote(note).status() != 0) revert NoteNotActive(note);

        offers[note] = Offer({seller: msg.sender, open: true});

        emit OfferOpened(note, msg.sender);
        if (amount > 0) _fund(note, amount);
    }

    /// @notice Adds more of the issuer's holding to an open pool.
    function fundPool(address note, uint256 amount)
        external
        onlyIssuer(note)
        nonReentrant
    {
        if (!offers[note].open) revert OfferNotOpen(note);
        if (amount == 0) revert ZeroAmount();
        _fund(note, amount);
    }

    /**
     * @notice Takes unsold tokens back out of the pool.
     * @dev Withdrawing everything does not close the offer — an issuer often
     *      wants to pause a sale and resume it, and closing would discard the
     *      price they set.
     */
    function withdrawPool(address note, uint256 amount)
        external
        onlyIssuer(note)
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        uint256 pool = available(note);
        if (amount > pool) revert InsufficientPool(note, amount, pool);

        IERC20(note).safeTransfer(offers[note].seller, amount);
        emit PoolWithdrawn(note, amount);
    }

    /// @notice Closes the offering and returns whatever is left to the seller.
    function closeOffer(address note) external onlyIssuer(note) nonReentrant {
        if (!offers[note].open) revert OfferNotOpen(note);

        uint256 pool = available(note);
        address seller = offers[note].seller;
        offers[note].open = false;

        if (pool > 0) IERC20(note).safeTransfer(seller, pool);
        emit OfferClosed(note);
    }

    /**
     * @notice Forwards repayments the unsold pool has earned to the seller.
     * @dev Tokens sitting here are a holding like any other, so the vault
     *      accrues distributions to this address. They belong to whoever still
     *      owns the unsold part of the loan, which is the seller. Without this
     *      they would be stranded in a contract with no other way to spend.
     */
    function sweep(address note) external nonReentrant {
        address vault = IRWANote(note).vault();
        address seller = offers[note].seller;
        if (seller == address(0)) revert OfferNotOpen(note);

        // `RepaymentVault.claim` reverts with `NothingToClaim` rather than
        // returning zero, so an unconditional call would make a sweep fail
        // whenever it had nothing to do — which is most of the time.
        if (IRepaymentVault(vault).claimable(address(this)) == 0) {
            emit Swept(note, 0);
            return;
        }

        uint256 amount = IRepaymentVault(vault).claim();
        if (amount > 0) {
            IERC20(IRepaymentVault(vault).currency()).safeTransfer(seller, amount);
        }
        emit Swept(note, amount);
    }

    // --- The investor's side ------------------------------------------------

    /**
     * @notice Buys `amount` tokens from the pool at the computed price.
     * @dev `maxCost` remains the buyer's protection even though nobody can
     *      reprice an offer. Par is derived from the note, and a note whose
     *      status changed between quote and confirmation can still move the
     *      cost under a buyer who has already signed.
     */
    function buy(address note, uint256 amount, uint256 maxCost)
        external
        nonReentrant
    {
        Offer memory offer = offers[note];
        if (!offer.open) revert OfferNotOpen(note);
        if (amount == 0) revert ZeroAmount();

        uint256 pool = available(note);
        if (amount > pool) revert InsufficientPool(note, amount, pool);

        uint256 cost = quote(note, amount);

        /*
         * `maxCost` covers everything the buyer parts with, fee included.
         * Capping the price alone would let the total exceed the number they
         * agreed to, which is precisely what the cap exists to prevent.
         */
        uint256 buyerFee = feeOn(cost);
        uint256 sellerFee = feeOn(cost);
        uint256 charged = cost + buyerFee;
        if (charged > maxCost) revert CostAboveMax();

        address vault = IRWANote(note).vault();
        IERC20 currency = IERC20(IRepaymentVault(vault).currency());

        raised[note] += cost;
        feesCollected[note] += buyerFee + sellerFee;

        /*
         * Paid straight through rather than held here. This desk is a counter,
         * not an escrow: it never holds anyone's money between calls, so there
         * is no balance for a bug elsewhere to drain. The seller's fee is
         * deducted on the way past rather than billed afterwards, so there is
         * no moment where the protocol is owed something it has to chase.
         */
        currency.safeTransferFrom(msg.sender, offer.seller, cost - sellerFee);
        currency.safeTransferFrom(msg.sender, treasury, buyerFee + sellerFee);
        IERC20(note).safeTransfer(msg.sender, amount);

        emit Bought(note, msg.sender, amount, cost);
        emit FeeCharged(note, buyerFee, sellerFee);
    }

    function _fund(address note, uint256 amount) private {
        IERC20(note).safeTransferFrom(msg.sender, address(this), amount);
        emit PoolFunded(note, amount);
    }

    // --- Quotes -------------------------------------------------------------

    /**
     * @notice One side's fee on a given price. Rounded up.
     *
     * Up rather than down for the same reason `quote` rounds up: a trade small
     * enough to round the fee to zero would otherwise be free, and "free below
     * a threshold" is not a property a fee should have.
     */
    function feeOn(uint256 price_) public pure returns (uint256) {
        if (price_ == 0) return 0;
        return (price_ * FEE_BPS + BPS - 1) / BPS;
    }

    /// @notice Everything a buyer parts with for `amount`: price plus their fee.
    function totalCost(address note, uint256 amount)
        external
        view
        returns (uint256)
    {
        uint256 cost = quote(note, amount);
        return cost + feeOn(cost);
    }

    /// @notice What the seller keeps from a sale of `amount`.
    function sellerProceeds(address note, uint256 amount)
        external
        view
        returns (uint256)
    {
        uint256 cost = quote(note, amount);
        return cost - feeOn(cost);
    }

    /// @notice Tokens currently for sale.
    function available(address note) public view returns (uint256) {
        return IRWANote(note).balanceOf(address(this));
    }

    /**
     * @notice Price of one whole token, in the settlement currency.
     * @dev Par is `principal / originalSupply`. `totalShares` is that original
     *      supply — it is the one quantity amortization leaves alone, which is
     *      exactly why it is the right denominator. Using `totalSupply` would
     *      divide by the amortized figure and quote a rising price for a note
     *      that is being paid down.
     */
    function parPrice(address note) public view returns (uint256) {
        uint256 shares = IRWANote(note).totalShares();
        if (shares == 0) return 0;
        return (IRWANote(note).principal() * 1e18) / shares;
    }

    /// @notice The price a buy would use. Always par; nobody can set it.
    function price(address note) public view returns (uint256) {
        return parPrice(note);
    }

    /**
     * @notice What `amount` tokens would cost, in settlement currency units.
     * @dev Rounded up. Dividing by 1e18 means any amount small enough sends the
     *      cost to zero, and a purchase that costs nothing is a purchase that
     *      hands out tokens for free. The pool is far too small to drain that
     *      way at any real gas price, but rounding in the buyer's favour is not
     *      a property a sale should have at any size. The most a seller can
     *      gain from this is one unit of the settlement currency.
     */
    function quote(address note, uint256 amount) public view returns (uint256) {
        uint256 gross = amount * price(note);
        if (gross == 0) return 0;
        return (gross + 1e18 - 1) / 1e18;
    }

    /**
     * @notice The pool as a percentage of the note, in basis points.
     * @dev What the issuer actually chooses is "how much of this loan do I want
     *      to sell", so the interface asks for a percentage and this is the
     *      answer read back. Measured against `totalSupply` so it stays honest
     *      as the note amortizes — both sides of the ratio shrink together.
     */
    function poolBps(address note) external view returns (uint256) {
        uint256 supply = IRWANote(note).totalSupply();
        if (supply == 0) return 0;
        return (available(note) * 10_000) / supply;
    }
}
