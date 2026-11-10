// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {PackedUserOperation, IEntryPoint} from "./AAInterfaces.sol";

/// @notice Minimal single-owner ERC-4337 account so a newcomer can cast their first vote with ZERO ETH.
/// The address is counterfactual (known before deployment) so people can receive WIF there first.
contract FlatAccount {
    IEntryPoint public immutable entryPoint;
    address public immutable owner;

    error NotAuthorized();
    error BadLen();

    constructor(IEntryPoint ep, address owner_) {
        entryPoint = ep;
        owner = owner_;
    }

    modifier onlySelfOrEP() {
        if (msg.sender != address(entryPoint) && msg.sender != owner) revert NotAuthorized();
        _;
    }

    function validateUserOp(PackedUserOperation calldata op, bytes32 userOpHash, uint256 missingFunds)
        external
        returns (uint256 validationData)
    {
        if (msg.sender != address(entryPoint)) revert NotAuthorized();
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(userOpHash), op.signature);
        validationData = signer == owner ? 0 : 1;
        if (missingFunds > 0) {
            (bool ok,) = payable(msg.sender).call{value: missingFunds}("");
            ok;
        }
    }

    function execute(address dest, uint256 value, bytes calldata data) external onlySelfOrEP {
        _call(dest, value, data);
    }

    function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata data) external onlySelfOrEP {
        if (dest.length != data.length || dest.length != value.length) revert BadLen();
        for (uint256 i; i < dest.length; ++i) _call(dest[i], value[i], data[i]);
    }

    function _call(address dest, uint256 value, bytes calldata data) internal {
        (bool ok, bytes memory ret) = dest.call{value: value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    receive() external payable {}
}

contract FlatAccountFactory {
    IEntryPoint public immutable entryPoint;

    constructor(IEntryPoint ep) {
        entryPoint = ep;
    }

    function createAccount(address owner, uint256 salt) external returns (FlatAccount acc) {
        address a = getAddress(owner, salt);
        if (a.code.length > 0) return FlatAccount(payable(a));
        acc = new FlatAccount{salt: bytes32(salt)}(entryPoint, owner);
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        return Create2.computeAddress(
            bytes32(salt), keccak256(abi.encodePacked(type(FlatAccount).creationCode, abi.encode(entryPoint, owner)))
        );
    }
}
