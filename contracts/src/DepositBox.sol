// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IWIF} from "./interfaces/IWIF.sol";

/// @notice Per-(election, option) deposit address. Voters "just send 1 WIF" to it: no wallet connect,
///         nothing to sign. Anyone may later `sweep` through the hub, which burns the balance.
/// @dev Deployed as an EIP-1167 clone at a CREATE2 address, so the address is known (and shown in the
///      UI/QR) before the contract exists. Immutables live in the implementation and are shared by clones.
contract DepositBox {
    address public immutable hub;
    IWIF public immutable wif;

    error OnlyHub();

    constructor(address hub_, address wif_) {
        hub = hub_;
        wif = IWIF(wif_);
    }

    /// @notice Burn everything held. Hub-only so burn totals are attributed to the right election.
    function burnAll() external returns (uint256 amount) {
        if (msg.sender != hub) revert OnlyHub();
        amount = wif.balanceOf(address(this));
        if (amount > 0) wif.burn(amount);
    }
}
