// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {BasketVault} from "../src/basket/BasketVault.sol";

/// @notice Robinhood Chain mainnet (4663) constants + the vetted Stock Token registry for the People's Basket.
/// Every entry: canonical Robinhood Stock Token (docs.robinhood.com/chain/contracts) + its Chainlink USD feed proxy
/// (docs.robinhood.com/chain/oracles-and-price-feeds) + the Uniswap v3 TOKEN/USDG fee tier with the deepest liquidity
/// (>$100k USDG TVL, measured on-chain). Thin-liquidity tokens (PLTR, COIN, MSTR) and tokens without a USDG pool (ORCL)
/// are deliberately left out of this release.
library Config {
    address internal constant WIF = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant ROUTER02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address internal constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function assets() internal pure returns (BasketVault.AssetCfg[] memory a) {
        a = new BasketVault.AssetCfg[](11);
        // listed on the first ballot
        a[0] = _c(0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, 0x319724394D3A0e3669269846abE664Cd621f9f6A, 500, true, "SPY");
        a[1] = _c(0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, 0x80901d846d5D7B030F26B480776EE3b29374C2ae, 500, true, "QQQ");
        a[2] = _c(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, 500, true, "NVDA");
        a[3] = _c(0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, 500, true, "AAPL");
        a[4] = _c(0xe93237C50D904957Cf27E7B1133b510C669c2e74, 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E, 3000, true, "MSFT");
        a[5] = _c(0x322F0929c4625eD5bAd873c95208D54E1c003b2d, 0x4A1166a659A55625345e9515b32adECea5547C38, 3000, true, "TSLA");
        // nominatable: burn 1 WIF to back; enough distinct backers promote them to the ballot
        a[6] = _c(0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, 0xF6f373a037c30F0e5010d854385cA89185AE638b, 500, false, "GOOGL");
        a[7] = _c(0x12f190a9F9d7D37a250758b26824B97CE941bF54, 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C, 3000, false, "AMZN");
        a[8] = _c(0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, 0x7C38C00C30BEe9378381E7B6135d7283356D71b1, 3000, false, "META");
        a[9] = _c(0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, 0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72, 3000, false, "AMD");
        a[10] = _c(0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5, 0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a, 3000, false, "CRCL");
    }

    function _c(address t, address f, uint24 fee, bool listed, string memory sym)
        private
        pure
        returns (BasketVault.AssetCfg memory)
    {
        return BasketVault.AssetCfg(t, f, fee, listed, sym);
    }
}
