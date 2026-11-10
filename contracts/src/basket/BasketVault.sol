// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Flatland} from "../Flatland.sol";
import {WifBuyback} from "../WifBuyback.sol";
import {Standing} from "../Standing.sol";
import {IWIF} from "../interfaces/IWIF.sol";
import {IOutcomeExecutor} from "../interfaces/IOutcomeExecutor.sol";
import {ISwapRouter02, IAggregatorV3, IStockToken} from "../interfaces/IDex.sol";

/// @title The People's Basket — a USDG vault whose Stock Token allocation is chosen by 1-wallet-1-vote $WIF burns.
/// @notice * Deposit USDG, receive PEOPLE shares priced off Chainlink NAV.
///         * Each weekly epoch a Flatland election (bound to this contract as its outcome executor) asks:
///           "which Stock Token deserves the basket?". One wallet, one vote, 1 $WIF burned. Capital buys no say.
///         * The result becomes target weights (top 5, proportional to votes, capped at 40%). Anyone calls `rebalance`.
///         * Fees (0.30% on deposit & redeem) accumulate as USDG and are spent buying $WIF on Uniswap and burning it.
///         * Anyone can burn 1 $WIF to back a nominee Stock Token; enough distinct backers promote it onto the ballot.
///         * Exit is always possible: `redeemInKind` pays out pro-rata tokens with no oracle and no swap.
/// @dev No owner, no admin, no upgrade. Asset registry (token, Chainlink proxy, v3 pool fee) is immutable per deployment.
contract BasketVault is ERC20, ReentrancyGuard, IOutcomeExecutor {
    using SafeERC20 for IERC20;

    struct AssetCfg {
        address token;
        address feed;
        uint24 poolFee; // Uniswap v3 token/USDG fee tier
        bool listed;
        string symbol;
    }

    struct Asset {
        address token;
        address feed;
        uint24 poolFee;
        bool listed;
        string symbol;
    }

    struct Epoch {
        uint256 electionId;
        uint64 start;
        bool applied;
        uint8[] assets; // option i == registry index assets[i]
    }

    uint256 public constant FEE_BPS = 30;
    uint256 public constant TOP_N = 5;
    uint256 public constant MAX_WEIGHT_BPS = 4000;
    uint256 public constant CASH_BUFFER_BPS = 100;
    uint256 public constant EPOCH_LEN = 7 days;
    uint256 public constant VOTE_WINDOW = 5 days;
    uint256 public constant MAX_STALENESS = 4 days; // stock feeds update 24/5
    uint256 public constant SLIPPAGE_BPS = 150;
    uint256 public constant MIN_TRADE = 2e6; // 2 USDG
    uint256 public constant MIN_BUYBACK = 5e6;
    uint256 public constant BUYBACK_INTERVAL = 1 hours;
    uint256 public constant MAX_LISTED = 24;
    uint256 public constant MAX_PROMOTE_PER_EPOCH = 2;

    IERC20 public immutable USDG;
    Flatland public immutable hub;
    WifBuyback public immutable buyback;
    ISwapRouter02 public immutable router;
    Standing public immutable standing;
    uint256 public immutable maxSwapUsdg;
    uint256 public immutable promoteThreshold; // distinct backers needed to reach the ballot

    Asset[] internal _assets;
    uint16[] public targetBps; // by registry index; sums to 10_000 once set
    bool public targetsSet;

    uint256 public pendingFees; // USDG earmarked for $WIF buyback+burn
    uint256 public lastBuyback;
    uint256 public totalFeesBurned; // USDG spent on buybacks
    uint256 public epochCount;
    mapping(uint256 => Epoch) internal _epochs; // 1-based
    uint256 public listedCount;

    // basket proposals
    mapping(uint256 => mapping(address => bool)) public backedInRound; // round => wallet => has backed
    mapping(uint256 => mapping(uint256 => uint256)) public backers; // round => asset idx => distinct backers

    event Deposited(address indexed who, address indexed receiver, uint256 usdg, uint256 fee, uint256 shares);
    event Redeemed(address indexed who, address indexed receiver, uint256 shares, uint256 usdgOut, uint256 fee);
    event RedeemedInKind(address indexed who, address indexed receiver, uint256 shares);
    event EpochOpened(uint256 indexed epoch, uint256 indexed electionId, uint8[] assets, uint64 start);
    event TargetsSet(uint256 indexed epoch, uint16[] bps);
    event Rebalanced(address indexed caller, uint256 navUsdg);
    event Traded(address indexed token, bool buy, uint256 usdgAmount, uint256 tokenAmount);
    event FeesBurned(uint256 usdgSpent, uint256 wifBurned);
    event Nominated(uint256 indexed round, uint256 indexed assetIdx, address indexed backer, uint256 backersNow);
    event Promoted(uint256 indexed round, uint256 indexed assetIdx, uint256 backers);

    error StaleOracle(address token);
    error Slippage();
    error NotHub();
    error WrongElection();
    error TooEarly();
    error NotFinal();
    error AlreadyListed();
    error NotListed();
    error AlreadyBacked();
    error NothingToDo();
    error ZeroAmount();
    error BadAsset();

    constructor(
        Flatland hub_,
        WifBuyback buyback_,
        Standing standing_,
        address usdg,
        address router_,
        AssetCfg[] memory cfg,
        uint256 maxSwapUsdg_,
        uint256 promoteThreshold_
    ) ERC20("People's Basket", "PEOPLE") {
        hub = hub_;
        buyback = buyback_;
        standing = standing_;
        USDG = IERC20(usdg);
        router = ISwapRouter02(router_);
        maxSwapUsdg = maxSwapUsdg_;
        promoteThreshold = promoteThreshold_;
        for (uint256 i; i < cfg.length; ++i) {
            _assets.push(Asset(cfg[i].token, cfg[i].feed, cfg[i].poolFee, cfg[i].listed, cfg[i].symbol));
            targetBps.push(0);
            if (cfg[i].listed) ++listedCount;
        }
    }

    // ───────────────────────────── pricing ─────────────────────────────

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function assetAt(uint256 i) external view returns (Asset memory) {
        return _assets[i];
    }

    /// @dev USD price (8 decimals) of ONE raw token. Chainlink already folds the ERC-8056 multiplier in: never re-apply it.
    function _price(uint256 i) internal view returns (uint256 p) {
        Asset storage a = _assets[i];
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(a.feed).latestRoundData();
        if (answer <= 0 || updatedAt == 0 || block.timestamp - updatedAt > MAX_STALENESS) revert StaleOracle(a.token);
        if (IStockToken(a.token).oraclePaused()) revert StaleOracle(a.token);
        p = uint256(answer);
    }

    function price(uint256 i) external view returns (uint256) {
        return _price(i);
    }

    function _value(uint256 i, uint256 bal) internal view returns (uint256) {
        if (bal == 0) return 0;
        return bal * _price(i) / 1e20; // 18-dec token * 8-dec price -> 6-dec USDG
    }

    function idleUsdg() public view returns (uint256) {
        return USDG.balanceOf(address(this)) - pendingFees;
    }

    /// @notice Net asset value in USDG (6 decimals), excluding earmarked fees.
    function totalAssets() public view returns (uint256 nav) {
        nav = idleUsdg();
        for (uint256 i; i < _assets.length; ++i) {
            nav += _value(i, IERC20(_assets[i].token).balanceOf(address(this)));
        }
    }

    function _sharesFor(uint256 usdg, uint256 nav) internal view returns (uint256) {
        // virtual shares/assets (offset 1e12) make first-deposit donation attacks uneconomic
        return usdg * (totalSupply() + 1e12) / (nav + 1);
    }

    function previewDeposit(uint256 usdg) external view returns (uint256 shares, uint256 fee) {
        fee = usdg * FEE_BPS / 10_000;
        shares = _sharesFor(usdg - fee, totalAssets());
    }

    // ───────────────────────────── deposit / redeem ─────────────────────────────

    function deposit(uint256 usdg, uint256 minShares, address receiver) external nonReentrant returns (uint256 shares) {
        if (usdg == 0) revert ZeroAmount();
        uint256 nav = totalAssets(); // before pulling funds
        uint256 fee = usdg * FEE_BPS / 10_000;
        shares = _sharesFor(usdg - fee, nav);
        if (shares < minShares) revert Slippage();
        USDG.safeTransferFrom(msg.sender, address(this), usdg);
        pendingFees += fee;
        _mint(receiver, shares);
        emit Deposited(msg.sender, receiver, usdg, fee, shares);
    }

    /// @notice Exit to USDG: sells your pro-rata slice of every holding on Uniswap (oracle-bounded), minus 0.30%.
    function redeem(uint256 shares, uint256 minUsdg, address receiver) external nonReentrant returns (uint256 out) {
        if (shares == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        uint256 mine = idleUsdg() * shares / supply;
        _burn(msg.sender, shares);
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            uint256 bal = IERC20(_assets[i].token).balanceOf(address(this));
            uint256 slice = bal * shares / supply;
            if (slice == 0) continue;
            mine += _sell(i, slice, _value(i, slice));
        }
        uint256 fee = mine * FEE_BPS / 10_000;
        out = mine - fee;
        if (out < minUsdg) revert Slippage();
        pendingFees += fee;
        USDG.safeTransfer(receiver, out);
        emit Redeemed(msg.sender, receiver, shares, out, fee);
    }

    /// @notice Emergency/no-trust exit: pro-rata tokens + idle USDG, no oracle, no swap, no fee. Always works.
    function redeemInKind(uint256 shares, address receiver) external nonReentrant {
        if (shares == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        uint256 usdgSlice = idleUsdg() * shares / supply;
        uint256[] memory slices = new uint256[](_assets.length);
        for (uint256 i; i < slices.length; ++i) {
            slices[i] = IERC20(_assets[i].token).balanceOf(address(this)) * shares / supply;
        }
        _burn(msg.sender, shares);
        if (usdgSlice > 0) USDG.safeTransfer(receiver, usdgSlice);
        for (uint256 i; i < slices.length; ++i) {
            if (slices[i] > 0) IERC20(_assets[i].token).safeTransfer(receiver, slices[i]);
        }
        emit RedeemedInKind(msg.sender, receiver, shares);
    }

    // ───────────────────────────── trading ─────────────────────────────

    function _sell(uint256 i, uint256 tokenAmount, uint256 usdgValue) internal returns (uint256 got) {
        Asset storage a = _assets[i];
        IERC20(a.token).forceApprove(address(router), tokenAmount);
        got = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(
                a.token, address(USDG), a.poolFee, address(this), tokenAmount, usdgValue * (10_000 - SLIPPAGE_BPS) / 10_000, 0
            )
        );
        emit Traded(a.token, false, got, tokenAmount);
    }

    function _buy(uint256 i, uint256 usdgAmount) internal returns (uint256 got) {
        Asset storage a = _assets[i];
        uint256 expected = usdgAmount * 1e20 / _price(i);
        USDG.forceApprove(address(router), usdgAmount);
        got = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams(
                address(USDG), a.token, a.poolFee, address(this), usdgAmount, expected * (10_000 - SLIPPAGE_BPS) / 10_000, 0
            )
        );
        emit Traded(a.token, true, usdgAmount, got);
    }

    /// @notice Permissionless. Moves holdings toward the people's target weights. Sells overweights first, then buys.
    ///         Each swap is oracle-bounded (1.5%) and capped at `maxSwapUsdg`; call again to finish big rebalances.
    function rebalance() external nonReentrant {
        if (!targetsSet) revert NothingToDo();
        uint256 n = _assets.length;
        uint256 nav = totalAssets();
        if (nav == 0) revert NothingToDo();
        uint256 investable = nav * (10_000 - CASH_BUFFER_BPS) / 10_000;
        uint256[] memory cur = new uint256[](n);
        uint256[] memory tgt = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            cur[i] = _value(i, IERC20(_assets[i].token).balanceOf(address(this)));
            tgt[i] = investable * targetBps[i] / 10_000;
        }
        bool traded;
        for (uint256 i; i < n; ++i) {
            if (cur[i] > tgt[i] + MIN_TRADE) {
                uint256 sellVal = cur[i] - tgt[i];
                if (sellVal > maxSwapUsdg) sellVal = maxSwapUsdg;
                uint256 bal = IERC20(_assets[i].token).balanceOf(address(this));
                uint256 amt = sellVal >= cur[i] ? bal : bal * sellVal / cur[i];
                _sell(i, amt, _value(i, amt));
                traded = true;
            }
        }
        for (uint256 i; i < n; ++i) {
            if (tgt[i] > cur[i] + MIN_TRADE) {
                uint256 spend = tgt[i] - cur[i];
                uint256 cash = idleUsdg();
                if (spend > cash) spend = cash;
                if (spend > maxSwapUsdg) spend = maxSwapUsdg;
                if (spend < MIN_TRADE) continue;
                _buy(i, spend);
                traded = true;
            }
        }
        if (!traded) revert NothingToDo();
        emit Rebalanced(msg.sender, nav);
    }

    // ───────────────────────────── flywheel: fees → buy WIF → burn ─────────────────────────────

    /// @notice Permissionless. Spends accrued vault fees buying $WIF on Uniswap v4 and burning it.
    /// @param minWifOut caller-supplied floor (use the v4 Quoter off-chain); per-call size is capped by the buyback.
    function buybackAndBurn(uint256 minWifOut) external nonReentrant returns (uint256 wifBurned) {
        if (block.timestamp < lastBuyback + BUYBACK_INTERVAL) revert TooEarly();
        uint256 amt = pendingFees;
        uint256 cap = buyback.maxUsdgPerCall();
        if (amt > cap) amt = cap;
        if (amt < MIN_BUYBACK) revert NothingToDo();
        lastBuyback = block.timestamp;
        pendingFees -= amt;
        totalFeesBurned += amt;
        USDG.forceApprove(address(buyback), amt);
        wifBurned = buyback.buyAndBurn(amt, minWifOut);
        emit FeesBurned(amt, wifBurned);
    }

    // ───────────────────────────── governance by burning ─────────────────────────────

    function epochInfo(uint256 e) external view returns (Epoch memory) {
        return _epochs[e];
    }

    /// @notice Start a new weekly epoch: promotes well-backed nominees onto the ballot and opens the Flatland election.
    function openEpoch() external nonReentrant returns (uint256 electionId) {
        uint256 e = epochCount;
        if (e > 0) {
            Epoch storage prev = _epochs[e];
            if (block.timestamp < prev.start + EPOCH_LEN) revert TooEarly();
            Flatland.Status st = hub.getElection(prev.electionId).status;
            if (st != Flatland.Status.Finalized) {
                if (!hub.canFinalize(prev.electionId)) revert NotFinal();
                hub.finalize(prev.electionId);
            }
        }
        _promote(e);
        e = ++epochCount;
        Epoch storage cur = _epochs[e];
        cur.start = uint64(block.timestamp);
        string[] memory names;
        {
            uint256 n;
            for (uint256 i; i < _assets.length; ++i) if (_assets[i].listed) ++n;
            names = new string[](n);
            uint256 k;
            for (uint256 i; i < _assets.length; ++i) {
                if (_assets[i].listed) {
                    cur.assets.push(uint8(i));
                    names[k++] = _assets[i].symbol;
                }
            }
        }
        Flatland.Params memory p;
        p.title = string.concat("People's Basket epoch ", _u2s(e));
        p.options = names;
        p.metaURI = "flatland:basket";
        p.end = uint64(block.timestamp + VOTE_WINDOW);
        p.voteCost = 1e18;
        p.tallier = hub.defaultTallier();
        p.executor = address(this);
        p.challengeWindow = 12 hours;
        electionId = hub.createElection(p);
        cur.electionId = electionId;
        emit EpochOpened(e, electionId, cur.assets, cur.start);
    }

    function _promote(uint256 round) internal {
        for (uint256 slot; slot < MAX_PROMOTE_PER_EPOCH; ++slot) {
            if (listedCount >= MAX_LISTED) return;
            uint256 best;
            uint256 bestN;
            for (uint256 i; i < _assets.length; ++i) {
                if (_assets[i].listed) continue;
                uint256 b = backers[round][i];
                if (b >= promoteThreshold && b > bestN) {
                    bestN = b;
                    best = i;
                }
            }
            if (bestN == 0) return;
            _assets[best].listed = true;
            ++listedCount;
            emit Promoted(round, best, bestN);
        }
    }

    /// @notice Back a not-yet-listed Stock Token: burns 1 $WIF (needs approval). One backing per wallet per round,
    ///         so nominations are decided by head-count, not by capital. Enough distinct backers = it joins the ballot.
    function nominate(uint256 assetIdx) external nonReentrant {
        if (assetIdx >= _assets.length) revert BadAsset();
        if (_assets[assetIdx].listed) revert AlreadyListed();
        uint256 round = epochCount;
        if (backedInRound[round][msg.sender]) revert AlreadyBacked();
        backedInRound[round][msg.sender] = true;
        uint256 b = ++backers[round][assetIdx];
        IWIF(address(hub.WIF())).burnFrom(msg.sender, 1e18);
        standing.recordAct(msg.sender, block.timestamp, 1e18);
        emit Nominated(round, assetIdx, msg.sender, b);
    }

    /// @inheritdoc IOutcomeExecutor
    function onFinalize(uint256 id, uint8, uint256[] calldata tally) external {
        if (msg.sender != address(hub)) revert NotHub();
        Epoch storage ep = _epochs[epochCount];
        if (id != ep.electionId || ep.applied) revert WrongElection();
        ep.applied = true;
        uint256 total;
        for (uint256 i; i < tally.length; ++i) total += tally[i];
        if (total == 0) return; // nobody voted: keep current targets
        uint16[] memory w = _weights(tally);
        for (uint256 i; i < targetBps.length; ++i) targetBps[i] = 0;
        for (uint256 i; i < w.length; ++i) targetBps[ep.assets[i]] = w[i];
        targetsSet = true;
        emit TargetsSet(epochCount, targetBps);
    }

    /// @dev top-N by votes, proportional, capped (water-filling). Pure → fuzzable.
    function _weights(uint256[] memory tally) internal pure returns (uint16[] memory w) {
        uint256 n = tally.length;
        w = new uint16[](n);
        bool[] memory picked = new bool[](n);
        uint256[] memory idx = new uint256[](TOP_N);
        uint256 k;
        for (uint256 r; r < TOP_N; ++r) {
            uint256 best = type(uint256).max;
            uint256 bestV;
            for (uint256 i; i < n; ++i) {
                if (!picked[i] && tally[i] > bestV) {
                    bestV = tally[i];
                    best = i;
                }
            }
            if (best == type(uint256).max) break;
            picked[best] = true;
            idx[k++] = best;
        }
        uint256 cap = MAX_WEIGHT_BPS;
        if (k * cap < 10_000) cap = (10_000 + k - 1) / k; // few winners: relax the cap just enough to reach 100%
        uint256[] memory bps = new uint256[](k);
        bool[] memory fixed_ = new bool[](k);
        uint256 remaining = 10_000;
        for (uint256 pass; pass <= k; ++pass) {
            uint256 free;
            for (uint256 j; j < k; ++j) if (!fixed_[j]) free += tally[idx[j]];
            if (free == 0) break;
            bool again;
            for (uint256 j; j < k; ++j) {
                if (fixed_[j]) continue;
                bps[j] = remaining * tally[idx[j]] / free;
                if (bps[j] > cap) {
                    bps[j] = cap;
                    fixed_[j] = true;
                    remaining -= cap;
                    again = true;
                    break; // recompute with this one pinned
                }
            }
            if (!again) break;
        }
        uint256 sum;
        for (uint256 j; j < k; ++j) sum += bps[j];
        // rounding dust to the leader so weights sum to exactly 10_000
        if (k > 0 && sum < 10_000) bps[0] += 10_000 - sum;
        for (uint256 j; j < k; ++j) w[idx[j]] = uint16(bps[j]);
    }

    function _u2s(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 t = v;
        uint256 d;
        while (t != 0) {
            ++d;
            t /= 10;
        }
        bytes memory b = new bytes(d);
        while (v != 0) {
            b[--d] = bytes1(uint8(48 + v % 10));
            v /= 10;
        }
        return string(b);
    }

    function targets() external view returns (uint16[] memory) {
        return targetBps;
    }

    /// @notice Test/inspection helper (pure): how a tally maps to weights.
    function previewWeights(uint256[] calldata tally) external pure returns (uint16[] memory) {
        return _weights(tally);
    }
}
