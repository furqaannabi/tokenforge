// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IssuerRegistry
 * @notice The set of addresses permitted to tokenize a real-world debt
 *         instrument, and the representatives authorized to sign for each.
 *
 * @dev This is an eligibility layer, not a safety guarantee. Membership says
 *      an entity was checked well enough to be allowed to issue; it says
 *      nothing about whether any particular loan is sound or will be repaid.
 *      A registered issuer can still originate a bad loan, and the credit risk
 *      of every individual note remains entirely with its holders.
 *
 *      Admission is an off-chain decision made by the admin. What is enforced
 *      on-chain is the consequence: `NoteFactory` reverts for any address this
 *      registry does not recognise.
 */
contract IssuerRegistry {
    struct Issuer {
        string name;
        string jurisdiction;
        bool registered;
        /// @dev Set once on first admission; survives revocation for audit.
        uint64 admittedAt;
    }

    address public admin;
    address public pendingAdmin;

    mapping(address issuer => Issuer) private _issuers;

    /**
     * @notice Counterparties admitted to borrow, which is not the same right.
     *
     * @dev Both ends of a loan must be vouched for, but they are vouched for to
     *      do different things. Reading borrowers out of the issuer list, as an
     *      earlier version did, quietly handed every admitted borrower the
     *      right to mint — a company allowed to owe money became a company
     *      allowed to create notes. An address may hold both roles, by being
     *      admitted twice.
     */
    mapping(address borrower => Issuer) private _borrowers;

    /// @dev An issuer is always its own representative; extras are opt-in.
    mapping(address issuer => mapping(address representative => bool))
        private _representatives;

    event IssuerAdmitted(address indexed issuer, string name, string jurisdiction);
    event IssuerRevoked(address indexed issuer);
    event BorrowerAdmitted(
        address indexed borrower, string name, string jurisdiction
    );
    event BorrowerRevoked(address indexed borrower);
    event RepresentativeSet(
        address indexed issuer, address indexed representative, bool authorized
    );
    event AdminTransferStarted(address indexed from, address indexed to);
    event AdminTransferred(address indexed from, address indexed to);

    error NotAdmin();
    error NotPendingAdmin();
    error ZeroAddress();
    error ZeroMintHash();
    error AlreadyRegistered();
    error NotRegistered();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
    }

    /// @notice Admits a counterparty to be named as a borrower.
    function admitBorrower(
        address borrower,
        string calldata name,
        string calldata jurisdiction
    ) external onlyAdmin {
        if (borrower == address(0)) revert ZeroAddress();
        Issuer storage record = _borrowers[borrower];
        if (record.registered) revert AlreadyRegistered();

        record.name = name;
        record.jurisdiction = jurisdiction;
        record.registered = true;
        if (record.admittedAt == 0) record.admittedAt = uint64(block.timestamp);

        emit BorrowerAdmitted(borrower, name, jurisdiction);
    }

    function revokeBorrower(address borrower) external onlyAdmin {
        if (!_borrowers[borrower].registered) revert NotRegistered();
        _borrowers[borrower].registered = false;
        emit BorrowerRevoked(borrower);
    }

    function isRegisteredBorrower(address borrower) external view returns (bool) {
        return _borrowers[borrower].registered;
    }

    function borrowerInfo(address borrower) external view returns (Issuer memory) {
        return _borrowers[borrower];
    }

    // -----------------------------------------------------------------------
    // Mint approval
    // -----------------------------------------------------------------------

    /**
     * @notice Exact mints the admin has cleared, per issuer.
     *
     * @dev Membership answers "may this company issue at all". This answers
     *      "may it issue *these terms*", which is the judgement a reviewer
     *      actually makes about one agreement.
     *
     *      The key is `NoteFactory.mintHash` — a commitment to every parameter
     *      the note will carry, not merely the document. Approving the document
     *      alone would leave the interface free to change the principal, the
     *      supply, the borrower or the schedule between the admin's decision
     *      and the transaction, and the approval would still hold. Here any
     *      such edit produces a different hash and is refused.
     *
     *      Keyed by issuer too, so an approval cannot be lifted by whoever
     *      submits the same parameters next.
     */
    mapping(address issuer => mapping(bytes32 mintHash => bool))
        public mintApproved;

    event MintApproved(address indexed issuer, bytes32 indexed mintHash);
    event MintApprovalRevoked(address indexed issuer, bytes32 indexed mintHash);

    /// @notice Clears one exact set of mint parameters, for one issuer.
    function approveMint(address issuer, bytes32 mintHash) external onlyAdmin {
        if (issuer == address(0)) revert ZeroAddress();
        if (mintHash == bytes32(0)) revert ZeroMintHash();

        mintApproved[issuer][mintHash] = true;
        emit MintApproved(issuer, mintHash);
    }

    /// @notice Withdraws an approval that has not been used yet.
    function revokeMintApproval(address issuer, bytes32 mintHash)
        external
        onlyAdmin
    {
        mintApproved[issuer][mintHash] = false;
        emit MintApprovalRevoked(issuer, mintHash);
    }

    /// @notice Whether this issuer may mint exactly these parameters.
    function isMintApproved(address issuer, bytes32 mintHash)
        external
        view
        returns (bool)
    {
        return mintApproved[issuer][mintHash];
    }

    // -----------------------------------------------------------------------
    // Membership
    // -----------------------------------------------------------------------

    function admitIssuer(
        address issuer,
        string calldata name,
        string calldata jurisdiction
    ) external onlyAdmin {
        if (issuer == address(0)) revert ZeroAddress();
        Issuer storage record = _issuers[issuer];
        if (record.registered) revert AlreadyRegistered();

        record.name = name;
        record.jurisdiction = jurisdiction;
        record.registered = true;
        if (record.admittedAt == 0) record.admittedAt = uint64(block.timestamp);

        emit IssuerAdmitted(issuer, name, jurisdiction);
    }

    /**
     * @notice Removes an issuer's ability to mint new notes.
     * @dev Deliberately does not touch notes already issued. Their terms are
     *      immutable and their holders' claims survive the issuer losing the
     *      right to create more.
     */
    function revokeIssuer(address issuer) external onlyAdmin {
        Issuer storage record = _issuers[issuer];
        if (!record.registered) revert NotRegistered();

        record.registered = false;
        emit IssuerRevoked(issuer);
    }

    function setRepresentative(address issuer, address representative, bool authorized)
        external
        onlyAdmin
    {
        if (issuer == address(0) || representative == address(0)) revert ZeroAddress();
        if (!_issuers[issuer].registered) revert NotRegistered();

        _representatives[issuer][representative] = authorized;
        emit RepresentativeSet(issuer, representative, authorized);
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function isRegisteredIssuer(address issuer) external view returns (bool) {
        return _issuers[issuer].registered;
    }

    /// @notice An issuer always signs for itself; others must be authorized.
    function isAuthorizedRepresentative(address issuer, address representative)
        external
        view
        returns (bool)
    {
        if (!_issuers[issuer].registered) return false;
        return representative == issuer || _representatives[issuer][representative];
    }

    function issuerInfo(address issuer) external view returns (Issuer memory) {
        return _issuers[issuer];
    }

    // -----------------------------------------------------------------------
    // Admin handover — two-step, so a typo cannot orphan the registry
    // -----------------------------------------------------------------------

    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin();
        address previous = admin;
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, admin);
    }
}
