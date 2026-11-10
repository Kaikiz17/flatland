// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, MockWIF} from "./Base.t.sol";
import {Flatland} from "../src/Flatland.sol";
import {PrizeRules} from "../src/PrizeRules.sol";

contract PrizeRulesTest is Base {
    MockWIF w;
    PrizeRules pr;
    address eve = makeAddr("eve");
    address[6] who;

    function setUp() public {
        vm.warp(1_794_000_000);
        w = new MockWIF();
        _deployCore(address(w));
        _lock(new address[](0));
        pr = new PrizeRules(hub);
        who = [alice, bob, carol, dave, eve, makeAddr("frank")];
        for (uint256 i; i < who.length; ++i) _fund(who[i], 100e18);
        _fund(creator, 1000e18);
        vm.prank(creator);
        w.approve(address(pr), type(uint256).max);
    }

    function _fund(address a, uint256 amt) internal override {
        w.mint(a, amt);
    }

    function _election(address tal) internal returns (uint256 id) {
        vm.prank(creator);
        id = hub.createElection(_params(tal, address(0), 0));
    }

    function _lucky(uint256 a, uint256 b, uint128 x, uint128 y) internal pure returns (uint256[] memory n, uint128[] memory amt) {
        n = new uint256[](2);
        n[0] = a;
        n[1] = b;
        amt = new uint128[](2);
        amt[0] = x;
        amt[1] = y;
    }

    function _none() internal pure returns (uint256[] memory n, uint128[] memory a) {}

    function _create(uint256 id, uint128 f, uint128 l, uint256 n1, uint256 n2, uint128 pool, uint32 slots) internal {
        (uint256[] memory n, uint128[] memory a) = _lucky(n1, n2, 7e18, 3e18);
        vm.prank(creator);
        pr.create(id, f, l, n, a, pool, slots);
    }

    function _noProof() internal pure returns (bytes32[] memory p) {}

    // ───────── create ─────────

    function test_create_pulls_funds_and_locks() public {
        uint256 id = _election(address(0));
        uint256 before = w.balanceOf(creator);
        _create(id, 10e18, 5e18, 3, 5, 20e18, 2);
        assertEq(before - w.balanceOf(creator), 45e18); // 10+5+7+3+20
        assertEq(w.balanceOf(address(pr)), 45e18);
        (uint256[] memory pos, uint128[] memory amt) = pr.getLucky(id);
        assertEq(pos[0], 3);
        assertEq(amt[1], 3e18);
        // locked: cannot create again
        (uint256[] memory n, uint128[] memory a) = _none();
        vm.prank(creator);
        vm.expectRevert(PrizeRules.Exists.selector);
        pr.create(id, 1e18, 0, n, a, 0, 0);
    }

    function test_create_access_and_validation() public {
        uint256 id = _election(address(0));
        (uint256[] memory n, uint128[] memory a) = _none();
        vm.prank(alice);
        vm.expectRevert(PrizeRules.NotCreator.selector);
        pr.create(id, 1e18, 0, n, a, 0, 0);
        vm.startPrank(creator);
        vm.expectRevert(PrizeRules.BadParams.selector); // nothing funded
        pr.create(id, 0, 0, n, a, 0, 0);
        vm.expectRevert(PrizeRules.BadParams.selector); // pool without slots
        pr.create(id, 0, 0, n, a, 1e18, 0);
        (n, a) = _lucky(2, 2, 1e18, 1e18); // duplicate position
        vm.expectRevert(PrizeRules.BadParams.selector);
        pr.create(id, 0, 0, n, a, 0, 0);
        (n, a) = _lucky(0, 2, 1e18, 1e18); // position 0
        vm.expectRevert(PrizeRules.BadParams.selector);
        pr.create(id, 0, 0, n, a, 0, 0);
        (n, a) = _lucky(1, 2, 0, 1e18); // zero amount
        vm.expectRevert(PrizeRules.BadParams.selector);
        pr.create(id, 0, 0, n, a, 0, 0);
        vm.stopPrank();
        // after the election ends
        vm.warp(block.timestamp + 2 days);
        (n, a) = _none();
        vm.prank(creator);
        vm.expectRevert(PrizeRules.NotOpen.selector);
        pr.create(id, 1e18, 0, n, a, 0, 0);
    }

    // ───────── lucky: instant payout when the Nth vote lands ─────────

    function test_lucky_paid_instantly_when_Nth_vote_recorded() public {
        uint256 id = _election(address(0));
        _create(id, 0, 0, 2, 4, 0, 0);
        _vote(alice, id, 0);
        vm.expectRevert(PrizeRules.TooEarly.selector); // position 2 not recorded yet
        pr.payLucky(id, 0);
        _vote(bob, id, 1); // 2nd vote
        uint256 b = w.balanceOf(bob);
        vm.expectEmit(true, false, false, true);
        emit PrizeRules.LuckyHit(id, 0, 2, bob, 7e18);
        pr.payLucky(id, 0); // anyone triggers, bob is paid
        assertEq(w.balanceOf(bob) - b, 7e18);
        vm.expectRevert(PrizeRules.AlreadyClaimed.selector);
        pr.payLucky(id, 0);
        // spot 4 still waits
        vm.expectRevert(PrizeRules.TooEarly.selector);
        pr.payLucky(id, 1);
        _vote(carol, id, 0);
        _vote(dave, id, 0);
        pr.payLucky(id, 1);
        assertEq(w.balanceOf(dave), 100e18 - 1e18 + 3e18);
    }

    function test_lucky_claim_with_proof_matches_and_rejects_wrong_voter() public {
        uint256 id = _election(address(0));
        _create(id, 0, 0, 1, 3, 0, 0);
        _vote(alice, id, 0);
        vm.expectRevert(PrizeRules.BadProof.selector);
        pr.claim(id, PrizeRules.Kind.Lucky, 0, 0, bob, 0, _noProof());
        vm.expectRevert(PrizeRules.NotWinner.selector);
        pr.claim(id, PrizeRules.Kind.Lucky, 0, 1, alice, 0, _noProof());
        uint256 a = w.balanceOf(alice);
        pr.claim(id, PrizeRules.Kind.Lucky, 0, 0, alice, 0, _noProof());
        assertEq(w.balanceOf(alice) - a, 7e18);
    }

    // ───────── first / last / random after finalize ─────────

    function _fiveVotesFinalize(uint256 id) internal {
        for (uint256 i; i < 5; ++i) _vote(who[i], id, uint8(i % 3));
        vm.warp(block.timestamp + 1 days + 1);
        hub.finalize(id);
    }

    function test_first_last_random_flow() public {
        uint256 id = _election(address(0));
        _create(id, 10e18, 5e18, 9, 2, 20e18, 2); // lucky pos 9 never reached, pos 2 reached
        _vote(alice, id, 0);
        // first prize is claimable right away
        pr.claim(id, PrizeRules.Kind.First, 0, 0, alice, 0, _noProof());
        for (uint256 i = 1; i < 5; ++i) _vote(who[i], id, uint8(i % 3));
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(PrizeRules.TooEarly.selector);
        pr.settle(id); // not finalized yet
        hub.finalize(id);
        vm.expectRevert(PrizeRules.NotSettled.selector);
        pr.claim(id, PrizeRules.Kind.Last, 0, 4, eve, 0, _noProof());
        pr.settle(id);
        // last = eve (5th)
        uint256 e0 = w.balanceOf(eve);
        pr.claim(id, PrizeRules.Kind.Last, 0, 4, eve, 0, _noProof());
        assertEq(w.balanceOf(eve) - e0, 5e18);
        // random not seeded yet
        vm.expectRevert(PrizeRules.NotSeeded.selector);
        pr.indexOf(id, PrizeRules.Kind.Random, 0);
        vm.expectRevert(PrizeRules.TooEarly.selector);
        pr.seed(id);
        vm.roll(block.number + 11);
        pr.seed(id);
        for (uint256 s; s < 2; ++s) {
            uint256 idx = pr.indexOf(id, PrizeRules.Kind.Random, s);
            assertLt(idx, 5);
            address v = who[idx];
            uint256 b = w.balanceOf(v);
            pr.claim(id, PrizeRules.Kind.Random, s, idx, v, uint8(idx % 3), _noProof());
            assertEq(w.balanceOf(v) - b, 10e18);
            vm.expectRevert(PrizeRules.AlreadyClaimed.selector);
            pr.claim(id, PrizeRules.Kind.Random, s, idx, v, uint8(idx % 3), _noProof());
        }
        // lucky 9 is forfeited (only 5 entries); position 2 can still be triggered
        vm.expectRevert(PrizeRules.TooEarly.selector);
        pr.payLucky(id, 0);
        pr.payLucky(id, 1);
        // reclaim: too early, then after window gets the forfeited 7
        vm.prank(creator);
        vm.expectRevert(PrizeRules.TooEarly.selector);
        pr.reclaim(id);
        vm.warp(block.timestamp + 31 days);
        uint256 c = w.balanceOf(creator);
        vm.prank(alice);
        vm.expectRevert(PrizeRules.NotCreator.selector);
        pr.reclaim(id);
        vm.prank(creator);
        pr.reclaim(id);
        assertEq(w.balanceOf(creator) - c, 7e18);
        assertEq(w.balanceOf(address(pr)), 0);
        vm.prank(creator);
        vm.expectRevert(PrizeRules.NothingToReclaim.selector);
        pr.reclaim(id);
    }

    function test_claim_window_closes() public {
        uint256 id = _election(address(0));
        _create(id, 10e18, 5e18, 1, 2, 0, 0);
        _fiveVotesFinalize(id);
        pr.settle(id);
        vm.expectRevert(PrizeRules.NotOpen.selector);
        pr.settle(id);
        vm.warp(block.timestamp + 31 days);
        vm.expectRevert(PrizeRules.TooLate.selector);
        pr.claim(id, PrizeRules.Kind.Last, 0, 4, eve, 0, _noProof());
        vm.expectRevert(PrizeRules.TooLate.selector);
        pr.payLucky(id, 0);
    }

    function test_no_entries_refund_immediately() public {
        uint256 id = _election(address(0));
        _create(id, 10e18, 5e18, 1, 2, 20e18, 2);
        vm.warp(block.timestamp + 1 days + 1);
        hub.finalize(id);
        pr.settle(id);
        assertEq(pr.getPrize(id).drawBlock, 0);
        vm.expectRevert(PrizeRules.NotWinner.selector);
        pr.indexOf(id, PrizeRules.Kind.Last, 0);
        uint256 c = w.balanceOf(creator);
        vm.prank(creator);
        pr.reclaim(id);
        assertEq(w.balanceOf(creator) - c, 45e18);
    }

    function test_rearm_after_hash_expires() public {
        uint256 id = _election(address(0));
        _create(id, 10e18, 0, 9, 10, 20e18, 1);
        _fiveVotesFinalize(id);
        pr.settle(id);
        uint64 db = pr.getPrize(id).drawBlock;
        vm.expectRevert(PrizeRules.TooEarly.selector);
        pr.rearm(id);
        vm.roll(block.number + 300);
        vm.expectRevert(PrizeRules.TooEarly.selector);
        pr.seed(id);
        pr.rearm(id);
        assertGt(pr.getPrize(id).drawBlock, db);
        vm.roll(block.number + 11);
        pr.seed(id);
    }

    // ───────── deposit-path (Merkle) voters count ─────────

    function test_deposit_path_voters_count_for_last_lucky_and_random() public {
        uint256 id = _election(tallier);
        _create(id, 0, 6e18, 3, 9, 10e18, 1); // lucky position 3 = first deposit entry
        _vote(alice, id, 0);
        _vote(bob, id, 1);
        vm.warp(block.timestamp + 1 days);
        bytes32 l0 = hub.leafOf(0, carol, 1);
        bytes32 l1 = hub.leafOf(1, dave, 2);
        uint32[] memory c = new uint32[](3);
        c[1] = 1;
        c[2] = 1;
        vm.prank(tallier);
        hub.submitDeposits(id, c, _hashPair(l0, l1), "u");
        vm.warp(block.timestamp + 6 hours);
        hub.finalize(id);
        pr.settle(id);
        assertEq(hub.totalEntries(id), 4);
        bytes32[] memory pCarol = new bytes32[](1);
        pCarol[0] = l1;
        bytes32[] memory pDave = new bytes32[](1);
        pDave[0] = l0;
        // payLucky can't resolve a deposit-path position (no proof); claim does
        vm.expectRevert(PrizeRules.TooEarly.selector);
        pr.payLucky(id, 0);
        vm.expectRevert(PrizeRules.BadProof.selector);
        pr.claim(id, PrizeRules.Kind.Lucky, 0, 2, dave, 2, pDave);
        uint256 cb = w.balanceOf(carol);
        pr.claim(id, PrizeRules.Kind.Lucky, 0, 2, carol, 1, pCarol);
        assertEq(w.balanceOf(carol) - cb, 7e18);
        // last = dave (deposit entry 3)
        uint256 db = w.balanceOf(dave);
        pr.claim(id, PrizeRules.Kind.Last, 0, 3, dave, 2, pDave);
        assertEq(w.balanceOf(dave) - db, 6e18);
        // random winner can be any of the four
        vm.roll(block.number + 11);
        pr.seed(id);
        uint256 idx = pr.indexOf(id, PrizeRules.Kind.Random, 0);
        assertLt(idx, 4);
    }

    function testFuzz_random_index_in_range(uint8 n) public {
        n = uint8(bound(n, 1, 6));
        uint256 id = _election(address(0));
        _create(id, 0, 0, 20, 21, 10e18, 1);
        for (uint256 i; i < n; ++i) _vote(who[i], id, 0);
        vm.warp(block.timestamp + 1 days + 1);
        hub.finalize(id);
        pr.settle(id);
        vm.roll(block.number + 11);
        pr.seed(id);
        assertLt(pr.indexOf(id, PrizeRules.Kind.Random, 0), n);
    }
}
