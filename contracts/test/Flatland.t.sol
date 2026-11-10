// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base, MockWIF} from "./Base.t.sol";
import {Flatland} from "../src/Flatland.sol";
import {IOutcomeExecutor} from "../src/interfaces/IOutcomeExecutor.sol";
import {DepositBox} from "../src/DepositBox.sol";

contract OkExecutor is IOutcomeExecutor {
    uint256 public lastId;
    uint8 public lastWinner;
    uint256[] public lastTally;

    function onFinalize(uint256 id, uint8 winner, uint256[] calldata tally) external {
        lastId = id;
        lastWinner = winner;
        delete lastTally;
        for (uint256 i; i < tally.length; ++i) lastTally.push(tally[i]);
    }
}

contract FlakyExecutor is IOutcomeExecutor {
    bool public fail = true;

    function setFail(bool f) external {
        fail = f;
    }

    function onFinalize(uint256, uint8, uint256[] calldata) external view {
        require(!fail, "market closed");
    }
}

contract GasBomb is IOutcomeExecutor {
    function onFinalize(uint256, uint8, uint256[] calldata) external pure {
        while (true) {}
    }
}

contract FlatlandTest is Base {
    MockWIF w;

    function setUp() public {
        vm.warp(1_794_000_000);
        w = new MockWIF();
        _deployCore(address(w));
        _lock(new address[](0));
        _fund(alice, 1000e18);
        _fund(bob, 1000e18);
        _fund(carol, 1000e18);
        _fund(dave, 1000e18);
        _fund(creator, 1000e18);
    }

    function _fund(address who, uint256 amt) internal override {
        w.mint(who, amt);
    }

    function _create(address tal, address exec, uint32 winners) internal returns (uint256 id) {
        vm.prank(creator);
        id = hub.createElection(_params(tal, exec, winners));
    }

    // ───────── creation & validation ─────────

    function test_create_validation() public {
        Flatland.Params memory p = _params(address(0), address(0), 0);
        p.options = _opts(1);
        vm.expectRevert(Flatland.BadParams.selector);
        hub.createElection(p);
        p = _params(address(0), address(0), 0);
        p.voteCost = 0.5e18;
        vm.expectRevert(Flatland.BadParams.selector);
        hub.createElection(p);
        p = _params(address(0), address(0), 0);
        p.end = uint64(block.timestamp + 10 minutes);
        vm.expectRevert(Flatland.BadParams.selector);
        hub.createElection(p);
        p = _params(address(tallier), address(0), 0);
        p.challengeWindow = 1 minutes;
        vm.expectRevert(Flatland.BadParams.selector);
        hub.createElection(p);
        p = _params(address(0), address(0), 3);
        p.prizeToken = address(0);
        vm.expectRevert(Flatland.BadParams.selector);
        hub.createElection(p);
    }

    // ───────── 1 wallet = 1 vote, real burn ─────────

    function test_vote_burns_supply_and_counts_once() public {
        uint256 id = _create(address(0), address(0), 0);
        uint256 supply = w.totalSupply();
        _vote(alice, id, 1);
        assertEq(w.totalSupply(), supply - 1e18, "real burn");
        assertEq(w.balanceOf(alice), 999e18);
        assertEq(hub.tallies(id)[1], 1);
        (bool v, uint8 o) = hub.voteOf(id, alice);
        assertTrue(v);
        assertEq(o, 1);
        vm.prank(alice);
        vm.expectRevert(Flatland.AlreadyVoted.selector);
        hub.vote(id, 2);
        assertEq(hub.totalBurned(), 1e18);
        assertEq(hub.totalVotes(), 1);
    }

    function test_vote_window_and_option_bounds() public {
        Flatland.Params memory p = _params(address(0), address(0), 0);
        p.start = uint64(block.timestamp + 1 hours);
        p.end = uint64(block.timestamp + 3 hours);
        vm.prank(creator);
        uint256 id = hub.createElection(p);
        vm.startPrank(alice);
        w.approve(address(hub), type(uint256).max);
        vm.expectRevert(Flatland.NotStarted.selector);
        hub.vote(id, 0);
        vm.warp(block.timestamp + 90 minutes);
        vm.expectRevert(Flatland.BadOption.selector);
        hub.vote(id, 3);
        hub.vote(id, 2);
        vm.warp(block.timestamp + 3 hours);
        vm.expectRevert(Flatland.Ended.selector);
        hub.vote(id, 0);
        vm.stopPrank();
    }

    function testFuzz_oneWalletOneVote(uint8 opt, uint8 times) public {
        opt = uint8(bound(opt, 0, 2));
        times = uint8(bound(times, 1, 6));
        uint256 id = _create(address(0), address(0), 0);
        vm.startPrank(alice);
        w.approve(address(hub), type(uint256).max);
        hub.vote(id, opt);
        for (uint256 i = 1; i < times; ++i) {
            vm.expectRevert(Flatland.AlreadyVoted.selector);
            hub.vote(id, opt);
        }
        vm.stopPrank();
        assertEq(hub.tallies(id)[opt], 1);
        assertEq(w.balanceOf(alice), 999e18);
    }

    function test_higher_cost_still_one_vote() public {
        Flatland.Params memory p = _params(address(0), address(0), 0);
        p.voteCost = 25e18;
        vm.prank(creator);
        uint256 id = hub.createElection(p);
        _vote(alice, id, 0);
        assertEq(w.balanceOf(alice), 975e18);
        assertEq(hub.tallies(id)[0], 1);
    }

    // ───────── deposit path ─────────

    function test_depositAddress_deterministic_and_sweep_burns() public {
        uint256 id = _create(tallier, address(0), 0);
        address box = hub.depositAddress(id, 1);
        assertEq(box.code.length, 0, "counterfactual before sweep");
        vm.prank(alice);
        w.transfer(box, 1e18); // the "just send 1 WIF" vote
        vm.prank(bob);
        w.transfer(box, 5e18); // extra WIF: counts once, still burned
        uint256 supply = w.totalSupply();
        uint256 burned = hub.sweepDeposits(id, 1);
        assertEq(burned, 6e18);
        assertEq(w.totalSupply(), supply - 6e18);
        assertGt(box.code.length, 0);
        assertEq(hub.depositAddress(id, 1), box, "stable");
        assertTrue(hub.depositAddress(id, 0) != box);
        assertTrue(hub.depositAddress(id + 1, 1) != box);
        // sweeping again is a harmless no-op, and boxes are hub-only
        assertEq(hub.sweepDeposits(id, 1), 0);
        vm.expectRevert(DepositBox.OnlyHub.selector);
        DepositBox(box).burnAll();
        assertEq(hub.getElection(id).burned, 6e18);
    }

    function _leaf(uint256 i, address v, uint8 o) internal view returns (bytes32) {
        return hub.leafOf(i, v, o);
    }

    function _depositScenario() internal returns (uint256 id, bytes32 root, bytes32 l0, bytes32 l1) {
        id = _create(tallier, address(0), 0);
        _vote(alice, id, 0); // chain voter
        vm.warp(block.timestamp + 1 days);
        l0 = _leaf(0, bob, 1);
        l1 = _leaf(1, carol, 1);
        root = _hashPair(l0, l1);
        uint32[] memory c = new uint32[](3);
        c[1] = 2;
        vm.prank(tallier);
        hub.submitDeposits(id, c, root, "ipfs://groups");
    }

    function test_submitDeposits_access_and_timing() public {
        uint256 id = _create(tallier, address(0), 0);
        uint32[] memory c = new uint32[](3);
        vm.prank(tallier);
        vm.expectRevert(Flatland.StillRunning.selector);
        hub.submitDeposits(id, c, bytes32(0), "");
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(Flatland.OnlyTallier.selector);
        hub.submitDeposits(id, c, bytes32(0), "");
        vm.prank(tallier);
        vm.expectRevert(Flatland.BadParams.selector);
        hub.submitDeposits(id, new uint32[](2), bytes32(0), "");
        // fully-onchain election: nobody can submit
        uint256 id2;
        vm.warp(block.timestamp - 1 days);
        id2 = _create(address(0), address(0), 0);
        vm.warp(block.timestamp + 1 days);
        vm.prank(address(0));
        vm.expectRevert(Flatland.OnlyTallier.selector);
        hub.submitDeposits(id2, c, bytes32(0), "");
    }

    function test_finalize_waits_for_deposits_and_challenge_window() public {
        (uint256 id,,,) = _depositScenario();
        assertFalse(hub.canFinalize(id));
        vm.expectRevert(Flatland.NotReady.selector);
        hub.finalize(id);
        vm.warp(block.timestamp + 6 hours);
        hub.finalize(id);
        uint256[] memory t = hub.tallies(id);
        assertEq(t[0], 1);
        assertEq(t[1], 2);
        assertEq(hub.getElection(id).winner, 1);
        vm.expectRevert(Flatland.AlreadyFinal.selector);
        hub.finalize(id);
    }

    function test_finalize_without_attestation_after_grace() public {
        uint256 id = _create(tallier, address(0), 0);
        _vote(alice, id, 2);
        vm.warp(block.timestamp + 1 days + 1);
        assertFalse(hub.canFinalize(id));
        vm.warp(block.timestamp + 2 days);
        assertTrue(hub.canFinalize(id));
        hub.finalize(id);
        assertEq(hub.getElection(id).winner, 2); // onchain votes stand even if the indexer vanishes
    }

    function test_no_tallier_finalizes_immediately() public {
        uint256 id = _create(address(0), address(0), 0);
        _vote(alice, id, 0);
        assertFalse(hub.canFinalize(id));
        vm.warp(block.timestamp + 1 days);
        assertTrue(hub.canFinalize(id));
    }

    function test_tie_goes_to_lowest_index() public {
        uint256 id = _create(address(0), address(0), 0);
        _vote(alice, id, 2);
        _vote(bob, id, 1);
        vm.warp(block.timestamp + 1 days);
        hub.finalize(id);
        assertEq(hub.getElection(id).winner, 1);
    }

    // ───────── sybil collapse & challenge-by-burn ─────────

    function test_collapse_removes_vote_and_blocks_revote() public {
        uint256 id = _create(tallier, address(0), 0);
        _vote(alice, id, 0);
        _vote(bob, id, 0);
        _vote(carol, id, 1);
        vm.prank(tallier);
        hub.collapse(id, bob, alice, "ipfs://cluster-1");
        assertEq(hub.tallies(id)[0], 1);
        assertEq(hub.voterCount(id), 2);
        assertFalse(hub.hasVoted(id, bob));
        // swap-and-pop kept indexes coherent
        assertEq(hub.voterAt(id, 0), alice);
        assertEq(hub.voterAt(id, 1), carol);
        vm.prank(bob);
        vm.expectRevert(Flatland.AlreadyVoted.selector);
        hub.vote(id, 2);
        // only the tallier collapses
        vm.expectRevert(Flatland.OnlyTallier.selector);
        hub.collapse(id, alice, carol, "");
    }

    function test_challenge_burns_and_upheld_removes_vote() public {
        uint256 id = _create(tallier, address(0), 0);
        _vote(alice, id, 0);
        _vote(bob, id, 0);
        uint256 supply = w.totalSupply();
        vm.startPrank(carol);
        w.approve(address(hub), type(uint256).max);
        uint256 cid = hub.challenge(id, bob, "same funder as alice: 0xabc");
        vm.stopPrank();
        assertEq(w.totalSupply(), supply - 10e18, "challenge-by-burn");
        assertEq(hub.challengeCount(id), 1);
        vm.warp(block.timestamp + 1 days);
        assertFalse(hub.canFinalize(id), "open challenge blocks finalization");
        vm.prank(tallier);
        hub.resolveChallenge(id, cid, true);
        assertEq(hub.tallies(id)[0], 1);
        assertFalse(hub.hasVoted(id, bob));
        vm.warp(block.timestamp + 3 days);
        hub.finalize(id);
    }

    function test_unresolved_challenge_cannot_block_forever() public {
        uint256 id = _create(tallier, address(0), 0);
        _vote(alice, id, 0);
        vm.warp(block.timestamp + 1 days);
        vm.startPrank(carol);
        w.approve(address(hub), type(uint256).max);
        hub.challenge(id, alice, "x");
        vm.stopPrank();
        assertFalse(hub.canFinalize(id));
        vm.warp(block.timestamp + 3 days);
        assertTrue(hub.canFinalize(id));
    }

    function test_challenge_requires_tallier() public {
        uint256 id = _create(address(0), address(0), 0);
        vm.startPrank(carol);
        w.approve(address(hub), type(uint256).max);
        vm.expectRevert(Flatland.NoTallier.selector);
        hub.challenge(id, alice, "x");
        vm.stopPrank();
    }

    // ───────── executable outcomes ─────────

    function test_executor_called_on_finalize() public {
        OkExecutor ex = new OkExecutor();
        uint256 id = _create(address(0), address(ex), 0);
        _vote(alice, id, 2);
        _vote(bob, id, 2);
        _vote(carol, id, 0);
        vm.warp(block.timestamp + 1 days);
        hub.finalize(id);
        assertEq(ex.lastId(), id);
        assertEq(ex.lastWinner(), 2);
        assertEq(ex.lastTally(2), 2);
        assertTrue(hub.getElection(id).executed);
    }

    function test_failing_executor_never_blocks_finalize_and_can_retry() public {
        FlakyExecutor ex = new FlakyExecutor();
        uint256 id = _create(address(0), address(ex), 0);
        _vote(alice, id, 1);
        vm.warp(block.timestamp + 1 days);
        hub.finalize(id);
        assertFalse(hub.getElection(id).executed);
        ex.setFail(false);
        hub.retryOutcome(id);
        assertTrue(hub.getElection(id).executed);
        vm.expectRevert(Flatland.NotReady.selector);
        hub.retryOutcome(id);
    }

    function test_gas_bomb_executor_cannot_brick_finalize() public {
        GasBomb ex = new GasBomb();
        uint256 id = _create(address(0), address(ex), 0);
        _vote(alice, id, 1);
        vm.warp(block.timestamp + 1 days);
        hub.finalize{gas: 3_000_000}(id);
        assertEq(uint8(hub.getElection(id).status), 2);
        assertFalse(hub.getElection(id).executed);
    }

    // ───────── draw & prizes ─────────

    function _prizeElection() internal returns (uint256 id) {
        id = _create(address(0), address(0), 2);
        vm.startPrank(creator);
        w.approve(address(hub), type(uint256).max);
        hub.fundPrize(id, 100e18);
        vm.stopPrank();
        _vote(alice, id, 0);
        _vote(bob, id, 1);
        _vote(carol, id, 2);
        vm.warp(block.timestamp + 1 days);
        hub.finalize(id);
    }

    function test_draw_every_voter_has_an_entry_and_winner_is_provable() public {
        uint256 id = _prizeElection();
        assertEq(hub.totalEntries(id), 3);
        Flatland.Election memory e = hub.getElection(id);
        assertGt(e.drawBlock, 0);
        vm.expectRevert(Flatland.NotReady.selector);
        hub.seedDraw(id); // block not mined yet
        vm.roll(block.number + 11);
        hub.seedDraw(id);
        uint256 idx0 = hub.winnerIndex(id, 0);
        address win0 = hub.voterAt(id, idx0);
        uint256 before = w.balanceOf(win0);
        // a non-winner index cannot claim
        uint256 wrong = (idx0 + 1) % 3;
        address wrongVoter = hub.voterAt(id, wrong);
        vm.expectRevert(Flatland.NotWinner.selector);
        hub.claimPrize(id, 0, wrong, wrongVoter, 0, new bytes32[](0));
        hub.claimPrize(id, 0, idx0, win0, 0, new bytes32[](0));
        assertEq(w.balanceOf(win0), before + 50e18);
        vm.expectRevert(Flatland.AlreadyClaimed.selector);
        hub.claimPrize(id, 0, idx0, win0, 0, new bytes32[](0));
        // seed cannot be re-rolled
        vm.expectRevert(Flatland.NoDraw.selector);
        hub.seedDraw(id);
    }

    function test_draw_deterministic_given_seed_and_spread() public {
        uint256 id = _prizeElection();
        vm.roll(block.number + 11);
        hub.seedDraw(id);
        // slot indexes are a pure function of the frozen seed
        assertEq(hub.winnerIndex(id, 0), hub.winnerIndex(id, 0));
        assertLt(hub.winnerIndex(id, 1), 3);
    }

    function test_rearm_when_blockhash_expired() public {
        uint256 id = _prizeElection();
        vm.roll(block.number + 300);
        vm.expectRevert(Flatland.NotReady.selector);
        hub.seedDraw(id);
        hub.rearmDraw(id);
        vm.roll(block.number + 11);
        hub.seedDraw(id);
        assertGt(uint256(hub.getElection(id).seed), 0);
    }

    function test_unclaimed_wif_prize_is_burned() public {
        uint256 id = _prizeElection();
        vm.roll(block.number + 11);
        hub.seedDraw(id);
        vm.expectRevert(Flatland.NotReady.selector);
        hub.reclaimPrize(id);
        uint256 supply = w.totalSupply();
        vm.warp(block.timestamp + 31 days);
        hub.reclaimPrize(id);
        assertEq(w.totalSupply(), supply - 100e18);
    }

    function test_no_entries_prize_burned_immediately() public {
        uint256 id = _create(address(0), address(0), 1);
        vm.startPrank(creator);
        w.approve(address(hub), type(uint256).max);
        hub.fundPrize(id, 10e18);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        hub.finalize(id);
        assertEq(hub.getElection(id).drawBlock, 0);
        hub.reclaimPrize(id);
    }

    function test_draw_includes_deposit_voters_via_merkle() public {
        uint256 id = _create(tallier, address(0), 3);
        vm.startPrank(creator);
        w.approve(address(hub), type(uint256).max);
        hub.fundPrize(id, 90e18);
        vm.stopPrank();
        _vote(alice, id, 0);
        vm.warp(block.timestamp + 1 days);
        bytes32 l0 = _leaf(0, bob, 1);
        bytes32 l1 = _leaf(1, carol, 2);
        uint32[] memory c = new uint32[](3);
        c[1] = 1;
        c[2] = 1;
        vm.prank(tallier);
        hub.submitDeposits(id, c, _hashPair(l0, l1), "u");
        vm.warp(block.timestamp + 6 hours);
        hub.finalize(id);
        assertEq(hub.totalEntries(id), 3);
        // entry 1 = bob, entry 2 = carol
        bytes32[] memory pBob = new bytes32[](1);
        pBob[0] = l1;
        assertTrue(hub.isEntry(id, 1, bob, 1, pBob));
        assertFalse(hub.isEntry(id, 1, carol, 1, pBob));
        assertFalse(hub.isEntry(id, 1, bob, 2, pBob)); // option is bound in the leaf
        assertFalse(hub.isEntry(id, 5, bob, 1, pBob));
        vm.roll(block.number + 11);
        hub.seedDraw(id);
        // find a slot that landed on a deposit voter (or none) and claim it
        uint256 bobSlots;
        for (uint256 s; s < 3; ++s) {
            uint256 idx = hub.winnerIndex(id, s);
            if (idx == 1) {
                hub.claimPrize(id, s, 1, bob, 1, pBob);
                ++bobSlots;
            }
            if (idx == 0) hub.claimPrize(id, s, 0, alice, 0, new bytes32[](0));
        }
        assertEq(w.balanceOf(bob), 1000e18 + 30e18 * bobSlots);
    }

    // ───────── reputation / streaks ─────────

    function test_streaks_and_tiers() public {
        uint256 t = block.timestamp;
        for (uint256 week; week < 4; ++week) {
            uint256 id = _create(address(0), address(0), 0);
            _vote(alice, id, 0);
            t += 7 days;
            vm.warp(t);
        }
        assertEq(standing.record(alice).votes, 4);
        assertEq(standing.record(alice).streak, 4);
        assertEq(standing.tier(alice), 3);
        // skip two weeks: streak resets, best stays
        t += 14 days;
        vm.warp(t);
        uint256 id2 = _create(address(0), address(0), 0);
        _vote(alice, id2, 1);
        assertEq(standing.record(alice).streak, 1);
        assertEq(standing.record(alice).bestStreak, 4);
        assertEq(standing.uniqueParticipants(), 1);
    }

    function test_standing_claim_for_deposit_voters() public {
        uint256 id = _create(tallier, address(0), 0);
        vm.warp(block.timestamp + 1 days);
        bytes32 l0 = _leaf(0, bob, 1);
        bytes32 l1 = _leaf(1, carol, 1);
        uint32[] memory c = new uint32[](3);
        c[1] = 2;
        vm.prank(tallier);
        hub.submitDeposits(id, c, _hashPair(l0, l1), "u");
        vm.warp(block.timestamp + 6 hours);
        hub.finalize(id);
        bytes32[] memory p = new bytes32[](1);
        p[0] = l1;
        hub.claimStanding(id, 0, bob, 1, p);
        assertEq(standing.record(bob).votes, 1);
        vm.expectRevert(Flatland.AlreadyClaimed.selector);
        hub.claimStanding(id, 0, bob, 1, p);
        vm.expectRevert(Flatland.BadProof.selector);
        hub.claimStanding(id, 0, dave, 1, p);
    }

    function test_country_opt_in_is_coarse_and_clearable() public {
        vm.prank(alice);
        standing.setCountry("NG");
        assertEq(standing.countryWallets("NG"), 1);
        vm.prank(alice);
        standing.setCountry("US");
        assertEq(standing.countryWallets("NG"), 0);
        assertEq(standing.countryWallets("US"), 1);
        vm.prank(alice);
        standing.setCountry(0x0000);
        assertEq(standing.countryWallets("US"), 0);
        vm.prank(alice);
        vm.expectRevert();
        standing.setCountry("ng"); // lowercase / garbage rejected
    }

    function test_standing_writers_locked() public {
        vm.expectRevert(); // already wired by setUp, no admin afterwards
        standing.setWriters(new address[](0));
        vm.prank(alice);
        vm.expectRevert();
        standing.recordVote(alice, block.timestamp, 0);
    }
}
