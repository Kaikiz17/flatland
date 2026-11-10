// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice $WIF is a plain OpenZeppelin ERC20Burnable: `burn` / `burnFrom` are real burns
///         (totalSupply decreases). Everything in Flatland that "burns" uses these.
interface IWIF is IERC20 {
    function burn(uint256 value) external;
    function burnFrom(address account, uint256 value) external;
}
