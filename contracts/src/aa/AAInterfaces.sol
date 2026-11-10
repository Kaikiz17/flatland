// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// ERC-4337 v0.7 types (EntryPoint canonical at 0x0000000071727De22E5E9d8BAf0edAc6f37da032, live on Robinhood Chain).
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits; // verificationGasLimit(16) | callGasLimit(16)
    uint256 preVerificationGas;
    bytes32 gasFees; // maxPriorityFeePerGas(16) | maxFeePerGas(16)
    bytes paymasterAndData; // paymaster(20) | verificationGasLimit(16) | postOpGasLimit(16) | data
    bytes signature;
}

interface IEntryPoint {
    function handleOps(PackedUserOperation[] calldata ops, address payable beneficiary) external;
    function getUserOpHash(PackedUserOperation calldata op) external view returns (bytes32);
    function depositTo(address account) external payable;
    function balanceOf(address account) external view returns (uint256);
    function addStake(uint32 unstakeDelaySec) external payable;
    function getNonce(address sender, uint192 key) external view returns (uint256);
}

enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}

interface IPaymaster {
    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
        external
        returns (bytes memory context, uint256 validationData);

    function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256 actualUserOpFeePerGas) external;
}
