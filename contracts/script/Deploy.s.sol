// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {NoteFactory} from "../src/NoteFactory.sol";

/**
 * @notice Deploys the two long-lived contracts. Notes and vaults are created
 *         per-agreement through the factory, not here.
 *
 * Usage:
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url xlayer_testnet --account tokenforge-deployer --broadcast
 */
contract Deploy is Script {
    function run() external returns (IssuerRegistry registry, NoteFactory factory) {
        // Falls back to the broadcasting address so a plain run needs no config.
        address admin = vm.envOr("REGISTRY_ADMIN", address(0));
        if (admin == address(0)) admin = msg.sender;

        vm.startBroadcast();

        registry = new IssuerRegistry(admin);
        factory = new NoteFactory(registry);

        vm.stopBroadcast();

        console.log("chain id        ", block.chainid);
        console.log("registry admin  ", admin);
        console.log("IssuerRegistry  ", address(registry));
        console.log("NoteFactory     ", address(factory));
    }
}

/**
 * @notice Admits an issuer to the registry.
 *
 * Admission is an off-chain judgement; this only records its result on-chain.
 *
 * Usage:
 *   REGISTRY=0x... ISSUER=0x... ISSUER_NAME="Acme Ltd" ISSUER_JURISDICTION="Delaware, USA" \
 *   forge script script/Deploy.s.sol:AdmitIssuer \
 *     --rpc-url xlayer_testnet --account tokenforge-deployer --broadcast
 */
contract AdmitIssuer is Script {
    function run() external {
        IssuerRegistry registry = IssuerRegistry(vm.envAddress("REGISTRY"));
        address issuer = vm.envAddress("ISSUER");
        string memory name = vm.envString("ISSUER_NAME");
        string memory jurisdiction = vm.envString("ISSUER_JURISDICTION");

        vm.startBroadcast();
        registry.admitIssuer(issuer, name, jurisdiction);
        vm.stopBroadcast();

        console.log("admitted", issuer);
    }
}
