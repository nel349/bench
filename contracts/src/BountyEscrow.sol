// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev The ERC-20 view over Arc's native dollar. On Arc the dollar *is* the currency, and this is
///      the same balance seen through a token interface — which is the rail the mandate's allowance
///      meters, so a bounty funded here is bounded by the same limit as everything else an agent does.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title BountyEscrow
 * @notice Holds a bounty until a solver is named, or until it expires and the poster takes it back.
 *
 * @dev **This is escrow with a named arbiter, not a trustless market, and the contract says so
 *      rather than implying otherwise.** Deciding whether an answer passed a checker is not
 *      something a chain can do: the checker runs off chain over data the chain never sees. So one
 *      address — the gym — is trusted to name the winner.
 *
 *      What bounds that trust is the deadline. The arbiter can name a solver, and it can do nothing
 *      at all; what it cannot do is keep the money in limbo, because once the deadline passes the
 *      poster reclaims it and the arbiter is locked out. An arbiter that goes quiet, loses its key,
 *      or simply refuses costs a poster time, never the principal.
 *
 *      The arbiter *can* name itself. That is the real residual trust and there is no clever way
 *      around it here — an arbiter willing to steal one bounty publicly has already ended the gym
 *      that is its only reason to exist. Narrowing it further wants the ERC-8004 validation registry
 *      and a challenge window, which is a later job and a bigger one.
 */
contract BountyEscrow {
    /// @dev A bounty's whole life, in one slot-packed struct.
    struct Bounty {
        address poster;
        /// @dev Seconds since the epoch, after which the poster may reclaim. Never zero for a live bounty.
        uint64 deadline;
        /// @dev Set the moment it is paid or refunded, so neither can happen twice.
        bool settled;
        uint256 amount;
    }

    /// @notice The token every bounty is denominated in. Fixed at deployment: a contract that could
    ///         be pointed at a different token later is a contract whose balances mean nothing.
    IERC20 public immutable token;

    /// @notice The address trusted to name a solver. See the note on this contract.
    address public arbiter;

    /// @dev Bounties are numbered from 1, so that zero reliably means "no such bounty".
    uint256 public nextId = 1;

    mapping(uint256 => Bounty) private bounties;

    event Posted(uint256 indexed id, address indexed poster, uint256 amount, uint64 deadline);
    event Awarded(uint256 indexed id, address indexed solver, uint256 amount);
    event Reclaimed(uint256 indexed id, address indexed poster, uint256 amount);
    event ArbiterChanged(address indexed from, address indexed to);

    error NotArbiter();
    error NotPoster();
    error NoSuchBounty();
    error AlreadySettled();
    error DeadlinePassed();
    error DeadlineNotReached();
    error ZeroAmount();
    error ZeroAddress();
    error DeadlineTooSoon();
    error TransferFailed();

    /// @dev A bounty nobody could realistically attempt is a way to post a number and take it back.
    uint64 public constant MIN_DURATION = 1 hours;

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter();
        _;
    }

    constructor(IERC20 _token, address _arbiter) {
        if (address(_token) == address(0) || _arbiter == address(0)) revert ZeroAddress();
        token = _token;
        arbiter = _arbiter;
    }

    /// @notice Fund a bounty. The caller must have approved this contract for `amount` first.
    /// @dev The amount credited is what actually *arrived*, not what was asked for. A token that
    ///      takes a fee on transfer would otherwise leave every bounty promising more than it holds,
    ///      and the shortfall would only surface when the last one failed to pay out.
    function post(uint256 amount, uint64 deadline) external returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (deadline < block.timestamp + MIN_DURATION) revert DeadlineTooSoon();

        uint256 before = token.balanceOf(address(this));
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint256 received = token.balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        id = nextId++;
        bounties[id] = Bounty({poster: msg.sender, deadline: deadline, settled: false, amount: received});
        emit Posted(id, msg.sender, received, deadline);
    }

    /// @notice Pay a bounty out to the agent that solved it.
    /// @dev Refused once the deadline has passed. After that the money is the poster's to reclaim,
    ///      and letting a late award race a reclaim would make which one lands a matter of block
    ///      ordering rather than of the rules.
    function award(uint256 id, address solver) external onlyArbiter {
        Bounty storage b = bounties[id];
        if (b.poster == address(0)) revert NoSuchBounty();
        if (b.settled) revert AlreadySettled();
        if (block.timestamp > b.deadline) revert DeadlinePassed();
        if (solver == address(0)) revert ZeroAddress();

        // Settled before the transfer, so a token that calls back into this contract finds a bounty
        // that is already spent rather than one it can be paid out of twice.
        b.settled = true;
        uint256 amount = b.amount;

        if (!token.transfer(solver, amount)) revert TransferFailed();
        emit Awarded(id, solver, amount);
    }

    /// @notice Take back a bounty nobody won. Callable by the poster once the deadline has passed.
    /// @dev Only the poster, even though the destination is fixed. An open call would let anyone
    ///      choose *when* someone else's refund lands, which is not theirs to choose.
    function reclaim(uint256 id) external {
        Bounty storage b = bounties[id];
        if (b.poster == address(0)) revert NoSuchBounty();
        if (msg.sender != b.poster) revert NotPoster();
        if (b.settled) revert AlreadySettled();
        if (block.timestamp <= b.deadline) revert DeadlineNotReached();

        b.settled = true;
        uint256 amount = b.amount;

        if (!token.transfer(b.poster, amount)) revert TransferFailed();
        emit Reclaimed(id, b.poster, amount);
    }

    /// @notice Hand the arbiter role to a new address, for a key rotation.
    /// @dev Live bounties are unaffected: the role is checked when `award` is called, not when a
    ///      bounty is posted. A poster who does not like the new arbiter waits out the deadline and
    ///      reclaims, which is the same recourse they always had.
    function setArbiter(address next) external onlyArbiter {
        if (next == address(0)) revert ZeroAddress();
        emit ArbiterChanged(arbiter, next);
        arbiter = next;
    }

    function get(uint256 id) external view returns (Bounty memory) {
        Bounty memory b = bounties[id];
        if (b.poster == address(0)) revert NoSuchBounty();
        return b;
    }

    /// @notice Whether this bounty can still be won right now.
    function isOpen(uint256 id) external view returns (bool) {
        Bounty memory b = bounties[id];
        return b.poster != address(0) && !b.settled && block.timestamp <= b.deadline;
    }
}
