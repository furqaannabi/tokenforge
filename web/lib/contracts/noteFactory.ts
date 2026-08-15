/**
 * `NoteFactory`, trimmed to what the app uses.
 *
 * Generated from the compiled artifact so a signature cannot drift from the
 * deployed contract.
 */
export const noteFactoryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "registry_",
        "type": "address",
        "internalType": "contract IssuerRegistry"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptanceMessage",
    "inputs": [
      {
        "name": "hash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "acceptedBy",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct NoteFactory.MintParams",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "symbol",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "issuer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "borrower",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "supply",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "currency",
            "type": "address",
            "internalType": "contract IERC20"
          },
          {
            "name": "gracePeriod",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "terms",
            "type": "tuple",
            "internalType": "struct RWANote.Terms",
            "components": [
              {
                "name": "principal",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "rateBps",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "maturity",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "documentHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "scheduleHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "schedule",
            "type": "tuple[]",
            "internalType": "struct Period[]",
            "components": [
              {
                "name": "dueDate",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "principal",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "interest",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          }
        ]
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
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
    "name": "deploymentAt",
    "inputs": [
      {
        "name": "index",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct NoteFactory.Deployment",
        "components": [
          {
            "name": "note",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "issuer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "documentHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "mintedAt",
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
    "name": "deploymentCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "deployments",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct NoteFactory.Deployment[]",
        "components": [
          {
            "name": "note",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "vault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "issuer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "documentHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "mintedAt",
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
    "name": "isTokenized",
    "inputs": [
      {
        "name": "documentHash",
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
    "name": "mintHash",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct NoteFactory.MintParams",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "symbol",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "issuer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "borrower",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "supply",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "currency",
            "type": "address",
            "internalType": "contract IERC20"
          },
          {
            "name": "gracePeriod",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "terms",
            "type": "tuple",
            "internalType": "struct RWANote.Terms",
            "components": [
              {
                "name": "principal",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "rateBps",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "maturity",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "documentHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "scheduleHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "schedule",
            "type": "tuple[]",
            "internalType": "struct Period[]",
            "components": [
              {
                "name": "dueDate",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "principal",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "interest",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "mintNote",
    "inputs": [
      {
        "name": "params",
        "type": "tuple",
        "internalType": "struct NoteFactory.MintParams",
        "components": [
          {
            "name": "name",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "symbol",
            "type": "string",
            "internalType": "string"
          },
          {
            "name": "issuer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "borrower",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "supply",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "currency",
            "type": "address",
            "internalType": "contract IERC20"
          },
          {
            "name": "gracePeriod",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "terms",
            "type": "tuple",
            "internalType": "struct RWANote.Terms",
            "components": [
              {
                "name": "principal",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "rateBps",
                "type": "uint16",
                "internalType": "uint16"
              },
              {
                "name": "maturity",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "documentHash",
                "type": "bytes32",
                "internalType": "bytes32"
              },
              {
                "name": "scheduleHash",
                "type": "bytes32",
                "internalType": "bytes32"
              }
            ]
          },
          {
            "name": "schedule",
            "type": "tuple[]",
            "internalType": "struct Period[]",
            "components": [
              {
                "name": "dueDate",
                "type": "uint64",
                "internalType": "uint64"
              },
              {
                "name": "principal",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "interest",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          }
        ]
      },
      {
        "name": "borrowerSignature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [
      {
        "name": "note",
        "type": "address",
        "internalType": "contract RWANote"
      },
      {
        "name": "vault",
        "type": "address",
        "internalType": "contract RepaymentVault"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "noteByDocument",
    "inputs": [
      {
        "name": "documentHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "note",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "registry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IssuerRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "NoteMinted",
    "inputs": [
      {
        "name": "note",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "vault",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "issuer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "documentHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "supply",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BorrowerNotRegistered",
    "inputs": [
      {
        "name": "borrower",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "DocumentAlreadyTokenized",
    "inputs": [
      {
        "name": "documentHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "existingNote",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "IssuerNotRegistered",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "MintNotApproved",
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
    ]
  },
  {
    "type": "error",
    "name": "NotAuthorizedRepresentative",
    "inputs": [
      {
        "name": "issuer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "StringsInsufficientHexLength",
    "inputs": [
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "length",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroDocumentHash",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroSupply",
    "inputs": []
  }
] as const;
