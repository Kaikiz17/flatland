// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Flatland} from "./Flatland.sol";

/// @title PrizeRules - add-on prize contract for Flatland elections (NOT part of the deployed stack).
/// @notice The election creator funds a $WIF prize split across: the first voter, the last voter, "lucky voter" spots
///         (voter position N gets X $WIF; several allowed) and R random draw winners.
///         Voter order is the hub's on-chain order: chain voters in vote order (`voterAt`), then deposit-path entries
///         (Merkle order), so deposit-path votes count once the tallier has recorded them.
/// @dev No hub change. The hub has no vote hook, so "paid the moment the Nth vote lands" is done with an instant,
///      permissionless trigger: `payLucky(id, slot)` reads `hub.voterAt` and pays the voter in that call (the tallier/bot
///      fires it within a minute of the vote). For deposit-path voters (known only after the tallier submits the deposit
///      root) use `claim` with the Merkle proof. Lucky numbers and amounts are set at creation, cannot change, and are
///      readable on-chain (`getLucky`); the UI only shows "N hidden spots". Prizes always go to the voter address,
///      whoever submits the call. Not deployed; the owner decides.
contract PrizeRules is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        First,
        Last,
        Lucky,
        Random
    }

    struct Prize {
        address creator;
        uint128 first;
        uint128 last;
        uint128 randomPool;
        uint32 luckyCount;
        uint32 randomSlots;
        bool settled;
        bool reclaimed;
        uint64 settledAt;
        uint64 drawBlock;
        uint32 total;
        bytes32 seed;
        uint256 funded;
        uint256 paid;
        uint128 randomEach; // set at settle
    }

    uint32 public constant MAX_LUCKY = 20;
    uint32 public constant MAX_RANDOM = 50;
    uint64 public constant CLAIM_WINDOW = 30 days;
    uint64 public constant DRAW_DELAY = 10;

    Flatland public immutable hub;
    IERC20 public immutable WIF;

    mapping(uint256 => Prize) internal _p;
    mapping(uint256 => uint256[]) internal _luckyN; // 1-based voter positions
    mapping(uint256 => uint128[]) internal _luckyA; // amount per spot
    mapping(uint256 => mapping(uint8 => mapping(uint256 => bool))) public claimed;

    event PrizeCreated(uint256 indexed id, address creator, uint256 funded, uint32 luckySpots);
    event Settled(uint256 indexed id, uint32 total, uint64 drawBlock);
    event Seeded(uint256 indexed id, bytes32 seed);
    event Claimed(uint256 indexed id, Kind kind, uint256 slot, address voter, uint256 amount);
    event LuckyHit(uint256 indexed id, uint256 slot, uint256 position, address voter, uint256 amount);
    event Reclaimed(uint256 indexed id, uint256 amount);

    error NotCreator();
    error NotOpen();
    error Exists();
    error BadParams();
    error NoPrize();
    error TooEarly();
    error TooLate();
    error NotSettled();
    error NotSeeded();
    error AlreadyClaimed();
    error NotWinner();
    error BadProof();
    error NothingToReclaim();

    constructor(Flatland hub_) {
        hub = hub_;
        WIF = IERC20(address(hub_.WIF()));
    }

    /// @notice Fund a prize for election `id` before voting ends. Only the election's creator. Locked once created.
    /// @param luckyPositions 1-based voter positions (unique, >= 1) and `luckyAmounts` the $WIF each pays.
    function create(
        uint256 id,
        uint128 firstPrize,
        uint128 lastPrize,
        uint256[] calldata luckyPositions,
        uint128[] calldata luckyAmounts,
        uint128 randomPool,
        uint32 randomSlots
    ) external nonReentrant {
        Flatland.Election memory e = hub.getElection(id);
        if (e.creator != msg.sender) revert NotCreator();
        if (e.status != Flatland.Status.Open || block.timestamp >= e.end) revert NotOpen();
        Prize storage p = _p[id];
        if (p.creator != address(0)) revert Exists();
        uint256 nl = luckyPositions.length;
        if (nl != luckyAmounts.length || nl > MAX_LUCKY || randomSlots > MAX_RANDOM) revert BadParams();
        if ((randomSlots == 0) != (randomPool == 0)) revert BadParams();
        uint256 total = uint256(firstPrize) + lastPrize + randomPool;
        for (uint256 i; i < nl; ++i) {
            if (luckyPositions[i] == 0 || luckyAmounts[i] == 0) revert BadParams();
            for (uint256 j; j < i; ++j) {
                if (luckyPositions[j] == luckyPositions[i]) revert BadParams();
            }
            _luckyN[id].push(luckyPositions[i]);
            _luckyA[id].push(luckyAmounts[i]);
            total += luckyAmounts[i];
        }
        if (total == 0) revert BadParams();
        p.creator = msg.sender;
        p.first = firstPrize;
        p.last = lastPrize;
        p.luckyCount = uint32(nl);
        p.randomPool = randomPool;
        p.randomSlots = randomSlots;
        p.funded = total;
        WIF.safeTransferFrom(msg.sender, address(this), total);
        emit PrizeCreated(id, msg.sender, total, uint32(nl));
    }

    /// @notice Lock the voter count once the hub election is finalized and start the random draw. Anyone can call.
    function settle(uint256 id) external {
        Prize storage p = _p[id];
        if (p.creator == address(0)) revert NoPrize();
        if (p.settled) revert NotOpen();
        if (hub.getElection(id).status != Flatland.Status.Finalized) revert TooEarly();
        uint32 total = uint32(hub.totalEntries(id));
        p.settled = true;
        p.settledAt = uint64(block.timestamp);
        p.total = total;
        p.randomEach = p.randomSlots == 0 ? 0 : uint128(uint256(p.randomPool) / p.randomSlots);
        if (total > 0 && p.randomSlots > 0) p.drawBlock = uint64(hub.entropy().currentBlock() + DRAW_DELAY);
        emit Settled(id, total, p.drawBlock);
    }

    /// @notice Seed the random draw from the future block hash picked at settle.
    function seed(uint256 id) external {
        Prize storage p = _p[id];
        if (!p.settled || p.drawBlock == 0 || p.seed != bytes32(0)) revert NotSettled();
        bytes32 h = hub.entropy().hashOf(p.drawBlock);
        if (h == bytes32(0)) revert TooEarly();
        p.seed = keccak256(abi.encode(h, id, p.total, hub.getElection(id).depositRoot, address(this)));
        emit Seeded(id, p.seed);
    }

    /// @notice If nobody seeded within the entropy window, pick a fresh future block.
    function rearm(uint256 id) external {
        Prize storage p = _p[id];
        if (!p.settled || p.drawBlock == 0 || p.seed != bytes32(0)) revert NotSettled();
        if (hub.entropy().currentBlock() <= p.drawBlock || hub.entropy().hashOf(p.drawBlock) != bytes32(0)) revert TooEarly();
        p.drawBlock = uint64(hub.entropy().currentBlock() + DRAW_DELAY);
    }

    /// @notice Instant trigger for a chain voter: pays lucky spot `slot` to whoever holds that position right now.
    ///         Reverts until the Nth vote has been recorded on-chain.
    function payLucky(uint256 id, uint256 slot) external nonReentrant {
        Prize storage p = _p[id];
        if (p.creator == address(0)) revert NoPrize();
        if (slot >= p.luckyCount) revert NotWinner();
        uint256 pos = _luckyN[id][slot];
        if (pos > hub.voterCount(id)) revert TooEarly();
        _payLucky(id, p, slot, pos, hub.voterAt(id, pos - 1));
    }

    function _payLucky(uint256 id, Prize storage p, uint256 slot, uint256 pos, address voter) internal {
        if (claimed[id][uint8(Kind.Lucky)][slot]) revert AlreadyClaimed();
        if (p.settled && block.timestamp > p.settledAt + CLAIM_WINDOW) revert TooLate();
        claimed[id][uint8(Kind.Lucky)][slot] = true;
        uint256 amt = _luckyA[id][slot];
        p.paid += amt;
        WIF.safeTransfer(voter, amt);
        emit LuckyHit(id, slot, pos, voter, amt);
        emit Claimed(id, Kind.Lucky, slot, voter, amt);
    }

    /// @notice Voter index a given prize key resolves to (reverts if not yet resolvable or forfeited).
    function indexOf(uint256 id, Kind kind, uint256 slot) public view returns (uint256) {
        Prize storage p = _p[id];
        if (p.creator == address(0)) revert NoPrize();
        if (kind == Kind.First) {
            if (slot != 0 || p.first == 0) revert NotWinner();
            return 0;
        }
        if (kind == Kind.Lucky) {
            if (slot >= p.luckyCount) revert NotWinner();
            return _luckyN[id][slot] - 1;
        }
        if (!p.settled) revert NotSettled();
        uint256 total = p.total;
        if (total == 0) revert NotWinner();
        if (kind == Kind.Last) {
            if (slot != 0 || p.last == 0) revert NotWinner();
            return total - 1;
        }
        if (slot >= p.randomSlots || p.randomEach == 0) revert NotWinner();
        if (p.seed == bytes32(0)) revert NotSeeded();
        return uint256(keccak256(abi.encode(p.seed, slot))) % total;
    }

    function amountOf(uint256 id, Kind kind, uint256 slot) public view returns (uint256) {
        Prize storage p = _p[id];
        if (kind == Kind.First) return p.first;
        if (kind == Kind.Last) return p.last;
        if (kind == Kind.Lucky) return slot < p.luckyCount ? _luckyA[id][slot] : 0;
        return p.randomEach;
    }

    /// @notice Pay a prize to `voter` if (kind, slot) resolves to `index` and `voter` holds that entry (Merkle proof for
    ///         deposit-path entries). First and lucky prizes work as soon as the position exists; last and random after settle.
    function claim(uint256 id, Kind kind, uint256 slot, uint256 index, address voter, uint8 option, bytes32[] calldata proof)
        external
        nonReentrant
    {
        Prize storage p = _p[id];
        if (indexOf(id, kind, slot) != index) revert NotWinner();
        if (!hub.isEntry(id, index, voter, option, proof)) revert BadProof();
        if (kind == Kind.Lucky) {
            _payLucky(id, p, slot, index + 1, voter);
            return;
        }
        if (claimed[id][uint8(kind)][slot]) revert AlreadyClaimed();
        if (p.settled && block.timestamp > p.settledAt + CLAIM_WINDOW) revert TooLate();
        claimed[id][uint8(kind)][slot] = true;
        uint256 amt = amountOf(id, kind, slot);
        p.paid += amt;
        WIF.safeTransfer(voter, amt);
        emit Claimed(id, kind, slot, voter, amt);
    }

    /// @notice Creator takes back everything unclaimed: after the claim window, or immediately when there were no voters.
    function reclaim(uint256 id) external nonReentrant {
        Prize storage p = _p[id];
        if (!p.settled) revert NotSettled();
        if (msg.sender != p.creator) revert NotCreator();
        if (p.reclaimed) revert NothingToReclaim();
        if (p.total != 0 && block.timestamp <= p.settledAt + CLAIM_WINDOW) revert TooEarly();
        p.reclaimed = true;
        uint256 left = p.funded - p.paid;
        if (left == 0) revert NothingToReclaim();
        p.paid = p.funded;
        WIF.safeTransfer(p.creator, left);
        emit Reclaimed(id, left);
    }

    function getPrize(uint256 id) external view returns (Prize memory) {
        return _p[id];
    }

    /// @dev Public on-chain by design (the UI only shows the count).
    function getLucky(uint256 id) external view returns (uint256[] memory positions, uint128[] memory amounts) {
        return (_luckyN[id], _luckyA[id]);
    }
}
