// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Test/devnet helper: swapped in with anvil_setCode over a real Chainlink feed address so a
///         time-warped local run keeps oracles "fresh". Answer lives in slot 0. Never deployed anywhere real.
contract MockFeed {
    int256 public answer;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
}
