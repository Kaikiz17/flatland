// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Flatland} from "../src/Flatland.sol";
import {Standing} from "../src/Standing.sol";
import {WifGate} from "../src/WifGate.sol";
import {LocalEntropy} from "../src/Entropy.sol";
import {IWIF} from "../src/interfaces/IWIF.sol";

/// Same shape as the real $WIF (OZ ERC20 + ERC20Burnable, 18 decimals).
contract MockWIF is ERC20, ERC20Burnable {
    constructor() ERC20("World is Flat", "WIF") {}

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }
}

abstract contract Base is Test {
    IWIF wif;
    Flatland hub;
    Standing standing;
    WifGate gate;
    LocalEntropy entropy;

    address tallier = makeAddr("tallier");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");

    function _deployCore(address wifAddr) internal {
        wif = IWIF(wifAddr);
        standing = new Standing();
        entropy = new LocalEntropy();
        hub = new Flatland(wifAddr, address(entropy), address(standing), tallier);
        gate = new WifGate(wifAddr, address(standing));
    }

    function _lock(address[] memory extra) internal {
        address[] memory w = new address[](2 + extra.length);
        w[0] = address(hub);
        w[1] = address(gate);
        for (uint256 i; i < extra.length; ++i) w[2 + i] = extra[i];
        standing.setWriters(w);
    }

    function _fund(address who, uint256 amt) internal virtual;

    function _opts(uint256 n) internal pure returns (string[] memory o) {
        o = new string[](n);
        for (uint256 i; i < n; ++i) o[i] = string(abi.encodePacked("Option ", bytes1(uint8(65 + i))));
    }

    function _params(address tal, address exec, uint32 winners) internal view returns (Flatland.Params memory p) {
        p.title = "Who is the GOAT?";
        p.options = _opts(3);
        p.metaURI = "ipfs://meta";
        p.start = 0;
        p.end = uint64(block.timestamp + 1 days);
        p.voteCost = 1e18;
        p.tallier = tal;
        p.executor = exec;
        p.challengeWindow = 6 hours;
        p.winners = winners;
        p.prizeToken = winners > 0 ? address(wif) : address(0);
    }

    function _vote(address who, uint256 id, uint8 opt) internal {
        vm.startPrank(who);
        wif.approve(address(hub), type(uint256).max);
        hub.vote(id, opt);
        vm.stopPrank();
    }

    /// @dev Merkle helpers for tiny trees (1..4 leaves), OZ sorted-pair hashing.
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _tree2(bytes32 l0, bytes32 l1) internal pure returns (bytes32 root) {
        root = _hashPair(l0, l1);
    }
}
