/**
 * `IssuerRegistry`, trimmed to what the app uses.
 *
 * Taken from the compiled artifact rather than written by hand, so a signature
 * cannot drift from the deployed contract. Regenerate with
 * `scripts/sync-abi.ts` after changing the Solidity.
 */
export const issuerRegistryAbi = [
    {
      "type": "constructor",
      "inputs": [
        {
          "name": "admin_",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "acceptAdmin",
      "inputs": [],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "admin",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "admitBorrower",
      "inputs": [
        {
          "name": "borrower",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "name",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "jurisdiction",
          "type": "string",
          "internalType": "string"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "admitIssuer",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "name",
          "type": "string",
          "internalType": "string"
        },
        {
          "name": "jurisdiction",
          "type": "string",
          "internalType": "string"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "approveMint",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "mintHash",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "borrowerInfo",
      "inputs": [
        {
          "name": "borrower",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "tuple",
          "internalType": "struct IssuerRegistry.Issuer",
          "components": [
            {
              "name": "name",
              "type": "string",
              "internalType": "string"
            },
            {
              "name": "jurisdiction",
              "type": "string",
              "internalType": "string"
            },
            {
              "name": "registered",
              "type": "bool",
              "internalType": "bool"
            },
            {
              "name": "admittedAt",
              "type": "uint64",
              "internalType": "uint64"
            }
          ]
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "isAuthorizedRepresentative",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "representative",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "isMintApproved",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "mintHash",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "isRegisteredBorrower",
      "inputs": [
        {
          "name": "borrower",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "isRegisteredIssuer",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "issuerInfo",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "tuple",
          "internalType": "struct IssuerRegistry.Issuer",
          "components": [
            {
              "name": "name",
              "type": "string",
              "internalType": "string"
            },
            {
              "name": "jurisdiction",
              "type": "string",
              "internalType": "string"
            },
            {
              "name": "registered",
              "type": "bool",
              "internalType": "bool"
            },
            {
              "name": "admittedAt",
              "type": "uint64",
              "internalType": "uint64"
            }
          ]
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "mintApproved",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "mintHash",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [
        {
          "name": "",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "pendingAdmin",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "address"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "revokeBorrower",
      "inputs": [
        {
          "name": "borrower",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "revokeIssuer",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "revokeMintApproval",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "mintHash",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "setRepresentative",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "representative",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "authorized",
          "type": "bool",
          "internalType": "bool"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "transferAdmin",
      "inputs": [
        {
          "name": "newAdmin",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "event",
      "name": "AdminTransferStarted",
      "inputs": [
        {
          "name": "from",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "to",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "AdminTransferred",
      "inputs": [
        {
          "name": "from",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "to",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "BorrowerAdmitted",
      "inputs": [
        {
          "name": "borrower",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "name",
          "type": "string",
          "indexed": false,
          "internalType": "string"
        },
        {
          "name": "jurisdiction",
          "type": "string",
          "indexed": false,
          "internalType": "string"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "BorrowerRevoked",
      "inputs": [
        {
          "name": "borrower",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "IssuerAdmitted",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "name",
          "type": "string",
          "indexed": false,
          "internalType": "string"
        },
        {
          "name": "jurisdiction",
          "type": "string",
          "indexed": false,
          "internalType": "string"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "IssuerRevoked",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "MintApprovalRevoked",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "mintHash",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "MintApproved",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "mintHash",
          "type": "bytes32",
          "indexed": true,
          "internalType": "bytes32"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "RepresentativeSet",
      "inputs": [
        {
          "name": "issuer",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "representative",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "authorized",
          "type": "bool",
          "indexed": false,
          "internalType": "bool"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AlreadyRegistered",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotAdmin",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotPendingAdmin",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotRegistered",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ZeroAddress",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ZeroMintHash",
      "inputs": []
    }
  ] as const;
