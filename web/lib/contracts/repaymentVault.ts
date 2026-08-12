/** `RepaymentVault`, trimmed to what the app uses. */
export const repaymentVaultAbi = [
    {
      "type": "constructor",
      "inputs": [
        {
          "name": "note_",
          "type": "address",
          "internalType": "contract RWANote"
        },
        {
          "name": "currency_",
          "type": "address",
          "internalType": "contract IERC20"
        },
        {
          "name": "issuer_",
          "type": "address",
          "internalType": "address"
        },
        {
          "name": "gracePeriod_",
          "type": "uint64",
          "internalType": "uint64"
        },
        {
          "name": "schedule_",
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
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "accPerShare",
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
      "name": "authorizedAmount",
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
      "name": "claim",
      "inputs": [],
      "outputs": [
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "claimable",
      "inputs": [
        {
          "name": "holder",
          "type": "address",
          "internalType": "address"
        }
      ],
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
      "name": "collectFromBorrower",
      "inputs": [],
      "outputs": [
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "collectible",
      "inputs": [],
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
      "name": "currency",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract IERC20"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "flagImpaired",
      "inputs": [],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "gracePeriod",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "uint64",
          "internalType": "uint64"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "hashSchedule",
      "inputs": [
        {
          "name": "schedule_",
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
      "name": "isOverdue",
      "inputs": [],
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
      "name": "issuer",
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
      "name": "nextPeriod",
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
      "name": "note",
      "inputs": [],
      "outputs": [
        {
          "name": "",
          "type": "address",
          "internalType": "contract RWANote"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "outstanding",
      "inputs": [],
      "outputs": [
        {
          "name": "total",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "periodAt",
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
          "internalType": "struct Period",
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
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "periodCount",
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
      "name": "schedule",
      "inputs": [],
      "outputs": [
        {
          "name": "",
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
      ],
      "stateMutability": "view"
    },
    {
      "type": "function",
      "name": "settleNextPeriod",
      "inputs": [],
      "outputs": [
        {
          "name": "amount",
          "type": "uint256",
          "internalType": "uint256"
        }
      ],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "syncHolder",
      "inputs": [
        {
          "name": "holder",
          "type": "address",
          "internalType": "address"
        }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
    },
    {
      "type": "function",
      "name": "totalClaimed",
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
      "name": "totalDeposited",
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
      "type": "event",
      "name": "Claimed",
      "inputs": [
        {
          "name": "holder",
          "type": "address",
          "indexed": true,
          "internalType": "address"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Cured",
      "inputs": [
        {
          "name": "period",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Impaired",
      "inputs": [
        {
          "name": "period",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "dueDate",
          "type": "uint64",
          "indexed": false,
          "internalType": "uint64"
        }
      ],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "Matured",
      "inputs": [],
      "anonymous": false
    },
    {
      "type": "event",
      "name": "PeriodSettled",
      "inputs": [
        {
          "name": "period",
          "type": "uint256",
          "indexed": true,
          "internalType": "uint256"
        },
        {
          "name": "amount",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        },
        {
          "name": "accPerToken",
          "type": "uint256",
          "indexed": false,
          "internalType": "uint256"
        }
      ],
      "anonymous": false
    },
    {
      "type": "error",
      "name": "AllPeriodsSettled",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NoSupply",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotAcceptedYet",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotDueYet",
      "inputs": [
        {
          "name": "period",
          "type": "uint256",
          "internalType": "uint256"
        },
        {
          "name": "dueDate",
          "type": "uint64",
          "internalType": "uint64"
        }
      ]
    },
    {
      "type": "error",
      "name": "NotIssuer",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotNote",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NotOverdue",
      "inputs": []
    },
    {
      "type": "error",
      "name": "NothingToClaim",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ReentrancyGuardReentrantCall",
      "inputs": []
    },
    {
      "type": "error",
      "name": "SafeERC20FailedOperation",
      "inputs": [
        {
          "name": "token",
          "type": "address",
          "internalType": "address"
        }
      ]
    },
    {
      "type": "error",
      "name": "ScheduleEmpty",
      "inputs": []
    },
    {
      "type": "error",
      "name": "ScheduleHashMismatch",
      "inputs": [
        {
          "name": "expected",
          "type": "bytes32",
          "internalType": "bytes32"
        },
        {
          "name": "actual",
          "type": "bytes32",
          "internalType": "bytes32"
        }
      ]
    },
    {
      "type": "error",
      "name": "ScheduleNotAscending",
      "inputs": [
        {
          "name": "index",
          "type": "uint256",
          "internalType": "uint256"
        }
      ]
    }
  ] as const;
