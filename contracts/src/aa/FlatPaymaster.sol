// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PackedUserOperation, IEntryPoint, IPaymaster, PostOpMode} from "./AAInterfaces.sol";
import {FlatAccount} from "./FlatAccount.sol";
import {Flatland} from "../Flatland.sol";
import {Standing} from "../Standing.sol";

/// @title FlatPaymaster — a capped, abuse-resistant gas pool for a newcomer's FIRST vote.
/// @notice Sponsors exactly one kind of UserOp: from a never-before-seen participant, a batch of at most
///         [WIF.approve(hub, x), Flatland.vote(id, option)]. Nothing else, ever.
///   Abuse resistance (no admin, no allowlist, nothing to trust):
///     * once per smart account, and only if it has no prior votes/acts in `Standing`
///     * every sponsored vote still burns >= 1 WIF from that account (a sybil farm pays in burned WIF)
///     * per-op gas-cost ceiling `MAX_COST_PER_OP` and a rolling daily budget `DAILY_BUDGET`
///     * funds can only ever pay gas (no withdraw function exists)
///   Fund it by sending ETH to `fund()` — anyone can (sponsors, communities, a share of fees).
contract FlatPaymaster is IPaymaster {
    IEntryPoint public immutable entryPoint;
    Flatland public immutable hub;
    Standing public immutable standing;
    address public immutable wif;
    uint256 public immutable MAX_COST_PER_OP;
    uint256 public immutable DAILY_BUDGET;

    mapping(address => bool) public sponsored;
    uint256 public dayIndex;
    uint256 public spentToday;
    uint256 public totalSponsoredOps;

    event Funded(address indexed from, uint256 amount);
    event Sponsored(address indexed account, uint256 gasCost);

    error OnlyEntryPoint();
    error NotAllowed(string why);

    constructor(IEntryPoint ep, Flatland hub_, Standing standing_, uint256 maxCostPerOp, uint256 dailyBudget) {
        entryPoint = ep;
        hub = hub_;
        standing = standing_;
        wif = address(hub_.WIF());
        MAX_COST_PER_OP = maxCostPerOp;
        DAILY_BUDGET = dailyBudget;
    }

    function fund() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Funded(msg.sender, msg.value);
    }

    receive() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Paymasters in ERC-4337 must stake to be accepted by public bundlers. Anyone can add stake.
    function addStake(uint32 unstakeDelaySec) external payable {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    function budgetLeft() public view returns (uint256) {
        if (block.timestamp / 1 days != dayIndex) return DAILY_BUDGET;
        return DAILY_BUDGET > spentToday ? DAILY_BUDGET - spentToday : 0;
    }

    function validatePaymasterUserOp(PackedUserOperation calldata op, bytes32, uint256 maxCost)
        external
        returns (bytes memory context, uint256 validationData)
    {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        if (maxCost > MAX_COST_PER_OP) revert NotAllowed("op too expensive");
        if (maxCost > budgetLeft()) revert NotAllowed("daily budget spent");
        address sender = op.sender;
        if (sponsored[sender]) revert NotAllowed("already sponsored once");
        if (standing.votesOf(sender) != 0 || standing.record(sender).acts != 0) revert NotAllowed("not a newcomer");
        _checkCall(op.callData);

        // reserve against the daily budget now so a single bundle can't overshoot
        uint256 d = block.timestamp / 1 days;
        if (d != dayIndex) {
            dayIndex = d;
            spentToday = 0;
        }
        spentToday += maxCost;
        sponsored[sender] = true;
        context = abi.encode(sender, maxCost);
        validationData = 0;
    }

    function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost, uint256) external {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        (address sender, uint256 reserved) = abi.decode(context, (address, uint256));
        // refund the unused part of the daily reservation
        if (reserved > actualGasCost && spentToday >= reserved - actualGasCost) spentToday -= reserved - actualGasCost;
        if (mode == PostOpMode.opReverted) sponsored[sender] = false; // their vote did not happen: allow one retry
        else ++totalSponsoredOps;
        emit Sponsored(sender, actualGasCost);
    }

    /// @dev Only `executeBatch([wif, hub], [0, 0], [approve(hub,_), vote(_,_)])` or `execute(hub, 0, vote(_,_))`.
    function _checkCall(bytes calldata cd) internal view {
        bytes4 sel = bytes4(cd[:4]);
        if (sel == FlatAccount.execute.selector) {
            (address dest, uint256 value, bytes memory data) = abi.decode(cd[4:], (address, uint256, bytes));
            if (value != 0 || dest != address(hub) || !_isVote(data)) revert NotAllowed("only vote()");
        } else if (sel == FlatAccount.executeBatch.selector) {
            (address[] memory dest, uint256[] memory value, bytes[] memory data) =
                abi.decode(cd[4:], (address[], uint256[], bytes[]));
            if (dest.length != 2 || value.length != 2 || data.length != 2) revert NotAllowed("batch shape");
            if (value[0] != 0 || value[1] != 0) revert NotAllowed("no value");
            if (dest[0] != wif || !_isApproveHub(data[0])) revert NotAllowed("first call must be approve(hub)");
            if (dest[1] != address(hub) || !_isVote(data[1])) revert NotAllowed("second call must be vote()");
        } else {
            revert NotAllowed("unsupported call");
        }
    }

    function _isVote(bytes memory data) internal pure returns (bool) {
        if (data.length != 4 + 64) return false;
        bytes4 s;
        assembly {
            s := mload(add(data, 32))
        }
        return s == Flatland.vote.selector;
    }

    function _isApproveHub(bytes memory data) internal view returns (bool) {
        if (data.length != 4 + 64) return false;
        bytes4 s;
        address spender;
        assembly {
            s := mload(add(data, 32))
            spender := mload(add(data, 36))
        }
        return s == bytes4(keccak256("approve(address,uint256)")) && spender == address(hub);
    }
}
