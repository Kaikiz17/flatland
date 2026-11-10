// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Block-hash source used for the verifiable future-block draw.
/// @dev On Robinhood Chain (Arbitrum Nitro) `block.number` is the *L1* estimate and
///      `blockhash` is not the L2 hash, so the production implementation reads the
///      `ArbSys` precompile. Local/anvil runs use `LocalEntropy`.
interface IEntropy {
    /// @return the current block counter in the unit `hashOf` understands.
    function currentBlock() external view returns (uint256);
    /// @return hash of block `n`, or 0 if `n` is not yet mined / older than 256 blocks.
    function hashOf(uint256 n) external view returns (bytes32);
}
