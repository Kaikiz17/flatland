// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IWIF} from "./interfaces/IWIF.sol";
import {ISwapRouter02, IWETH9, IPoolManager} from "./interfaces/IDex.sol";

/// @title WifBuyback — the flywheel's engine: USDG → WETH → ETH → $WIF → burn.
/// @notice Uses the REAL liquidity on Robinhood Chain:
///   1. Uniswap v3 USDG/WETH (0.01%, deepest USDG↔ETH pool) via SwapRouter02
///   2. Uniswap v4 native-ETH/WIF canonical pool (the Pons v2 graduated pool, hook = MemeHook) via PoolManager.unlock
/// The contract is stateless and holds nothing between calls; anyone can use it as a "burn-buy" primitive.
/// @dev `minWifOut` is caller-supplied (computed off-chain from the v4 Quoter). Per-call and per-interval caps bound
///      the damage a careless/malicious caller can do with a bad `minWifOut`.
contract WifBuyback is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address public constant ROUTER02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address public constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address public constant WIF_ADDR = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    address public constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    uint24 public constant USDG_WETH_FEE = 100;
    /// poolId of the canonical ETH/WIF v4 pool (keccak256(abi.encode(key))) — asserted in the constructor.
    bytes32 public constant WIF_POOL_ID = 0x71ef4106340f0a3b9c19ec994eef4fc44a1d2513f38faac39d7636b156548c79;
    uint160 internal constant MIN_SQRT_PRICE_PLUS_1 = 4295128740;

    uint256 public immutable maxUsdgPerCall;
    uint256 public totalWifBurned;
    uint256 public totalUsdgSpent;

    event BuybackBurn(address indexed caller, uint256 usdgIn, uint256 ethMid, uint256 wifBurned);

    error Slippage();
    error TooBig();
    error NotPoolManager();
    error BadPool();

    constructor(uint256 maxUsdgPerCall_) {
        maxUsdgPerCall = maxUsdgPerCall_;
        if (keccak256(abi.encode(_key())) != WIF_POOL_ID) revert BadPool();
    }

    function _key() internal pure returns (IPoolManager.PoolKey memory) {
        return IPoolManager.PoolKey(address(0), WIF_ADDR, 0, 200, MEME_HOOK);
    }

    /// @notice Pull `usdgIn` USDG from the caller, buy WIF, burn it. Reverts unless >= `minWifOut` is burned.
    function buyAndBurn(uint256 usdgIn, uint256 minWifOut) external nonReentrant returns (uint256 wifOut) {
        if (usdgIn > maxUsdgPerCall) revert TooBig();
        IERC20(USDG).safeTransferFrom(msg.sender, address(this), usdgIn);
        IERC20(USDG).forceApprove(ROUTER02, usdgIn);
        uint256 wethOut = ISwapRouter02(ROUTER02).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(USDG, WETH, USDG_WETH_FEE, address(this), usdgIn, 0, 0)
        );
        IWETH9(WETH).withdraw(wethOut);
        bytes memory r = IPoolManager(POOL_MANAGER).unlock(abi.encode(wethOut));
        wifOut = abi.decode(r, (uint256));
        if (wifOut < minWifOut || wifOut == 0) revert Slippage();
        IWIF(WIF_ADDR).burn(wifOut);
        totalWifBurned += wifOut;
        totalUsdgSpent += usdgIn;
        emit BuybackBurn(msg.sender, usdgIn, wethOut, wifOut);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != POOL_MANAGER) revert NotPoolManager();
        uint256 ethIn = abi.decode(data, (uint256));
        IPoolManager.PoolKey memory k = _key();
        int256 d = IPoolManager(POOL_MANAGER).swap(
            k, IPoolManager.SwapParams(true, -int256(ethIn), MIN_SQRT_PRICE_PLUS_1), ""
        );
        int128 a0 = int128(d >> 128);
        int128 a1 = int128(d);
        if (a0 >= 0 || a1 <= 0) revert Slippage();
        IPoolManager(POOL_MANAGER).settle{value: uint128(-a0)}();
        IPoolManager(POOL_MANAGER).take(WIF_ADDR, address(this), uint128(a1));
        return abi.encode(uint256(uint128(a1)));
    }

    receive() external payable {}
}
