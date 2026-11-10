// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PrizeRules} from "../src/PrizeRules.sol";
import {Flatland} from "../src/Flatland.sol";

/// Deploy the PrizeRules add-on against an existing Flatland hub.
///   HUB          hub address (required)
///   DEPLOYER_PK  env only (never a CLI flag)
/// Dry run:   HUB=0x… forge script script/DeployPrizeRules.s.sol --rpc-url $RPC
/// Broadcast: HUB=0x… DEPLOYER_PK=… forge script script/DeployPrizeRules.s.sol --rpc-url $RPC --broadcast
contract DeployPrizeRules is Script {
    function run() external {
        address hub = vm.envAddress("HUB");
        uint256 pk = vm.envOr("DEPLOYER_PK", uint256(0));
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        PrizeRules pr = new PrizeRules(Flatland(hub));
        vm.stopBroadcast();
        console2.log("PrizeRules", address(pr));
        console2.log("hub", address(pr.hub()));
        console2.log("WIF", address(pr.WIF()));
    }
}
