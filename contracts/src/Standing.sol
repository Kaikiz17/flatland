// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Standing — NFT-free voter reputation (onchain counts + weekly streaks) and opt-in country.
/// @notice Pure counters. Nothing here confers voting power: Flatland is 1 wallet = 1 vote.
///         Streaks exist only to give people a reason to come back every week.
contract Standing {
    struct Record {
        uint32 votes; // elections voted in
        uint32 acts; // "send 1 WIF to act" gate actions
        uint32 streak; // consecutive weekly epochs with participation
        uint32 bestStreak;
        uint32 lastEpoch; // weeks since unix epoch (+1) of last participation
        uint128 burned; // total WIF burned through Flatland by this wallet
        bytes2 country; // optional, self-declared ISO-3166 alpha-2, "\0\0" = not shared
    }

    uint256 public constant EPOCH = 7 days;

    address public immutable deployer;
    bool public writersLocked;
    mapping(address => bool) public isWriter;
    mapping(address => Record) internal _rec;

    uint256 public uniqueParticipants;
    /// @dev country code => wallets that opted in to that country. Coarse, voluntary, public.
    mapping(bytes2 => uint256) public countryWallets;

    event Participation(address indexed who, bool isVote, uint32 streak, uint32 votes, uint32 acts);
    event CountrySet(address indexed who, bytes2 country);

    error NotWriter();
    error Locked();
    error BadCountry();

    constructor() {
        deployer = msg.sender;
    }

    /// @notice One-shot wiring (hub, gate, participation vault). Locked afterwards: no admin forever.
    function setWriters(address[] calldata writers) external {
        if (msg.sender != deployer || writersLocked) revert Locked();
        writersLocked = true;
        for (uint256 i; i < writers.length; ++i) isWriter[writers[i]] = true;
    }

    function recordVote(address who, uint256 ts, uint256 burned) external {
        if (!isWriter[msg.sender]) revert NotWriter();
        Record storage r = _rec[who];
        if (r.votes == 0 && r.acts == 0) ++uniqueParticipants;
        ++r.votes;
        _touch(r, ts, burned);
        emit Participation(who, true, r.streak, r.votes, r.acts);
    }

    function recordAct(address who, uint256 ts, uint256 burned) external {
        if (!isWriter[msg.sender]) revert NotWriter();
        Record storage r = _rec[who];
        if (r.votes == 0 && r.acts == 0) ++uniqueParticipants;
        ++r.acts;
        _touch(r, ts, burned);
        emit Participation(who, false, r.streak, r.votes, r.acts);
    }

    function _touch(Record storage r, uint256 ts, uint256 burned) internal {
        r.burned += uint128(burned);
        uint32 epoch = uint32(ts / EPOCH) + 1;
        if (epoch == r.lastEpoch) return;
        if (epoch == r.lastEpoch + 1) {
            ++r.streak;
        } else if (epoch > r.lastEpoch) {
            r.streak = 1;
        } else {
            return; // late-claimed older participation: counts, doesn't move the streak
        }
        r.lastEpoch = epoch;
        if (r.streak > r.bestStreak) r.bestStreak = r.streak;
    }

    /// @notice Opt in to (or clear) a coarse, self-declared country for the public voter map.
    ///         No IPs, no geolocation, nothing inferred: only what you choose to publish. Pass 0x0000 to clear.
    function setCountry(bytes2 code) external {
        if (code != bytes2(0)) {
            if (uint8(code[0]) < 65 || uint8(code[0]) > 90 || uint8(code[1]) < 65 || uint8(code[1]) > 90) {
                revert BadCountry();
            }
        }
        Record storage r = _rec[msg.sender];
        bytes2 old = r.country;
        if (old != bytes2(0)) --countryWallets[old];
        r.country = code;
        if (code != bytes2(0)) ++countryWallets[code];
        emit CountrySet(msg.sender, code);
    }

    function record(address who) external view returns (Record memory) {
        return _rec[who];
    }

    /// @notice Badge tier derived from onchain counts. 0 none, 1 Sprout, 2 Walker, 3 Surveyor, 4 Cartographer.
    function tier(address who) external view returns (uint8) {
        Record storage r = _rec[who];
        uint256 n = uint256(r.votes) + r.acts;
        if (n == 0) return 0;
        if (n >= 25 || r.bestStreak >= 8) return 4;
        if (n >= 10 || r.bestStreak >= 4) return 3;
        if (n >= 3 || r.bestStreak >= 2) return 2;
        return 1;
    }

    function votesOf(address who) external view returns (uint256) {
        return _rec[who].votes;
    }
}
