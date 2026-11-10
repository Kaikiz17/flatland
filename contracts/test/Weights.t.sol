// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {BasketVault} from "../src/basket/BasketVault.sol";
import {Flatland} from "../src/Flatland.sol";
import {WifBuyback} from "../src/WifBuyback.sol";
import {Standing} from "../src/Standing.sol";

contract WeightsTest is Test {
    BasketVault v;

    function setUp() public {
        // pure-logic tests: registry/addresses irrelevant (WifBuyback is not constructed; only an address is stored)
        v = new BasketVault(
            Flatland(address(1)), WifBuyback(payable(address(2))), Standing(address(3)), address(4), address(5), new BasketVault.AssetCfg[](0), 1, 1
        );
    }

    function _sum(uint16[] memory w) internal pure returns (uint256 s) {
        for (uint256 i; i < w.length; ++i) s += w[i];
    }

    function test_single_winner_gets_everything() public view {
        uint256[] memory t = new uint256[](4);
        t[2] = 9;
        uint16[] memory w = v.previewWeights(t);
        assertEq(w[2], 10_000);
        assertEq(_sum(w), 10_000);
    }

    function test_two_winners_cap_relaxed_to_reach_100() public view {
        uint256[] memory t = new uint256[](3);
        t[0] = 8;
        t[1] = 2;
        uint16[] memory w = v.previewWeights(t);
        assertEq(_sum(w), 10_000);
        assertEq(w[0], 5000); // cap relaxed to 50% for 2 names
        assertEq(w[1], 5000);
    }

    function test_cap_40_redistributes() public view {
        uint256[] memory t = new uint256[](6);
        t[0] = 50;
        t[1] = 20;
        t[2] = 15;
        t[3] = 10;
        t[4] = 5;
        t[5] = 1; // outside top 5
        uint16[] memory w = v.previewWeights(t);
        assertEq(w[0], 4000);
        assertEq(w[5], 0);
        assertEq(_sum(w), 10_000);
        assertGt(w[1], w[2]);
    }

    function test_equal_votes_equal_weights() public view {
        uint256[] memory t = new uint256[](5);
        for (uint256 i; i < 5; ++i) t[i] = 7;
        uint16[] memory w = v.previewWeights(t);
        for (uint256 i; i < 5; ++i) assertEq(w[i], 2000);
    }

    function testFuzz_weights_invariants(uint8 n, uint256 seed) public view {
        n = uint8(bound(n, 2, 24));
        uint256[] memory t = new uint256[](n);
        uint256 total;
        for (uint256 i; i < n; ++i) {
            t[i] = uint256(keccak256(abi.encode(seed, i))) % 500;
            total += t[i];
        }
        vm.assume(total > 0);
        uint16[] memory w = v.previewWeights(t);
        assertEq(_sum(w), 10_000, "always fully allocated");
        uint256 nonzero;
        uint256 maxW;
        for (uint256 i; i < n; ++i) {
            if (w[i] > 0) ++nonzero;
            if (w[i] > maxW) maxW = w[i];
            if (t[i] == 0) assertEq(w[i], 0, "no votes, no weight");
        }
        assertLe(nonzero, 5);
        if (nonzero >= 3) assertLe(maxW, 4000 + 5, "cap holds (modulo rounding dust)");
        // monotone: more votes never means less weight (among picked)
        for (uint256 i; i < n; ++i) {
            for (uint256 j; j < n; ++j) {
                if (w[i] > 0 && w[j] > 0 && t[i] > t[j]) assertGe(w[i], w[j]);
            }
        }
    }
}
