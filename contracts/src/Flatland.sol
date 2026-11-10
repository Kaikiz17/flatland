// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IWIF} from "./interfaces/IWIF.sol";
import {IEntropy} from "./interfaces/IEntropy.sol";
import {IOutcomeExecutor} from "./interfaces/IOutcomeExecutor.sol";
import {DepositBox} from "./DepositBox.sol";
import {Standing} from "./Standing.sol";

/// @title Flatland — open, permissionless 1-wallet-1-vote election protocol on the World is Fair rules.
/// @notice Rules (same as World is Fair, but anyone can run an election, and results can DO something):
///   * 1 wallet = 1 vote. Pay at least `voteCost` (default 1 $WIF); extra is burned and never adds weight.
///   * Every counted vote burns $WIF for real (`burn`/`burnFrom`, supply goes down).
///   * Two ways to vote: connect a wallet (fully onchain, `vote`) or just send $WIF to the option's
///     deposit address (plain transfer; counted by the open-source indexer, attested onchain, challengeable).
///   * Same-funding-source wallets collapse to one vote; groups are published, challenge-by-burn exists.
///   * Every counted voter gets a prize-draw entry regardless of their pick; the draw uses a future block hash.
///   * A finalized election can trigger an onchain action (`IOutcomeExecutor`), e.g. the People's Basket.
contract Flatland is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Open,
        Finalized
    }

    struct Params {
        string title;
        string[] options;
        string metaURI; // ipfs/https JSON: description, image, links
        uint64 start; // 0 = now
        uint64 end;
        uint128 voteCost; // >= MIN_COST
        address tallier; // 0 = fully onchain (deposit path, clustering & challenges disabled)
        address executor; // 0 = none
        uint64 challengeWindow; // used when tallier != 0
        uint32 winners; // prize-draw slots (0 = no draw)
        address prizeToken;
        uint128 challengeBurn; // WIF burned to open a challenge (0 => default 10 WIF)
    }

    struct Election {
        address creator;
        uint64 start;
        uint64 end;
        uint128 voteCost;
        address tallier;
        uint64 challengeWindow;
        uint8 optionCount;
        Status status;
        bool executed;
        bool depositsSubmitted;
        uint8 resubmits;
        uint8 winner;
        address executor;
        uint32 winners;
        uint32 depositCount;
        uint128 challengeBurn;
        uint64 challengeEnds;
        uint64 lastChallengeAt;
        uint32 openChallenges;
        bytes32 metaHash;
        address prizeToken;
        uint256 prizePool;
        uint256 prizePaid;
        bool prizeReclaimed;
        uint64 drawBlock;
        uint64 finalizedAt;
        bytes32 seed;
        bytes32 depositRoot;
        uint256 burned;
    }

    struct Challenge {
        address challenger;
        address accused;
        bool resolved;
        bool upheld;
    }

    uint256 public constant MIN_COST = 1e18;
    uint256 public constant DEFAULT_CHALLENGE_BURN = 10e18;
    uint256 public constant MAX_OPTIONS = 32;
    uint64 public constant SUBMIT_GRACE = 2 days;
    uint64 public constant RESOLUTION_GRACE = 1 days;
    uint64 public constant CLAIM_WINDOW = 30 days;
    uint64 public constant DRAW_DELAY = 10; // blocks (entropy units)
    uint256 public constant MAX_CHALLENGES = 64;
    uint256 public constant EXECUTOR_GAS = 1_000_000;

    IWIF public immutable WIF;
    IEntropy public immutable entropy;
    Standing public immutable standing;
    address public immutable boxImpl;
    /// @notice Address of the reference open-source indexer attester. Creators may use it, their own, or none.
    address public immutable defaultTallier;

    uint256 public electionCount;
    uint256 public totalBurned;
    uint256 public totalVotes;

    mapping(uint256 => Election) internal _el;
    mapping(uint256 => uint32[]) internal _chainTally;
    mapping(uint256 => uint32[]) internal _depositTally;
    mapping(uint256 => address[]) internal _voters;
    mapping(uint256 => mapping(address => uint256)) internal _voterIdx; // 1-based
    mapping(uint256 => mapping(address => uint8)) internal _voteOf; // option+1
    mapping(uint256 => Challenge[]) internal _challenges;
    mapping(uint256 => mapping(uint256 => bool)) public slotClaimed;
    mapping(uint256 => mapping(address => bool)) public standingClaimed;
    mapping(address => uint256) public electionsCreatedBy;

    event ElectionCreated(
        uint256 indexed id,
        address indexed creator,
        string title,
        string[] options,
        string metaURI,
        uint64 start,
        uint64 end,
        uint128 voteCost,
        address tallier,
        address executor,
        uint32 winners,
        address prizeToken
    );
    event Voted(uint256 indexed id, address indexed voter, uint8 option, uint256 burned);
    event DepositsSwept(uint256 indexed id, uint8 indexed option, address box, uint256 burned);
    event DepositsSubmitted(
        uint256 indexed id, uint32[] counts, bytes32 root, uint32 count, string uri, uint64 challengeEnds
    );
    event Collapsed(uint256 indexed id, address indexed loser, address indexed keeper, string groupURI);
    event ChallengeOpened(uint256 indexed id, uint256 cid, address indexed challenger, address indexed accused, string evidence);
    event ChallengeResolved(uint256 indexed id, uint256 cid, bool upheld);
    event PrizeFunded(uint256 indexed id, address indexed from, uint256 amount);
    event Finalized(uint256 indexed id, uint8 winner, uint256[] tally, uint256 entries, bool tie);
    event OutcomeExecuted(uint256 indexed id, bool ok);
    event DrawSeeded(uint256 indexed id, bytes32 seed, uint64 drawBlock);
    event DrawRearmed(uint256 indexed id, uint64 drawBlock);
    event PrizeClaimed(uint256 indexed id, uint256 slot, address indexed winner, uint256 amount);
    event PrizeReclaimed(uint256 indexed id, uint256 amount, bool burned);
    event StandingClaimed(uint256 indexed id, address indexed voter);

    error BadParams();
    error NotOpen();
    error NotStarted();
    error Ended();
    error StillRunning();
    error AlreadyVoted();
    error BadOption();
    error OnlyTallier();
    error NoTallier();
    error AlreadyFinal();
    error NotReady();
    error BadProof();
    error NoDraw();
    error AlreadyClaimed();
    error NotWinner();
    error TooMany();
    error NotFinal();

    constructor(address wif, address entropy_, address standing_, address defaultTallier_) {
        WIF = IWIF(wif);
        entropy = IEntropy(entropy_);
        standing = Standing(standing_);
        defaultTallier = defaultTallier_;
        boxImpl = address(new DepositBox(address(this), wif));
    }

    // ───────────────────────────── creation ─────────────────────────────

    function createElection(Params calldata p) external returns (uint256 id) {
        uint256 n = p.options.length;
        if (n < 2 || n > MAX_OPTIONS) revert BadParams();
        if (p.voteCost < MIN_COST) revert BadParams();
        uint64 start = p.start == 0 ? uint64(block.timestamp) : p.start;
        if (start + 1 hours < block.timestamp) revert BadParams();
        if (p.end < start + 1 hours || p.end > start + 90 days) revert BadParams();
        if (p.tallier != address(0) && (p.challengeWindow < 1 hours || p.challengeWindow > 7 days)) revert BadParams();
        if (p.winners > 100) revert BadParams();
        if (p.winners > 0 && p.prizeToken == address(0)) revert BadParams();

        id = ++electionCount;
        Election storage e = _el[id];
        e.creator = msg.sender;
        e.start = start;
        e.end = p.end;
        e.voteCost = p.voteCost;
        e.tallier = p.tallier;
        e.challengeWindow = p.challengeWindow;
        e.optionCount = uint8(n);
        e.status = Status.Open;
        e.executor = p.executor;
        e.winners = p.winners;
        e.challengeBurn = p.challengeBurn == 0 ? uint128(DEFAULT_CHALLENGE_BURN) : p.challengeBurn;
        e.metaHash = keccak256(abi.encode(p.title, p.options, p.metaURI));
        e.prizeToken = p.prizeToken;
        _chainTally[id] = new uint32[](n);
        _depositTally[id] = new uint32[](n);
        ++electionsCreatedBy[msg.sender];

        emit ElectionCreated(
            id, msg.sender, p.title, p.options, p.metaURI, start, p.end, p.voteCost, p.tallier, p.executor, p.winners, p.prizeToken
        );
    }

    function fundPrize(uint256 id, uint256 amount) external nonReentrant {
        Election storage e = _el[id];
        if (e.status != Status.Open || e.winners == 0) revert NotOpen();
        IERC20 t = IERC20(e.prizeToken);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        uint256 got = t.balanceOf(address(this)) - before;
        e.prizePool += got;
        emit PrizeFunded(id, msg.sender, got);
    }

    // ───────────────────────────── voting ─────────────────────────────

    /// @notice Connect-wallet vote: burns exactly `voteCost` WIF from the caller (needs prior approval).
    function vote(uint256 id, uint8 option) external nonReentrant {
        Election storage e = _el[id];
        if (e.status != Status.Open) revert NotOpen();
        if (block.timestamp < e.start) revert NotStarted();
        if (block.timestamp >= e.end) revert Ended();
        if (option >= e.optionCount) revert BadOption();
        if (_voteOf[id][msg.sender] != 0) revert AlreadyVoted();

        _voteOf[id][msg.sender] = option + 1;
        _voters[id].push(msg.sender);
        _voterIdx[id][msg.sender] = _voters[id].length;
        ++_chainTally[id][option];
        e.burned += e.voteCost;
        totalBurned += e.voteCost;
        ++totalVotes;
        WIF.burnFrom(msg.sender, e.voteCost);
        standing.recordVote(msg.sender, block.timestamp, e.voteCost);
        emit Voted(id, msg.sender, option, e.voteCost);
    }

    /// @notice Deterministic deposit address for (election, option). Send >= voteCost WIF to vote. Extra is burned, counts once.
    function depositAddress(uint256 id, uint8 option) public view returns (address) {
        return Clones.predictDeterministicAddress(boxImpl, _salt(id, option), address(this));
    }

    /// @notice Permissionless: deploy the box if needed and burn everything it holds. Anyone can call.
    function sweepDeposits(uint256 id, uint8 option) external nonReentrant returns (uint256 amount) {
        Election storage e = _el[id];
        if (e.status == Status.None) revert NotOpen();
        if (option >= e.optionCount) revert BadOption();
        address box = depositAddress(id, option);
        if (box.code.length == 0) Clones.cloneDeterministic(boxImpl, _salt(id, option));
        amount = DepositBox(box).burnAll();
        if (amount > 0) {
            e.burned += amount;
            totalBurned += amount;
        }
        emit DepositsSwept(id, option, box, amount);
    }

    function _salt(uint256 id, uint8 option) internal pure returns (bytes32) {
        return keccak256(abi.encode(id, option));
    }

    // ─────────────────── attested deposit votes & sybil handling ───────────────────

    /// @notice Tallier posts the deposit-path result: per-option counts AFTER funding-source collapse, plus a Merkle
    ///         root over leaves (index, voter, option) so every counted voter is provable (draw, standing, audit).
    ///         Clusters are published at `uri`. Resubmittable (max 3x) until finalization; each submit restarts the
    ///         challenge window.
    function submitDeposits(uint256 id, uint32[] calldata counts, bytes32 root, string calldata uri) external {
        Election storage e = _el[id];
        if (msg.sender != e.tallier || e.tallier == address(0)) revert OnlyTallier();
        if (e.status != Status.Open) revert AlreadyFinal();
        if (block.timestamp < e.end) revert StillRunning();
        if (counts.length != e.optionCount) revert BadParams();
        if (e.depositsSubmitted && e.resubmits >= 3) revert TooMany();
        uint32 total;
        for (uint256 i; i < counts.length; ++i) {
            _depositTally[id][i] = counts[i];
            total += counts[i];
        }
        if (e.depositsSubmitted) ++e.resubmits;
        e.depositsSubmitted = true;
        e.depositCount = total;
        e.depositRoot = root;
        e.challengeEnds = uint64(block.timestamp) + e.challengeWindow;
        emit DepositsSubmitted(id, counts, root, total, uri, e.challengeEnds);
    }

    /// @notice Tallier collapses a connect-wallet sybil into its group keeper (published at `groupURI`). Only before finalize.
    function collapse(uint256 id, address loser, address keeper, string calldata groupURI) external {
        Election storage e = _el[id];
        if (msg.sender != e.tallier || e.tallier == address(0)) revert OnlyTallier();
        if (e.status != Status.Open) revert AlreadyFinal();
        _removeVote(id, loser);
        emit Collapsed(id, loser, keeper, groupURI);
    }

    function _removeVote(uint256 id, address who) internal {
        uint256 idx = _voterIdx[id][who];
        if (idx == 0) revert BadParams();
        uint8 o = _voteOf[id][who] - 1;
        --_chainTally[id][o];
        address[] storage vs = _voters[id];
        address last = vs[vs.length - 1];
        vs[idx - 1] = last;
        _voterIdx[id][last] = idx;
        vs.pop();
        delete _voterIdx[id][who];
        // keep _voteOf set: a collapsed wallet cannot vote again
    }

    /// @notice Challenge-by-burn: burn `challengeBurn` WIF to formally accuse `accused` of being a sybil/duplicate.
    ///         The tallier must answer (`resolveChallenge`) or finalization proceeds after a grace period.
    function challenge(uint256 id, address accused, string calldata evidence) external nonReentrant returns (uint256 cid) {
        Election storage e = _el[id];
        if (e.status != Status.Open) revert NotOpen();
        if (e.tallier == address(0)) revert NoTallier();
        if (block.timestamp < e.start) revert NotStarted();
        if (_challenges[id].length >= MAX_CHALLENGES) revert TooMany();
        cid = _challenges[id].length;
        _challenges[id].push(Challenge(msg.sender, accused, false, false));
        ++e.openChallenges;
        e.lastChallengeAt = uint64(block.timestamp);
        e.burned += e.challengeBurn;
        totalBurned += e.challengeBurn;
        WIF.burnFrom(msg.sender, e.challengeBurn);
        emit ChallengeOpened(id, cid, msg.sender, accused, evidence);
    }

    function resolveChallenge(uint256 id, uint256 cid, bool upheld) external {
        Election storage e = _el[id];
        if (msg.sender != e.tallier || e.tallier == address(0)) revert OnlyTallier();
        if (e.status != Status.Open) revert AlreadyFinal();
        Challenge storage c = _challenges[id][cid];
        if (c.resolved) revert AlreadyClaimed();
        c.resolved = true;
        c.upheld = upheld;
        --e.openChallenges;
        if (upheld && _voterIdx[id][c.accused] != 0) _removeVote(id, c.accused);
        emit ChallengeResolved(id, cid, upheld);
    }

    // ───────────────────────────── finalize ─────────────────────────────

    function canFinalize(uint256 id) public view returns (bool) {
        Election storage e = _el[id];
        if (e.status != Status.Open || block.timestamp < e.end) return false;
        if (e.tallier != address(0)) {
            if (e.depositsSubmitted) {
                if (block.timestamp < e.challengeEnds) return false;
            } else if (block.timestamp < e.end + SUBMIT_GRACE) {
                return false;
            }
            if (e.openChallenges > 0 && block.timestamp < e.lastChallengeAt + RESOLUTION_GRACE) return false;
        }
        return true;
    }

    function finalize(uint256 id) external nonReentrant {
        Election storage e = _el[id];
        if (e.status == Status.Finalized) revert AlreadyFinal();
        if (!canFinalize(id)) revert NotReady();
        e.status = Status.Finalized;
        e.finalizedAt = uint64(block.timestamp);

        uint256 n = e.optionCount;
        uint256[] memory tally = new uint256[](n);
        uint256 best;
        uint8 win;
        bool tie;
        for (uint256 i; i < n; ++i) {
            tally[i] = uint256(_chainTally[id][i]) + _depositTally[id][i];
            if (tally[i] > best) {
                best = tally[i];
                win = uint8(i);
                tie = false;
            } else if (tally[i] == best && best > 0) {
                tie = true;
            }
        }
        e.winner = win;
        uint256 entries = _voters[id].length + e.depositCount;
        if (e.winners > 0 && e.prizePool > 0 && entries > 0) {
            e.drawBlock = uint64(entropy.currentBlock() + DRAW_DELAY);
        }
        emit Finalized(id, win, tally, entries, tie);

        if (e.executor != address(0)) _execute(id, e, win, tally);
    }

    function _execute(uint256 id, Election storage e, uint8 win, uint256[] memory tally) internal {
        try IOutcomeExecutor(e.executor).onFinalize{gas: EXECUTOR_GAS}(id, win, tally) {
            e.executed = true;
            emit OutcomeExecuted(id, true);
        } catch {
            emit OutcomeExecuted(id, false);
        }
    }

    /// @notice If the bound action failed (e.g. out of gas, market closed), anyone can retry it.
    function retryOutcome(uint256 id) external nonReentrant {
        Election storage e = _el[id];
        if (e.status != Status.Finalized || e.executed || e.executor == address(0)) revert NotReady();
        _execute(id, e, e.winner, tallies(id));
    }

    // ───────────────────────────── draw & prizes ─────────────────────────────

    /// @notice Freeze the draw seed from the future block hash chosen at finalization. Anyone can call.
    function seedDraw(uint256 id) external {
        Election storage e = _el[id];
        if (e.drawBlock == 0 || e.seed != bytes32(0)) revert NoDraw();
        bytes32 h = entropy.hashOf(e.drawBlock);
        if (h == bytes32(0)) revert NotReady();
        e.seed = keccak256(abi.encode(h, id, totalEntries(id), e.depositRoot, e.metaHash));
        emit DrawSeeded(id, e.seed, e.drawBlock);
    }

    /// @notice If nobody seeded within 256 blocks the hash is gone: re-arm with a fresh future block.
    function rearmDraw(uint256 id) external {
        Election storage e = _el[id];
        if (e.drawBlock == 0 || e.seed != bytes32(0)) revert NoDraw();
        if (entropy.currentBlock() <= e.drawBlock || entropy.hashOf(e.drawBlock) != bytes32(0)) revert NotReady();
        e.drawBlock = uint64(entropy.currentBlock() + DRAW_DELAY);
        emit DrawRearmed(id, e.drawBlock);
    }

    function winnerIndex(uint256 id, uint256 slot) public view returns (uint256) {
        Election storage e = _el[id];
        if (e.seed == bytes32(0) || slot >= e.winners) revert NoDraw();
        return uint256(keccak256(abi.encode(e.seed, slot))) % totalEntries(id);
    }

    function claimPrize(uint256 id, uint256 slot, uint256 index, address voter, uint8 option, bytes32[] calldata proof)
        external
        nonReentrant
    {
        Election storage e = _el[id];
        if (slotClaimed[id][slot]) revert AlreadyClaimed();
        if (winnerIndex(id, slot) != index) revert NotWinner();
        if (!isEntry(id, index, voter, option, proof)) revert BadProof();
        slotClaimed[id][slot] = true;
        uint256 amount = e.prizePool / e.winners;
        e.prizePaid += amount;
        IERC20(e.prizeToken).safeTransfer(voter, amount);
        emit PrizeClaimed(id, slot, voter, amount);
    }

    /// @notice Unclaimed prize after 30 days (or no entries): burned if it is WIF, else back to the creator.
    function reclaimPrize(uint256 id) external nonReentrant {
        Election storage e = _el[id];
        if (e.status != Status.Finalized || e.prizeReclaimed) revert NotReady();
        bool noDraw = e.drawBlock == 0;
        if (!noDraw && block.timestamp < e.finalizedAt + CLAIM_WINDOW) revert NotReady();
        e.prizeReclaimed = true;
        uint256 left = e.prizePool - e.prizePaid;
        if (left == 0) return;
        if (e.prizeToken == address(WIF)) {
            totalBurned += left;
            e.burned += left;
            WIF.burn(left);
            emit PrizeReclaimed(id, left, true);
        } else {
            IERC20(e.prizeToken).safeTransfer(e.creator, left);
            emit PrizeReclaimed(id, left, false);
        }
    }

    // ───────────────────────────── entries & standing ─────────────────────────────

    function totalEntries(uint256 id) public view returns (uint256) {
        return _voters[id].length + _el[id].depositCount;
    }

    function leafOf(uint256 index, address voter, uint8 option) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(index, voter, option))));
    }

    /// @notice Is (index, voter) a counted voter? Entries [0, chainVoters) are connect-wallet voters; the rest are
    ///         deposit-path voters proven against the attested Merkle root.
    function isEntry(uint256 id, uint256 index, address voter, uint8 option, bytes32[] calldata proof)
        public
        view
        returns (bool)
    {
        uint256 n = _voters[id].length;
        if (index < n) return _voters[id][index] == voter;
        Election storage e = _el[id];
        if (index - n >= e.depositCount) return false;
        return MerkleProof.verifyCalldata(proof, e.depositRoot, leafOf(index - n, voter, option));
    }

    /// @notice Deposit-path voters get their reputation/streak credited permissionlessly after finalization.
    function claimStanding(uint256 id, uint256 index, address voter, uint8 option, bytes32[] calldata proof) external {
        Election storage e = _el[id];
        if (e.status != Status.Finalized) revert NotFinal();
        if (standingClaimed[id][voter] || _voterIdx[id][voter] != 0) revert AlreadyClaimed();
        uint256 n = _voters[id].length;
        if (index < n || !isEntry(id, index, voter, option, proof)) revert BadProof();
        standingClaimed[id][voter] = true;
        standing.recordVote(voter, e.end, 0);
        emit StandingClaimed(id, voter);
    }

    // ───────────────────────────── views ─────────────────────────────

    function getElection(uint256 id) external view returns (Election memory) {
        return _el[id];
    }

    function tallies(uint256 id) public view returns (uint256[] memory t) {
        uint256 n = _el[id].optionCount;
        t = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            t[i] = uint256(_chainTally[id][i]) + _depositTally[id][i];
        }
    }

    function chainTally(uint256 id) external view returns (uint32[] memory) {
        return _chainTally[id];
    }

    function depositTally(uint256 id) external view returns (uint32[] memory) {
        return _depositTally[id];
    }

    function voterCount(uint256 id) external view returns (uint256) {
        return _voters[id].length;
    }

    function voterAt(uint256 id, uint256 i) external view returns (address) {
        return _voters[id][i];
    }

    function voteOf(uint256 id, address who) external view returns (bool voted, uint8 option) {
        uint8 v = _voteOf[id][who];
        return (v != 0, v == 0 ? 0 : v - 1);
    }

    function hasVoted(uint256 id, address who) external view returns (bool) {
        return _voterIdx[id][who] != 0;
    }

    function challengeCount(uint256 id) external view returns (uint256) {
        return _challenges[id].length;
    }

    function getChallenge(uint256 id, uint256 cid) external view returns (Challenge memory) {
        return _challenges[id][cid];
    }
}
