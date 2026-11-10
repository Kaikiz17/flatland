// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, MockWIF} from "./Base.t.sol";
import {WifGate, WifGated} from "../src/WifGate.sol";
import {ParticipationVault} from "../src/ParticipationVault.sol";
import {Flatland} from "../src/Flatland.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract VipRoom is WifGated {
    uint256 public entered;

    constructor(WifGate g) WifGated(g) {}

    function enter(uint256 gateId) external onlyActed(gateId) {
        ++entered;
    }
}

contract GateTest is Base {
    MockWIF w;

    function setUp() public {
        vm.warp(1_794_000_000);
        w = new MockWIF();
        _deployCore(address(w));
        _fund(alice, 100e18);
        _fund(bob, 100e18);
        _fund(carol, 100e18);
    }

    function _fund(address who, uint256 amt) internal override {
        w.mint(who, amt);
    }

    function _act(address who, uint256 id) internal {
        vm.startPrank(who);
        w.approve(address(gate), type(uint256).max);
        gate.act(id);
        vm.stopPrank();
    }

    function test_rsvp_cap_and_burn() public {
        vm.prank(creator);
        uint256 id = gate.createGate(WifGate.Kind.RSVP, "Lagos meetup", "ipfs://x", 0, 0, 1e18, 2);
        uint256 supply = w.totalSupply();
        _act(alice, id);
        _act(bob, id);
        assertEq(w.totalSupply(), supply - 2e18);
        assertEq(gate.positionOf(alice, 0) + gate.positionOf(id, alice), 1);
        vm.startPrank(carol);
        w.approve(address(gate), type(uint256).max);
        vm.expectRevert(WifGate.Full.selector);
        gate.act(id);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(WifGate.Already.selector);
        gate.act(id);
        assertEq(gate.actorCount(id), 2);
        assertEq(standing.record(alice).acts, 1);
    }

    function test_time_window() public {
        vm.prank(creator);
        uint256 id = gate.createGate(WifGate.Kind.PETITION, "Petition", "", 0, uint64(block.timestamp + 1 days), 1e18, 0);
        _act(alice, id);
        vm.warp(block.timestamp + 2 days);
        vm.startPrank(bob);
        w.approve(address(gate), type(uint256).max);
        vm.expectRevert(WifGate.Closed.selector);
        gate.act(id);
        vm.stopPrank();
    }

    function test_third_party_contract_gating() public {
        vm.prank(creator);
        uint256 id = gate.createGate(WifGate.Kind.ACCESS, "VIP", "", 0, 0, 1e18, 0);
        VipRoom room = new VipRoom(gate);
        vm.prank(alice);
        vm.expectRevert(WifGated.NotActed.selector);
        room.enter(id);
        _act(alice, id);
        vm.prank(alice);
        room.enter(id);
        assertEq(room.entered(), 1);
        vm.prank(bob);
        vm.expectRevert(WifGated.NotActed.selector);
        room.enter(id);
    }

    function test_gate_validation() public {
        vm.expectRevert(WifGate.BadParams.selector);
        gate.createGate(WifGate.Kind.RSVP, "x", "", 0, 0, 0.1e18, 0);
        vm.expectRevert(WifGate.NoGate.selector);
        vm.prank(alice);
        gate.act(99);
    }

    // ── participation vault ──

    function test_participation_pot_unlocks_and_splits_equally() public {
        ParticipationVault pv = new ParticipationVault(hub);
        vm.prank(creator);
        uint256 id = hub.createElection(_params(address(0), address(0), 0));
        MockWIF reward = new MockWIF();
        reward.mint(dave, 90e18);
        vm.startPrank(dave);
        reward.approve(address(pv), type(uint256).max);
        pv.lockPot(id, IERC20(address(reward)), 90e18, 3);
        vm.stopPrank();
        _vote(alice, id, 0);
        _vote(bob, id, 1);
        _vote(carol, id, 2);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(ParticipationVault.NotUnlocked.selector);
        pv.claim(id, 0, 0, alice, 0, new bytes32[](0));
        hub.finalize(id);
        assertTrue(pv.unlocked(id, 0));
        pv.claim(id, 0, 0, alice, 0, new bytes32[](0));
        pv.claim(id, 0, 1, bob, 0, new bytes32[](0));
        assertEq(reward.balanceOf(alice), 30e18);
        assertEq(reward.balanceOf(bob), 30e18);
        vm.expectRevert(ParticipationVault.Already.selector);
        pv.claim(id, 0, 0, alice, 0, new bytes32[](0));
        vm.expectRevert(ParticipationVault.Bad.selector);
        pv.claim(id, 0, 2, dave, 0, new bytes32[](0)); // not a voter
        vm.expectRevert(ParticipationVault.Unlocked.selector);
        pv.refund(id, 0);
    }

    function test_participation_pot_refund_when_goal_missed() public {
        ParticipationVault pv = new ParticipationVault(hub);
        vm.prank(creator);
        uint256 id = hub.createElection(_params(address(0), address(0), 0));
        MockWIF reward = new MockWIF();
        reward.mint(dave, 10e18);
        vm.startPrank(dave);
        reward.approve(address(pv), type(uint256).max);
        pv.lockPot(id, IERC20(address(reward)), 10e18, 100);
        vm.stopPrank();
        _vote(alice, id, 0);
        vm.warp(block.timestamp + 1 days);
        hub.finalize(id);
        assertFalse(pv.unlocked(id, 0));
        pv.refund(id, 0);
        assertEq(reward.balanceOf(dave), 10e18);
        vm.expectRevert(ParticipationVault.Already.selector);
        pv.refund(id, 0);
    }
}
