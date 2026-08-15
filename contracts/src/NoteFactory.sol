// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
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
    error MintNotApproved(address issuer, bytes32 mintHash);
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
    /**
     * @notice A commitment to every parameter this mint would carry.
     *
     * @dev What the admin approves and what the factory checks. `schedule` is
     *      covered through `terms.scheduleHash`, which the vault's constructor
     *      independently refuses to contradict — so the schedule cannot change
     *      either without changing this.
     */
    function mintHash(MintParams calldata params) public pure returns (bytes32) {
        // Two rounds rather than one: twelve values in a single abi.encode
        // put the stack one slot too deep for the legacy pipeline.
        bytes32 termsHash = keccak256(
            abi.encode(
                params.terms.principal,
                params.terms.rateBps,
                params.terms.maturity,
                params.terms.documentHash,
                params.terms.scheduleHash
            )
        );

        return
            keccak256(
                abi.encode(
                    params.name,
                    params.symbol,
                    params.issuer,
                    params.borrower,
                    params.supply,
                    address(params.currency),
                    params.gracePeriod,
                    termsHash
                )
            );
    }

    /**
     * @notice The words the borrower signs, rebuilt on-chain.
     *
     * @dev Byte-identical to the message the service asks a wallet to sign, so
     *      the signature can be checked here rather than taken on trust from a
     *      database row.
     *
     *      Readable prose rather than a bare hash, deliberately. A wallet shows
     *      this verbatim, and a prompt full of hex is one people approve
     *      without reading — which is exactly the habit that makes signature
     *      phishing work. The mint hash is included, so a signature cannot be
     *      lifted onto different terms.
     */
    function acceptanceMessage(bytes32 hash) public pure returns (string memory) {
        return
            string.concat(
                unicode"TokenForge — borrower acceptance\n",
                "\n",
                "I confirm that the company I represent is the borrower on this agreement,\n",
                "and I accept the terms recorded under the following mint:\n",
                "\n",
                Strings.toHexString(uint256(hash), 32)
            );
    }

    /// @notice Whether `signature` is this borrower agreeing to these params.
    function acceptedBy(MintParams calldata params, bytes calldata signature)
        public
        view
        returns (bool)
    {
        if (signature.length == 0) return false;

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            bytes(acceptanceMessage(mintHash(params)))
        );

        (address signer, ECDSA.RecoverError error, ) = ECDSA.tryRecover(
            digest,
            signature
        );

        return error == ECDSA.RecoverError.NoError && signer == params.borrower;
    }

    function mintNote(MintParams calldata params, bytes calldata borrowerSignature)
        external
        returns (RWANote note, RepaymentVault vault)
    {
        if (!registry.isRegisteredIssuer(params.issuer)) {
            revert IssuerNotRegistered(params.issuer);
        }
        // A separate roll from the issuers. Both ends of a loan are vouched
        // for, but for different things: being allowed to owe money is not
        // being allowed to create notes.
        if (!registry.isRegisteredBorrower(params.borrower)) {
            revert BorrowerNotRegistered(params.borrower);
        }
        if (!registry.isAuthorizedRepresentative(params.issuer, msg.sender)) {
            revert NotAuthorizedRepresentative(params.issuer, msg.sender);
        }
        if (params.terms.documentHash == bytes32(0)) revert ZeroDocumentHash();

        if (params.supply == 0) revert ZeroSupply();

        /*
         * The admin cleared exactly these parameters for this issuer.
         *
         * Approving the document alone would have left everything else free to
         * change between the decision and the transaction — principal, supply,
         * borrower, schedule — while the approval still held. Hashing the whole
         * set means any edit after approval is a different mint, and refused.
         */
        bytes32 approvalHash = mintHash(params);
        if (!registry.isMintApproved(params.issuer, approvalHash)) {
            revert MintNotApproved(params.issuer, approvalHash);
        }


        address existing = noteByDocument[params.terms.documentHash];
        if (existing != address(0)) {
            revert DocumentAlreadyTokenized(params.terms.documentHash, existing);
        }

        /*
         * Computed before the call, not inside it. Passing it as an argument
         * put the stack a slot too deep for the legacy pipeline — the same
         * trap `mintHash` works around by hashing in two rounds.
         */
        bool accepted = acceptedBy(params, borrowerSignature);

        note = new RWANote(
            params.name,
            params.symbol,
            params.issuer,
            params.borrower,
            // The whole supply is minted to the issuer, who sells it down. The
            // borrower owes the loan; they do not own a share of it.
            params.issuer,
            params.supply,
            params.terms,
            /*
             * One signature, not two.
             *
             * The borrower used to sign the terms off-chain to unblock the
             * admin, and then send a transaction to `accept` the note after it
             * existed — agreeing twice to the same thing, the second time
             * paying gas for it. Verifying that same signature here collapses
             * the two: the chain checks the agreement rather than trusting
             * that a database row recorded it.
             *
             * Without a signature the note still opens Pending and waits for
             * `accept`, which keeps the older flow working.
             */
            accepted
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
