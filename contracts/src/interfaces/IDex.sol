// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Uniswap v3 SwapRouter02 (V3-only entry) — deployed on Robinhood Chain at 0xCaf681a66D020601342297493863E78C959E5cb2
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IWETH9 {
    function withdraw(uint256) external;
    function deposit() external payable;
}

/// Minimal Uniswap v4 PoolManager surface (0x8366a39CC670B4001A1121B8F6A443A643e40951 on Robinhood Chain).
interface IPoolManager {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 delta);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

interface IStockToken {
    function oraclePaused() external view returns (bool);
    function uiMultiplier() external view returns (uint256);
}
