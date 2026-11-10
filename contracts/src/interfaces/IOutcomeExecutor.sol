// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice An onchain action bound to an election. Called once by the Flatland hub when the
///         election is finalized. Executors MUST check `msg.sender == flatland` and that the
///         election id is the one they expect. A revert never blocks finalization.
interface IOutcomeExecutor {
    /// @param id      election id
    /// @param winner  winning option index (lowest index wins ties)
    /// @param tally   final per-option vote counts (1 wallet = 1 vote, after sybil collapse)
    function onFinalize(uint256 id, uint8 winner, uint256[] calldata tally) external;
}
