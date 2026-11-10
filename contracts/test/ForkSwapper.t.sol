// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {WifSwapper} from "../src/WifSwapper.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ForkSwapperTest is Test {
    function test_fork_eth_to_wif() public {
        if (block.chainid != 4663) vm.skip(true);
        WifSwapper s = new WifSwapper();
        address u = makeAddr("u");
        vm.deal(u, 1 ether);
        uint256 w0 = IERC20(s.WIF()).balanceOf(u);
        vm.prank(u);
        uint256 out = s.swapEthForWif{value: 0.00048 ether}(1);
        emit log_named_uint("WIF out (wei) for 0.00048 ETH", out);
        assertEq(IERC20(s.WIF()).balanceOf(u) - w0, out);
        assertEq(address(s).balance, 0);
        assertEq(u.balance, 1 ether - 0.00048 ether);
        vm.prank(u);
        vm.expectRevert();
        s.swapEthForWif{value: 0.00048 ether}(out * 100); // slippage guard
    }
}
