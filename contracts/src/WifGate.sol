// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IWIF} from "./interfaces/IWIF.sol";
import {Standing} from "./Standing.sol";

/// @title WifGate — the reusable "burn 1 $WIF to act" rail.
/// @notice One tiny primitive for petitions, RSVPs (with seat caps), allowlists and access gates.
///         Any app (onchain or offchain) plugs in by creating a gate and reading `hasActed(id, wallet)`.
///         Each act burns >= `cost` WIF for real. 1 wallet = 1 act per gate, so it is sybil-priced and
///         anti-spam without a custodian, a token-balance snapshot, or an off-chain list.
contract WifGate is ReentrancyGuard {
    enum Kind {
        PETITION,
        RSVP,
        ALLOWLIST,
        ACCESS
    }

    struct Gate {
        address creator;
        Kind kind;
        uint64 start;
        uint64 end; // 0 = no end
        uint128 cost;
        uint32 cap; // 0 = unlimited; RSVP seat limit etc.
        uint32 count;
        uint256 burned;
        bytes32 metaHash;
    }

    uint256 public constant MIN_COST = 1e18;

    IWIF public immutable WIF;
    Standing public immutable standing;

    uint256 public gateCount;
    uint256 public totalActs;
    uint256 public totalBurned;
    mapping(uint256 => Gate) internal _gates;
    mapping(uint256 => mapping(address => uint32)) internal _seq; // 1-based order in which wallet acted
    mapping(uint256 => address[]) internal _actors;

    event GateCreated(uint256 indexed id, address indexed creator, Kind kind, string title, string metaURI, uint64 start, uint64 end, uint128 cost, uint32 cap);
    event Acted(uint256 indexed id, address indexed who, uint32 position, uint256 burned);

    error BadParams();
    error Closed();
    error Already();
    error Full();
    error NoGate();

    constructor(address wif, address standing_) {
        WIF = IWIF(wif);
        standing = Standing(standing_);
    }

    function createGate(Kind kind, string calldata title, string calldata metaURI, uint64 start, uint64 end, uint128 cost, uint32 cap)
        external
        returns (uint256 id)
    {
        if (cost < MIN_COST) revert BadParams();
        if (start == 0) start = uint64(block.timestamp);
        if (end != 0 && end <= start) revert BadParams();
        id = ++gateCount;
        _gates[id] = Gate(msg.sender, kind, start, end, cost, cap, 0, 0, keccak256(abi.encode(title, metaURI)));
        emit GateCreated(id, msg.sender, kind, title, metaURI, start, end, cost, cap);
    }

    /// @notice Burn `cost` WIF (needs approval) and register this wallet. Once per wallet per gate.
    function act(uint256 id) external nonReentrant {
        Gate storage g = _gates[id];
        if (g.creator == address(0)) revert NoGate();
        if (block.timestamp < g.start || (g.end != 0 && block.timestamp >= g.end)) revert Closed();
        if (_seq[id][msg.sender] != 0) revert Already();
        if (g.cap != 0 && g.count >= g.cap) revert Full();
        _actors[id].push(msg.sender);
        uint32 pos = ++g.count;
        _seq[id][msg.sender] = pos;
        g.burned += g.cost;
        totalBurned += g.cost;
        ++totalActs;
        WIF.burnFrom(msg.sender, g.cost);
        standing.recordAct(msg.sender, block.timestamp, g.cost);
        emit Acted(id, msg.sender, pos, g.cost);
    }

    /// @notice The integration point for other apps / contracts.
    function hasActed(uint256 id, address who) external view returns (bool) {
        return _seq[id][who] != 0;
    }

    function positionOf(uint256 id, address who) external view returns (uint32) {
        return _seq[id][who];
    }

    function getGate(uint256 id) external view returns (Gate memory) {
        return _gates[id];
    }

    function actorCount(uint256 id) external view returns (uint256) {
        return _actors[id].length;
    }

    function actorAt(uint256 id, uint256 i) external view returns (address) {
        return _actors[id][i];
    }
}

/// @notice Drop-in modifier source for contracts that want to gate a function behind a WifGate act.
abstract contract WifGated {
    WifGate public immutable gateRail;

    error NotActed();

    constructor(WifGate g) {
        gateRail = g;
    }

    modifier onlyActed(uint256 gateId) {
        if (!gateRail.hasActed(gateId, msg.sender)) revert NotActed();
        _;
    }
}
