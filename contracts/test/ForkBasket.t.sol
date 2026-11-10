// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {Flatland} from "../src/Flatland.sol";
import {WifBuyback} from "../src/WifBuyback.sol";
import {BasketVault} from "../src/basket/BasketVault.sol";
import {Config} from "../script/Config.sol";
import {IAggregatorV3} from "../src/interfaces/IDex.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Full People's Basket loop on a Robinhood Chain fork with REAL WIF, USDG, Stock Tokens, Chainlink feeds and Uniswap pools.
contract ForkBasketTest is Base {
    BasketVault vault;
    WifBuyback bb;
    address user = makeAddr("user");

    function setUp() public {
        if (block.chainid != 4663) return;
        _deployCore(Config.WIF);
        bb = new WifBuyback(5_000e6);
        vault = new BasketVault(hub, bb, standing, Config.USDG, Config.ROUTER02, Config.assets(), 25_000e6, 3);
        address[] memory extra = new address[](1);
        extra[0] = address(vault);
        _lock(extra);
        deal(Config.USDG, user, 100_000e6);
    }

    function _fund(address who, uint256 amt) internal override {
        deal(Config.WIF, who, amt);
    }

    modifier onFork() {
        if (block.chainid != 4663) vm.skip(true);
        _;
    }

    /// keep oracles "fresh" after we fast-forward (stock feeds only update in market hours)
    function _freshenOracles() internal {
        for (uint256 i; i < vault.assetCount(); ++i) {
            BasketVault.Asset memory a = vault.assetAt(i);
            (, int256 ans,,,) = IAggregatorV3(a.feed).latestRoundData();
            vm.mockCall(
                a.feed,
                abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
                abi.encode(uint80(1), ans, block.timestamp, block.timestamp, uint80(1))
            );
        }
    }

    function test_fork_oracles_and_registry_are_live() public onFork {
        for (uint256 i; i < vault.assetCount(); ++i) {
            uint256 p = vault.price(i);
            assertGt(p, 1e8, "price > $1");
            assertEq(IAggregatorV3(vault.assetAt(i).feed).decimals(), 8);
        }
    }

    function test_fork_full_people_basket_cycle() public onFork {
        // 1. deposit
        vm.startPrank(user);
        IERC20(Config.USDG).approve(address(vault), type(uint256).max);
        (uint256 prev, uint256 pfee) = vault.previewDeposit(50_000e6);
        uint256 shares = vault.deposit(50_000e6, prev, user);
        vm.stopPrank();
        assertEq(pfee, 150e6);
        assertEq(vault.pendingFees(), 150e6);
        assertApproxEqAbs(vault.totalAssets(), 49_850e6, 1e6);

        // 2. open epoch: a Flatland election bound to the vault
        uint256 id = vault.openEpoch();
        assertEq(hub.getElection(id).executor, address(vault));
        assertEq(hub.getElection(id).optionCount, 6);

        // 3. the people vote: 5x NVDA(2), 3x SPY(0), 2x AAPL(3), 1x TSLA(5)  — capital plays no role
        address[11] memory voters;
        uint8[11] memory picks = [2, 2, 2, 2, 2, 0, 0, 0, 3, 3, 5];
        for (uint256 i; i < 11; ++i) {
            voters[i] = makeAddr(string.concat("voter", vm.toString(i)));
            _fund(voters[i], 1e18);
            _vote(voters[i], id, picks[i]);
        }
        vm.warp(block.timestamp + 5 days + 1);
        _freshenOracles();
        vm.warp(block.timestamp + 2 days); // grace: no attested deposits
        _freshenOracles();
        hub.finalize(id);
        assertTrue(hub.getElection(id).executed, "outcome executed on finalize");
        uint16[] memory t = vault.targets();
        // NVDA 5 votes of 11 = 45% -> capped at 40%; remainder redistributed
        assertEq(t[2], 4000);
        uint256 s;
        for (uint256 i; i < t.length; ++i) s += t[i];
        assertEq(s, 10_000);
        assertGt(t[0], t[3]);
        assertEq(t[1], 0);

        // 4. rebalance with real swaps
        vault.rebalance();
        uint256 nvda = IERC20(vault.assetAt(2).token).balanceOf(address(vault));
        assertGt(nvda, 0, "bought real NVDA stock token");
        uint256 nav = vault.totalAssets();
        assertApproxEqRel(nav, 49_850e6, 0.01e18, "NAV preserved within swap fees");
        assertLt(vault.idleUsdg(), nav * 3 / 100, "fully invested up to the cash buffer");

        // 5. flywheel: vault fees buy WIF on Uniswap v4 and burn it
        uint256 supply = IERC20(Config.WIF).totalSupply();
        vm.warp(block.timestamp + 2 hours);
        _freshenOracles();
        uint256 burned = vault.buybackAndBurn(1);
        assertGt(burned, 0);
        assertEq(IERC20(Config.WIF).totalSupply(), supply - burned);
        assertEq(vault.pendingFees(), 0);
        emit log_named_decimal_uint("WIF burned from vault fees", burned, 18);

        // 6. exit both ways
        uint256 half = shares / 2;
        vm.startPrank(user);
        uint256 out = vault.redeem(half, 1, user);
        assertApproxEqRel(out, 24_850e6, 0.02e18, "redeem to USDG");
        vault.redeemInKind(shares - half, user);
        vm.stopPrank();
        assertGt(IERC20(vault.assetAt(2).token).balanceOf(user), 0, "in-kind exit hands over real stock tokens");
        assertEq(vault.totalSupply(), 0);
    }

    function test_fork_nominate_burns_and_promotes() public onFork {
        uint256 id0 = vault.openEpoch();
        id0;
        address[3] memory b;
        for (uint256 i; i < 3; ++i) {
            b[i] = makeAddr(string.concat("backer", vm.toString(i)));
            _fund(b[i], 5e18);
            vm.startPrank(b[i]);
            IERC20(Config.WIF).approve(address(vault), type(uint256).max);
            uint256 supply = IERC20(Config.WIF).totalSupply();
            vault.nominate(6); // GOOGL
            assertEq(IERC20(Config.WIF).totalSupply(), supply - 1e18, "nomination burns WIF");
            vm.expectRevert(BasketVault.AlreadyBacked.selector);
            vault.nominate(6);
            vm.stopPrank();
        }
        vm.expectRevert(BasketVault.AlreadyListed.selector);
        vault.nominate(0);
        // fast-forward: finalize epoch 1 (nobody voted) then open epoch 2 -> GOOGL (3 backers) promoted
        vm.warp(block.timestamp + 7 days + 1);
        _freshenOracles();
        // epoch 1 backing was round 1; promotion for round happens when opening the next epoch
        vault.openEpoch();
        assertTrue(vault.assetAt(6).listed, "3 distinct backers promoted GOOGL");
        assertEq(hub.getElection(vault.epochInfo(2).electionId).optionCount, 7);
    }

    function test_fork_redeem_in_kind_works_with_dead_oracles() public onFork {
        vm.startPrank(user);
        IERC20(Config.USDG).approve(address(vault), type(uint256).max);
        uint256 shares = vault.deposit(10_000e6, 0, user);
        vm.stopPrank();
        address nvda = vault.assetAt(2).token;
        deal(nvda, address(vault), 10e18); // basket holds NVDA
        vm.warp(block.timestamp + 30 days); // every oracle is now stale
        vm.expectRevert(abi.encodeWithSelector(BasketVault.StaleOracle.selector, nvda));
        vault.totalAssets();
        vm.startPrank(user);
        IERC20(Config.USDG).approve(address(vault), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(BasketVault.StaleOracle.selector, nvda));
        vault.deposit(100e6, 0, user); // deposits fail closed
        vault.redeemInKind(shares, user); // exits never do
        vm.stopPrank();
        assertEq(IERC20(nvda).balanceOf(user), 10e18);
        assertApproxEqAbs(IERC20(Config.USDG).balanceOf(user), 100_000e6 - 10_000e6 + 9_970e6, 1);
    }
}
