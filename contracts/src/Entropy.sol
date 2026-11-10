// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IEntropy} from "./interfaces/IEntropy.sol";

interface IArbSys {
    function arbBlockNumber() external view returns (uint256);
    function arbBlockHash(uint256 arbBlockNum) external view returns (bytes32);
}

/// @notice Production entropy on Arbitrum-Nitro chains (Robinhood Chain, chain id 4663).
///         Uses the ArbSys precompile at 0x64 so we hash *L2* blocks.
/// @dev TRUST NOTE: L2 block hashes are produced by the (centralised) sequencer. The draw is
///      verifiable and un-grindable by voters/creator (the voter set is frozen on-chain before
///      the draw block is chosen) but the sequencer could in theory bias it. Documented in README.
contract ArbEntropy is IEntropy {
    IArbSys internal constant ARBSYS = IArbSys(address(0x64));

    function currentBlock() external view returns (uint256) {
        return ARBSYS.arbBlockNumber();
    }

    function hashOf(uint256 n) external view returns (bytes32) {
        uint256 cur = ARBSYS.arbBlockNumber();
        if (n >= cur || cur - n > 256) return bytes32(0);
        return ARBSYS.arbBlockHash(n);
    }
}

/// @notice Entropy for anvil / tests / non-Arbitrum chains.
contract LocalEntropy is IEntropy {
    function currentBlock() external view returns (uint256) {
        return block.number;
    }

    function hashOf(uint256 n) external view returns (bytes32) {
        if (n >= block.number || block.number - n > 256) return bytes32(0);
        bytes32 h = blockhash(n);
        // anvil forking an Arbitrum chain reports an L1-estimate block.number whose blockhash() is empty;
        // fall back to a deterministic devnet value so local end-to-end runs work. NEVER deployed to mainnet.
        return h == bytes32(0) ? keccak256(abi.encode("flatland-local-entropy", n, block.chainid)) : h;
    }
}
