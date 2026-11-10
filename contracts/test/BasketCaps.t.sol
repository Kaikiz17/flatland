// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BasketVault} from "../src/basket/BasketVault.sol";
import {Flatland} from "../src/Flatland.sol";
import {WifBuyback} from "../src/WifBuyback.sol";
import {Standing} from "../src/Standing.sol";

contract MockUSDG is ERC20 {
    constructor() ERC20("USDG", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

/// Offline tests for the beta deposit caps (empty asset registry: NAV == idle USDG, so no oracles/DEX needed).
contract BasketCapsTest is Test {
    BasketVault v;
    MockUSDG usdg;
    address gov = makeAddr("gov");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        usdg = new MockUSDG();
        v = new BasketVault(
            Flatland(address(1)), WifBuyback(payable(address(2))), Standing(address(3)), address(usdg), address(5), new BasketVault.AssetCfg[](0), 1, 1, gov
        );
        for (uint256 i; i < 3; ++i) {
            address a = i == 0 ? alice : i == 1 ? bob : address(this);
            usdg.mint(a, 100_000e6);
            vm.prank(a);
            usdg.approve(address(v), type(uint256).max);
        }
    }

    function _dep(address who, uint256 amt) internal returns (uint256) {
        vm.prank(who);
        return v.deposit(amt, 0, who);
    }

    function test_defaults() public view {
        assertEq(v.walletCap(), 100e6);
        assertEq(v.tvlCap(), 1_000e6);
        assertEq(v.governance(), gov);
    }

    function test_deposit_up_to_wallet_cap_ok() public {
        // 100 USDG gross = 99.70 net, under the 100 cap
        _dep(alice, 100e6);
        assertGt(v.balanceOf(alice), 0);
    }

    function test_wallet_cap_blocks_above() public {
        vm.prank(alice);
        vm.expectRevert(); // net 100.70 > 100
        v.deposit(101e6, 0, alice);
    }

    function test_wallet_cap_is_cumulative() public {
        _dep(alice, 60e6);
        vm.prank(alice);
        vm.expectRevert();
        v.deposit(60e6, 0, alice);
        _dep(alice, 40e6); // 59.82 + 39.88 = 99.7 ok
    }

    function test_cap_applies_to_receiver_not_payer() public {
        _dep(alice, 90e6);
        vm.prank(bob);
        vm.expectRevert(); // bob paying into alice's position is capped on alice
        v.deposit(30e6, 0, alice);
        vm.prank(bob);
        v.deposit(30e6, 0, bob); // his own position is fine
    }

    function test_tvl_cap_blocks_after_ten_wallets() public {
        for (uint256 i; i < 10; ++i) {
            address w = makeAddr(string.concat("w", vm.toString(i)));
            usdg.mint(w, 100e6);
            vm.prank(w);
            usdg.approve(address(v), type(uint256).max);
            _dep(w, 100e6);
        }
        // NAV is ~997 of 1000; an 11th 100 USDG deposit pushes past the cap
        vm.prank(alice);
        vm.expectRevert();
        v.deposit(100e6, 0, alice);
        // but a small one that still fits is OK
        _dep(alice, 2e6);
    }

    function test_redeem_frees_wallet_room() public {
        uint256 s = _dep(alice, 100e6);
        vm.prank(alice);
        v.redeem(s / 2, 0, alice);
        _dep(alice, 40e6);
    }

    function test_maxDeposit_view_matches_behaviour() public {
        uint256 m = v.maxDeposit(alice);
        assertApproxEqAbs(m, uint256(100e6) * 10_000 / 9_970, 1);
        _dep(alice, m);
        vm.prank(alice);
        vm.expectRevert();
        v.deposit(1e6, 0, alice);
        assertLt(v.maxDeposit(alice), 1e3);
    }

    function test_only_governance_sets_caps() public {
        vm.expectRevert(BasketVault.NotGovernance.selector);
        v.setCaps(1, 1);
        vm.prank(gov);
        v.setCaps(500e6, 5_000e6);
        assertEq(v.walletCap(), 500e6);
        assertEq(v.tvlCap(), 5_000e6);
        _dep(alice, 400e6); // now allowed
    }

    function test_lowering_cap_never_traps_funds() public {
        uint256 s = _dep(alice, 100e6);
        vm.prank(gov);
        v.setCaps(10e6, 10e6);
        vm.prank(alice);
        v.redeem(s, 0, alice); // exits are never capped
        vm.prank(alice);
        vm.expectRevert();
        v.deposit(50e6, 0, alice);
    }

    function test_governance_handover_and_renounce() public {
        vm.prank(gov);
        v.setGovernance(bob);
        vm.prank(gov);
        vm.expectRevert(BasketVault.NotGovernance.selector);
        v.setCaps(1, 1);
        vm.prank(bob);
        v.setCaps(200e6, 2_000e6);
        vm.prank(bob);
        v.setGovernance(address(0)); // renounce: caps frozen forever
        vm.prank(bob);
        vm.expectRevert(BasketVault.NotGovernance.selector);
        v.setCaps(1, 1);
        assertEq(v.walletCap(), 200e6);
    }
}
