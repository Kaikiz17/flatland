// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {WifBuyback} from "../src/WifBuyback.sol";
import {IWIF} from "../src/interfaces/IWIF.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ForkBuybackTest is Test {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WIF_ADDR = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    WifBuyback bb;
    address user = makeAddr("user");

    modifier onFork() {
        if (block.chainid != 4663) vm.skip(true);
        _;
    }

    function setUp() public {
        if (block.chainid != 4663) return;
        bb = new WifBuyback(5_000e6);
        deal(USDG, user, 10_000e6);
    }

    function test_fork_buyback_burns_real_wif_through_real_pools() public onFork {
        uint256 supply = IWIF(WIF_ADDR).totalSupply();
        vm.startPrank(user);
        IERC20(USDG).approve(address(bb), type(uint256).max);
        uint256 out = bb.buyAndBurn(100e6, 1);
        vm.stopPrank();
        emit log_named_decimal_uint("WIF burned for 100 USDG", out, 18);
        assertGt(out, 0);
        assertEq(IWIF(WIF_ADDR).totalSupply(), supply - out, "supply dropped by exactly what was bought");
        assertEq(IWIF(WIF_ADDR).balanceOf(address(bb)), 0);
        assertEq(address(bb).balance, 0);
        assertEq(IERC20(USDG).balanceOf(address(bb)), 0);
    }

    function test_fork_buyback_slippage_guard_and_cap() public onFork {
        vm.startPrank(user);
        IERC20(USDG).approve(address(bb), type(uint256).max);
        vm.expectRevert(WifBuyback.Slippage.selector);
        bb.buyAndBurn(50e6, type(uint256).max);
        vm.expectRevert(WifBuyback.TooBig.selector);
        bb.buyAndBurn(6_000e6, 1);
        vm.stopPrank();
    }
}
