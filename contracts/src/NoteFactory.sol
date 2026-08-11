// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IssuerRegistry} from "./IssuerRegistry.sol";
import {RWANote} from "./RWANote.sol";
import {RepaymentVault} from "./RepaymentVault.sol";
import {Period} from "./Schedule.sol";

/**
 * @title NoteFactory
 * @notice The only supported way to bring a note on-chain, and the point at
 *         which issuer eligibility is enforced.
 *
 * @dev Three things happen here that cannot happen anywhere else:
 *
 *      1. The caller is checked against `IssuerRegistry`. An address outside
 *         the registry reverts, which is the on-chain half of the promise that
 *         only verified issuers can tokenize an agreement.
 *      2. The source document's hash is recorded and claimed. One document
 *         produces at most one note, so the same agreement cannot be sold
 *         twice through two different tokens.
 *      3. Note and vault are deployed and wired atomically, so a note can
 *         never exist with an unbound or attacker-supplied vault.
 */
contract NoteFactory {
    struct Deployment {
        address note;
        address vault;
        address issuer;
        bytes32 documentHash;
        uint64 mintedAt;
    }

    IssuerRegistry public immutable registry;

    Deployment[] private _deployments;
    /// @notice Source document hash to the note minted from it.
    mapping(bytes32 documentHash => address note) public noteByDocument;

    event NoteMinted(
        address indexed note,
        address indexed vault,
        address indexed issuer,
        bytes32 documentHash,
        uint256 supply
    );

    /// @dev Carries the address so the rejection names who was refused.
    error IssuerNotRegistered(address caller);
    error BorrowerNotRegistered(address borrower);
    error NotAuthorizedRepresentative(address issuer, address caller);
    error DocumentAlreadyTokenized(bytes32 documentHash, address existingNote);
    error ZeroDocumentHash();
    error ZeroSupply();

    constructor(IssuerRegistry registry_) {
        registry = registry_;
    }

    struct MintParams {
        string name;
        string symbol;
        address issuer;
        /// @dev Who repays. See `RWANote.borrower` for why this is not `issuer`.
        address borrower;
        uint256 supply;
        IERC20 currency;
        uint64 gracePeriod;
        RWANote.Terms terms;
        Period[] schedule;
    }

    /**
     * @notice Deploys a note and its repayment vault.
     * @dev Reverts unless `msg.sender` is `params.issuer` itself or one of its
     *      authorized representatives.
     */
    function mintNote(MintParams calldata params)
        external
        returns (RWANote note, RepaymentVault vault)
    {
        if (!registry.isRegisteredIssuer(params.issuer)) {
            revert IssuerNotRegistered(params.issuer);
        }
        // The borrower is admitted through the same registry. It is really a
        // list of counterparties this deployment will deal with, and a loan
        // needs both ends of it vouched for.
        if (!registry.isRegisteredIssuer(params.borrower)) {
            revert BorrowerNotRegistered(params.borrower);
        }
        if (!registry.isAuthorizedRepresentative(params.issuer, msg.sender)) {
            revert NotAuthorizedRepresentative(params.issuer, msg.sender);
        }
        if (params.terms.documentHash == bytes32(0)) revert ZeroDocumentHash();
        if (params.supply == 0) revert ZeroSupply();

        address existing = noteByDocument[params.terms.documentHash];
        if (existing != address(0)) {
            revert DocumentAlreadyTokenized(params.terms.documentHash, existing);
        }

        note = new RWANote(
            params.name,
            params.symbol,
            params.issuer,
            params.borrower,
            // The whole supply is minted to the issuer, who sells it down. The
            // borrower owes the loan; they do not own a share of it.
            params.issuer,
            params.supply,
            params.terms
        );

        // The vault's constructor rejects a schedule that does not reproduce
        // the note's immutable scheduleHash, so the two cannot disagree.
        vault = new RepaymentVault(
            note, params.currency, params.issuer, params.gracePeriod, params.schedule
        );

        note.setVault(address(vault));

        noteByDocument[params.terms.documentHash] = address(note);
        _deployments.push(
            Deployment({
                note: address(note),
                vault: address(vault),
                issuer: params.issuer,
                documentHash: params.terms.documentHash,
                mintedAt: uint64(block.timestamp)
            })
        );

        emit NoteMinted(
            address(note),
            address(vault),
            params.issuer,
            params.terms.documentHash,
            params.supply
        );
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function deploymentCount() external view returns (uint256) {
        return _deployments.length;
    }

    function deploymentAt(uint256 index) external view returns (Deployment memory) {
        return _deployments[index];
    }

    function deployments() external view returns (Deployment[] memory) {
        return _deployments;
    }

    /// @notice Whether a given document has already been tokenized.
    function isTokenized(bytes32 documentHash) external view returns (bool) {
        return noteByDocument[documentHash] != address(0);
    }
}
