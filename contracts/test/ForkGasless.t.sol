// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Base} from "./Base.t.sol";
import {Flatland} from "../src/Flatland.sol";
import {Config} from "../script/Config.sol";
import {PackedUserOperation, IEntryPoint} from "../src/aa/AAInterfaces.sol";
import {FlatAccount, FlatAccountFactory} from "../src/aa/FlatAccount.sol";
import {FlatPaymaster} from "../src/aa/FlatPaymaster.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// Gasless first vote through the REAL ERC-4337 EntryPoint v0.7 on Robinhood Chain (this test plays the bundler).
contract ForkGaslessTest is Base {
    IEntryPoint ep = IEntryPoint(Config.ENTRY_POINT_V07);
    FlatAccountFactory factory;
    FlatPaymaster pm;
    uint256 newbieKey = 0xA11CE;
    address newbie;
    address bundler = makeAddr("bundler");

    function setUp() public {
        if (block.chainid != 4663) return;
        _deployCore(Config.WIF);
        pm = new FlatPaymaster(ep, hub, standing, 0.002 ether, 0.01 ether);
        address[] memory extra = new address[](0);
        _lock(extra);
        factory = new FlatAccountFactory(ep);
        newbie = vm.addr(newbieKey);
        vm.deal(address(this), 1 ether);
        pm.fund{value: 0.05 ether}();
    }

    function _fund(address who, uint256 amt) internal override {
        deal(Config.WIF, who, amt);
    }

    modifier onFork() {
        if (block.chainid != 4663) vm.skip(true);
        _;
    }

    function _op(uint256 key, uint256 salt, uint256 id, uint8 option, bool withInit)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        address owner = vm.addr(key);
        address acct = factory.getAddress(owner, salt);
        address[] memory dest = new address[](2);
        dest[0] = Config.WIF;
        dest[1] = address(hub);
        uint256[] memory val = new uint256[](2);
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeWithSignature("approve(address,uint256)", address(hub), type(uint256).max);
        data[1] = abi.encodeCall(Flatland.vote, (id, option));
        op.sender = acct;
        op.nonce = ep.getNonce(acct, 0);
        if (withInit) op.initCode = abi.encodePacked(address(factory), abi.encodeCall(FlatAccountFactory.createAccount, (owner, salt)));
        op.callData = abi.encodeCall(FlatAccount.executeBatch, (dest, val, data));
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(600_000), uint128(400_000)));
        op.preVerificationGas = 60_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(0.1 gwei), uint128(0.1 gwei)));
        op.paymasterAndData = abi.encodePacked(address(pm), uint128(200_000), uint128(100_000));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, MessageHashUtils.toEthSignedMessageHash(ep.getUserOpHash(op)));
        op.signature = abi.encodePacked(r, s, v);
    }

    function _run(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler);
        ep.handleOps(ops, payable(bundler));
    }

    function test_fork_newcomer_votes_with_zero_eth() public onFork {
        vm.prank(creator);
        uint256 id = hub.createElection(_params(address(0), address(0), 0));
        address acct = factory.getAddress(newbie, 1);
        deal(Config.WIF, acct, 5e18); // newcomer received WIF (e.g. airdrop/gift) at a counterfactual address
        assertEq(acct.balance, 0, "no ETH, ever");
        assertEq(acct.code.length, 0, "account not even deployed yet");
        uint256 supply = wif.totalSupply();

        _run(_op(newbieKey, 1, id, 2, true));

        assertGt(acct.code.length, 0, "account deployed by the first UserOp");
        assertEq(acct.balance, 0, "newcomer still spent no ETH");
        assertTrue(hub.hasVoted(id, acct));
        assertEq(hub.tallies(id)[2], 1);
        assertEq(wif.totalSupply(), supply - 1e18, "the sponsored vote still burned real WIF");
        assertEq(pm.totalSponsoredOps(), 1);
        assertTrue(pm.sponsored(acct));
        assertLt(pm.spentToday(), 0.002 ether);
    }

    function test_fork_second_sponsored_op_is_rejected() public onFork {
        vm.startPrank(creator);
        uint256 id1 = hub.createElection(_params(address(0), address(0), 0));
        uint256 id2 = hub.createElection(_params(address(0), address(0), 0));
        vm.stopPrank();
        address acct = factory.getAddress(newbie, 7);
        deal(Config.WIF, acct, 5e18);
        _run(_op(newbieKey, 7, id1, 0, true));
        PackedUserOperation memory again = _op(newbieKey, 7, id2, 0, false);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = again;
        vm.prank(bundler);
        vm.expectRevert(); // FailedOp: AA33 paymaster validation reverted ("not a newcomer"/"already sponsored")
        ep.handleOps(ops, payable(bundler));
    }

    function test_fork_paymaster_refuses_anything_but_vote() public onFork {
        vm.prank(creator);
        uint256 id = hub.createElection(_params(address(0), address(0), 0));
        address acct = factory.getAddress(newbie, 9);
        deal(Config.WIF, acct, 5e18);
        PackedUserOperation memory op = _op(newbieKey, 9, id, 0, true);
        // swap the batch for a WIF transfer-out (a drain attempt) and re-sign
        address[] memory dest = new address[](2);
        dest[0] = Config.WIF;
        dest[1] = Config.WIF;
        bytes[] memory data = new bytes[](2);
        data[0] = abi.encodeWithSignature("approve(address,uint256)", address(hub), 1);
        data[1] = abi.encodeWithSignature("transfer(address,uint256)", address(0xdead), 1e18);
        op.callData = abi.encodeCall(FlatAccount.executeBatch, (dest, new uint256[](2), data));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(newbieKey, MessageHashUtils.toEthSignedMessageHash(ep.getUserOpHash(op)));
        op.signature = abi.encodePacked(r, s, v);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler);
        vm.expectRevert();
        ep.handleOps(ops, payable(bundler));
    }

    function test_fork_daily_budget_caps_total_spend() public onFork {
        vm.prank(creator);
        uint256 id = hub.createElection(_params(address(0), address(0), 0));
        pm = new FlatPaymaster(ep, hub, standing, 0.002 ether, 0.0004 ether); // tiny daily budget
        pm.fund{value: 0.05 ether}();
        uint256 ok;
        for (uint256 i; i < 12; ++i) {
            uint256 k = 1000 + i;
            address acct = factory.getAddress(vm.addr(k), 1);
            deal(Config.WIF, acct, 2e18);
            PackedUserOperation[] memory ops = new PackedUserOperation[](1);
            ops[0] = _op(k, 1, id, uint8(i % 3), true);
            vm.prank(bundler);
            try ep.handleOps(ops, payable(bundler)) {
                ++ok;
            } catch {
                break;
            }
        }
        assertGt(ok, 0);
        assertLt(ok, 12, "daily budget stops the pool from being drained");
        assertLe(pm.spentToday(), 0.0004 ether);
    }
}
