// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {Flatland} from "../src/Flatland.sol";
import {WifGate} from "../src/WifGate.sol";
import {IWIF} from "../src/interfaces/IWIF.sol";

/// Runs the protocol against the REAL $WIF token on Robinhood Chain (chain id 4663) via a mainnet fork.
/// Run: forge test --match-contract ForkWif --fork-url $RPC (see README). Skips itself when not on chain 4663.
contract ForkWifTest is Base {
    address constant WIF_ADDR = 0x5173b8eA6923c2d40267890D45C46a3480954773;

    function setUp() public {
        if (block.chainid != 4663) return;
        _deployCore(WIF_ADDR);
        _lock(new address[](0));
        _fund(alice, 100e18);
        _fund(bob, 100e18);
        _fund(carol, 100e18);
        _fund(creator, 100e18);
    }

    function _fund(address who, uint256 amt) internal override {
        deal(WIF_ADDR, who, amt);
    }

    modifier onFork() {
        if (block.chainid != 4663) {
            vm.skip(true);
        }
        _;
    }

    function test_fork_wif_is_real_and_burnable() public onFork {
        assertEq(IWIF(WIF_ADDR).totalSupply() > 9e26, true);
        // burn / burnFrom exist and reduce totalSupply on the real token
        uint256 s = IWIF(WIF_ADDR).totalSupply();
        vm.prank(alice);
        IWIF(WIF_ADDR).burn(1e18);
        assertEq(IWIF(WIF_ADDR).totalSupply(), s - 1e18);
    }

    function test_fork_full_election_lifecycle_burns_real_wif() public onFork {
        uint256 supply0 = IWIF(WIF_ADDR).totalSupply();
        Flatland.Params memory p = _params(tallier, address(0), 2);
        vm.prank(creator);
        uint256 id = hub.createElection(p);
        vm.startPrank(creator);
        wif.approve(address(hub), type(uint256).max);
        hub.fundPrize(id, 20e18);
        vm.stopPrank();

        _vote(alice, id, 0); // connect-wallet path
        address box = hub.depositAddress(id, 1);
        vm.prank(bob);
        wif.transfer(box, 3e18); // plain-transfer path
        hub.sweepDeposits(id, 1);

        bytes32 l0 = hub.leafOf(0, bob, 1);
        uint32[] memory c = new uint32[](3);
        c[1] = 1;
        vm.warp(block.timestamp + 1 days);
        vm.prank(tallier);
        hub.submitDeposits(id, c, l0, "ipfs://groups"); // single leaf: root == leaf
        vm.warp(block.timestamp + 6 hours);
        hub.finalize(id);

        uint256[] memory t = hub.tallies(id);
        assertEq(t[0], 1);
        assertEq(t[1], 1);
        assertEq(hub.totalEntries(id), 2);
        // 1 (connect vote) + 3 (box) burned for real
        assertEq(IWIF(WIF_ADDR).totalSupply(), supply0 - 4e18);
        assertEq(hub.totalBurned(), 4e18);
    }

    function test_fork_gate_burns_real_wif() public onFork {
        vm.prank(creator);
        uint256 id = gate.createGate(WifGate.Kind.PETITION, "Flat finance", "", 0, 0, 1e18, 0);
        uint256 s = IWIF(WIF_ADDR).totalSupply();
        vm.startPrank(alice);
        wif.approve(address(gate), type(uint256).max);
        gate.act(id);
        vm.stopPrank();
        assertEq(IWIF(WIF_ADDR).totalSupply(), s - 1e18);
        assertTrue(gate.hasActed(id, alice));
    }
}
