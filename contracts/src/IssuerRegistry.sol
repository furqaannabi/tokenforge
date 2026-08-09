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

    /// @dev An issuer is always its own representative; extras are opt-in.
    mapping(address issuer => mapping(address representative => bool))
        private _representatives;

    event IssuerAdmitted(address indexed issuer, string name, string jurisdiction);
    event IssuerRevoked(address indexed issuer);
    event RepresentativeSet(
        address indexed issuer, address indexed representative, bool authorized
    );
    event AdminTransferStarted(address indexed from, address indexed to);
    event AdminTransferred(address indexed from, address indexed to);

    error NotAdmin();
    error NotPendingAdmin();
    error ZeroAddress();
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
