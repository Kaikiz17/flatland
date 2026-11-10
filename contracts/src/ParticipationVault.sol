// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Flatland} from "./Flatland.sol";

/// @title ParticipationVault — pots that UNLOCK when enough people vote, then pay every voter equally.
/// @notice Sponsors lock any ERC-20 against an election with a participation goal (e.g. "1,000 voters").
///         If the finalized election reaches the goal the pot unlocks and is split equally between ALL counted
///         voters, whatever they picked (World is Fair "everyone gets an entry" ethos). If it misses the goal the
///         sponsor takes the pot back. Nobody can drain it in between: no admin, no owner.
contract ParticipationVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Pot {
        address sponsor;
        IERC20 token;
        uint256 amount;
        uint32 goal; // minimum counted voters
        uint32 claims;
        bool refunded;
    }

    Flatland public immutable hub;
    mapping(uint256 => Pot[]) internal _pots;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public claimed; // id => pot => voter

    event PotLocked(uint256 indexed id, uint256 indexed pot, address indexed sponsor, address token, uint256 amount, uint32 goal);
    event PotClaimed(uint256 indexed id, uint256 indexed pot, address indexed voter, uint256 amount);
    event PotRefunded(uint256 indexed id, uint256 indexed pot, uint256 amount);

    error NotUnlocked();
    error Unlocked();
    error Bad();
    error Already();

    constructor(Flatland hub_) {
        hub = hub_;
    }

    function lockPot(uint256 id, IERC20 token, uint256 amount, uint32 goal) external nonReentrant returns (uint256 pot) {
        Flatland.Election memory e = hub.getElection(id);
        if (e.status != Flatland.Status.Open || goal == 0 || amount == 0) revert Bad();
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = token.balanceOf(address(this)) - before;
        pot = _pots[id].length;
        _pots[id].push(Pot(msg.sender, token, got, goal, 0, false));
        emit PotLocked(id, pot, msg.sender, address(token), got, goal);
    }

    function unlocked(uint256 id, uint256 pot) public view returns (bool) {
        Flatland.Election memory e = hub.getElection(id);
        return e.status == Flatland.Status.Finalized && hub.totalEntries(id) >= _pots[id][pot].goal;
    }

    /// @notice Claim your equal share. Anyone can trigger it for a voter; funds always go to the voter.
    function claim(uint256 id, uint256 pot, uint256 index, address voter, uint8 option, bytes32[] calldata proof)
        external
        nonReentrant
    {
        Pot storage p = _pots[id][pot];
        if (!unlocked(id, pot)) revert NotUnlocked();
        if (claimed[id][pot][voter]) revert Already();
        if (!hub.isEntry(id, index, voter, option, proof)) revert Bad();
        claimed[id][pot][voter] = true;
        ++p.claims;
        uint256 share = p.amount / hub.totalEntries(id);
        p.token.safeTransfer(voter, share);
        emit PotClaimed(id, pot, voter, share);
    }

    /// @notice Goal missed: the sponsor gets the whole pot back.
    function refund(uint256 id, uint256 pot) external nonReentrant {
        Pot storage p = _pots[id][pot];
        Flatland.Election memory e = hub.getElection(id);
        if (e.status != Flatland.Status.Finalized || unlocked(id, pot)) revert Unlocked();
        if (p.refunded) revert Already();
        p.refunded = true;
        p.token.safeTransfer(p.sponsor, p.amount);
        emit PotRefunded(id, pot, p.amount);
    }

    function potCount(uint256 id) external view returns (uint256) {
        return _pots[id].length;
    }

    function getPot(uint256 id, uint256 pot) external view returns (Pot memory) {
        return _pots[id][pot];
    }
}
