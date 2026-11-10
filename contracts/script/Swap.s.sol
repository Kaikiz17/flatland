// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {WifSwapper} from "../src/WifSwapper.sol";

/// Deploys WifSwapper and swaps SWAP_ETH_WEI of native ETH for $WIF on the canonical v4 pool, reverting below MIN_WIF.
/// Key comes from env DEPLOYER_PK only.
contract Swap is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address me = vm.addr(pk);
        uint256 amt = vm.envUint("SWAP_ETH_WEI");
        uint256 minOut = vm.envUint("MIN_WIF");
        IERC20 wif = IERC20(0x5173b8eA6923c2d40267890D45C46a3480954773);
        uint256 w0 = wif.balanceOf(me);
        vm.startBroadcast(pk);
        WifSwapper s = new WifSwapper();
        uint256 out = s.swapEthForWif{value: amt}(minOut);
        vm.stopBroadcast();
        console2.log("WifSwapper", address(s));
        console2.log("WIF out (wei)", out);
        console2.log("WIF before", w0);
    }
}
