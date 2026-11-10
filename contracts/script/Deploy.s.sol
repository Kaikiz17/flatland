// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {Flatland} from "../src/Flatland.sol";
import {Standing} from "../src/Standing.sol";
import {WifGate} from "../src/WifGate.sol";
import {ParticipationVault} from "../src/ParticipationVault.sol";
import {WifBuyback} from "../src/WifBuyback.sol";
import {ArbEntropy, LocalEntropy} from "../src/Entropy.sol";
import {BasketVault} from "../src/basket/BasketVault.sol";
import {IEntryPoint} from "../src/aa/AAInterfaces.sol";
import {FlatAccountFactory} from "../src/aa/FlatAccount.sol";
import {FlatPaymaster} from "../src/aa/FlatPaymaster.sol";
import {IEntropy} from "../src/interfaces/IEntropy.sol";
import {Config} from "./Config.sol";

/// Deploy everything (no admin keys are created: all contracts are ownerless).
///   TALLIER        address of the reference indexer attester (hot key used only to post results)
///   ENTROPY=local  use block.number/blockhash (anvil); default uses the ArbSys precompile (real chain)
///   MAX_BUYBACK    USDG (6 dec) per buyback call, default 5000e6
/// Dry run:   forge script script/Deploy.s.sol --fork-url $RPC
/// Broadcast: forge script script/Deploy.s.sol --rpc-url $RPC --private-key $PK --broadcast   (NOT done in this repo's CI)
contract Deploy is Script {
    struct D {
        Standing standing;
        IEntropy entropy;
        Flatland hub;
        WifGate gate;
        ParticipationVault pv;
        WifBuyback bb;
        BasketVault vault;
        FlatAccountFactory factory;
        FlatPaymaster pm;
    }

    D internal d;
    address internal tallier;
    address internal governance; // may only adjust the basket's beta deposit caps

    function run() external {
        tallier = vm.envAddress("TALLIER");
        uint256 pk = vm.envOr("DEPLOYER_PK", uint256(0)); // env only, never a CLI flag, so it can't land in shell history or process lists
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers(); // the deployer key; GOVERNANCE=<multisig> overrides
        governance = vm.envOr("GOVERNANCE", broadcaster);
        _deploy();
        vm.stopBroadcast();
        _write();
    }

    function _deploy() internal {
        bool local = keccak256(bytes(vm.envOr("ENTROPY", string("arb")))) == keccak256("local");
        d.standing = new Standing();
        d.entropy = local ? IEntropy(address(new LocalEntropy())) : IEntropy(address(new ArbEntropy()));
        d.hub = new Flatland(Config.WIF, address(d.entropy), address(d.standing), tallier);
        d.gate = new WifGate(Config.WIF, address(d.standing));
        d.pv = new ParticipationVault(d.hub);
        d.bb = new WifBuyback(vm.envOr("MAX_BUYBACK", uint256(5_000e6)));
        d.vault = new BasketVault(d.hub, d.bb, d.standing, Config.USDG, Config.ROUTER02, Config.assets(), 25_000e6, 10, governance);
        d.factory = new FlatAccountFactory(IEntryPoint(Config.ENTRY_POINT_V07));
        d.pm = new FlatPaymaster(IEntryPoint(Config.ENTRY_POINT_V07), d.hub, d.standing, 0.0005 ether, 0.02 ether);
        address[] memory writers = new address[](3);
        writers[0] = address(d.hub);
        writers[1] = address(d.gate);
        writers[2] = address(d.vault);
        d.standing.setWriters(writers);
    }

    /// @dev On Arbitrum Orbit chains block.number is an L1 estimate; the indexer needs the L2 block for getLogs.
    function _l2Block() internal view returns (uint256 n) {
        (bool ok, bytes memory ret) = address(0x64).staticcall(abi.encodeWithSignature("arbBlockNumber()"));
        n = (ok && ret.length == 32) ? abi.decode(ret, (uint256)) : block.number;
    }

    function _write() internal {
        string memory k = "d";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployBlock", _l2Block());
        vm.serializeAddress(k, "wif", Config.WIF);
        vm.serializeAddress(k, "usdg", Config.USDG);
        vm.serializeAddress(k, "tallier", tallier);
        vm.serializeAddress(k, "entropy", address(d.entropy));
        vm.serializeAddress(k, "standing", address(d.standing));
        vm.serializeAddress(k, "flatland", address(d.hub));
        vm.serializeAddress(k, "boxImpl", d.hub.boxImpl());
        vm.serializeAddress(k, "gate", address(d.gate));
        vm.serializeAddress(k, "participation", address(d.pv));
        vm.serializeAddress(k, "buyback", address(d.bb));
        vm.serializeAddress(k, "basket", address(d.vault));
        vm.serializeAddress(k, "accountFactory", address(d.factory));
        string memory out = vm.serializeAddress(k, "paymaster", address(d.pm));
        string memory path = string.concat("../deployments/", vm.envOr("OUT", string("local")), ".json");
        vm.writeJson(out, path);
        console2.log("deployments written to", path);
        console2.log("Flatland", address(d.hub));
        console2.log("Basket", address(d.vault));
    }
}
