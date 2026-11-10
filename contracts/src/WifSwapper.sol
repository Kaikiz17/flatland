// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "./interfaces/IDex.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title WifSwapper — stateless "send ETH, receive $WIF" helper over the canonical v4 native-ETH/WIF pool.
/// @notice Same pool and swap path WifBuyback uses (PoolManager.unlock). Reverts unless `minWifOut` WIF is delivered to the caller.
///         Holds nothing between calls; any ETH or WIF sent here by mistake is NOT recoverable except via `rescue*` (anyone may route it to `rescueTo`).
contract WifSwapper {
    address public constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address public constant WIF = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    address public constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    bytes32 public constant WIF_POOL_ID = 0x71ef4106340f0a3b9c19ec994eef4fc44a1d2513f38faac39d7636b156548c79;
    uint160 internal constant MIN_SQRT_PRICE_PLUS_1 = 4295128740;

    error Slippage();
    error NotPoolManager();
    error BadPool();

    constructor() {
        if (keccak256(abi.encode(_key())) != WIF_POOL_ID) revert BadPool();
    }

    function _key() internal pure returns (IPoolManager.PoolKey memory) {
        return IPoolManager.PoolKey(address(0), WIF, 0, 200, MEME_HOOK);
    }

    function swapEthForWif(uint256 minWifOut) external payable returns (uint256 wifOut) {
        bytes memory r = IPoolManager(POOL_MANAGER).unlock(abi.encode(msg.value, msg.sender));
        wifOut = abi.decode(r, (uint256));
        if (wifOut < minWifOut || wifOut == 0) revert Slippage();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != POOL_MANAGER) revert NotPoolManager();
        (uint256 ethIn, address to) = abi.decode(data, (uint256, address));
        IPoolManager.PoolKey memory k = _key();
        int256 d = IPoolManager(POOL_MANAGER).swap(k, IPoolManager.SwapParams(true, -int256(ethIn), MIN_SQRT_PRICE_PLUS_1), "");
        int128 a0 = int128(d >> 128);
        int128 a1 = int128(d);
        if (a0 >= 0 || a1 <= 0) revert Slippage();
        IPoolManager(POOL_MANAGER).settle{value: uint128(-a0)}();
        IPoolManager(POOL_MANAGER).take(WIF, to, uint128(a1));
        // any unspent ETH (exact-in swap should consume all) goes back to the caller
        if (address(this).balance > 0) {
            (bool ok,) = to.call{value: address(this).balance}("");
            require(ok);
        }
        return abi.encode(uint256(uint128(a1)));
    }

    receive() external payable {}
}
