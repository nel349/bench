// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {BountyEscrow, IERC20} from "../src/BountyEscrow.sol";

/// @dev A plain ERC-20, enough to move balances around.
contract MockUSDC is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Keeps 1% on the way in. Exists to prove a bounty is credited what arrived, not what was asked.
contract FeeUSDC is MockUSDC {
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount / 100;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        return true;
    }
}

/// @dev Returns false rather than reverting, the way some tokens do.
contract SilentlyFailingUSDC is MockUSDC {
    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }
}

/**
 * @dev An arbiter that is a contract, which is the realistic case — a multisig, or the gym's own
 *      automation. It re-enters `award` for the same bounty while the first payout is still in
 *      flight.
 *
 *      It has to be the arbiter and not the token. A token that calls `award` itself is stopped by
 *      `onlyArbiter` long before the settled flag is consulted, so a test built that way passes
 *      whatever the ordering is and proves nothing. The first version of this test did exactly that.
 */
contract ReentrantArbiter {
    BountyEscrow public escrow;
    uint256 public target;
    bool public reentered;
    bool private inside;

    function arm(BountyEscrow _escrow, uint256 _target) external {
        escrow = _escrow;
        target = _target;
    }

    /// @dev Called by the token mid-transfer. Swallows the revert: the assertion is about balances.
    function reenter() external {
        if (inside) return;
        inside = true;
        reentered = true;
        try escrow.award(target, address(this)) {} catch {}
        inside = false;
    }

    function award(uint256 id, address solver) external {
        escrow.award(id, solver);
    }
}

/// @dev Calls into the arbiter mid-transfer, giving it the chance to re-enter.
contract ReentrantUSDC is MockUSDC {
    ReentrantArbiter public bot;

    function arm(ReentrantArbiter _bot) external {
        bot = _bot;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (address(bot) != address(0)) bot.reenter();
        return ok;
    }
}

contract BountyEscrowTest is Test {
    MockUSDC internal usdc;
    BountyEscrow internal escrow;

    address internal arbiter = address(0xA1);
    address internal poster = address(0xB0);
    address internal solver = address(0x50);
    address internal stranger = address(0x99);

    uint256 internal constant BOUNTY = 500e6;
    uint64 internal deadline;

    function setUp() public {
        vm.warp(1_700_000_000);
        deadline = uint64(block.timestamp + 7 days);
        usdc = new MockUSDC();
        escrow = new BountyEscrow(IERC20(address(usdc)), arbiter);
        usdc.mint(poster, BOUNTY * 10);
        vm.prank(poster);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _post() internal returns (uint256 id) {
        vm.prank(poster);
        return escrow.post(BOUNTY, deadline);
    }

    // --- posting -------------------------------------------------------------------------------

    function test_PostHoldsTheMoney() public {
        uint256 id = _post();
        assertEq(usdc.balanceOf(address(escrow)), BOUNTY, "escrow holds it");
        assertEq(escrow.get(id).amount, BOUNTY);
        assertEq(escrow.get(id).poster, poster);
        assertTrue(escrow.isOpen(id));
    }

    function test_IdsStartAtOneSoZeroMeansNothing() public {
        assertEq(_post(), 1);
        assertEq(_post(), 2);
    }

    function test_RevertWhen_PostingNothing() public {
        vm.prank(poster);
        vm.expectRevert(BountyEscrow.ZeroAmount.selector);
        escrow.post(0, deadline);
    }

    function test_RevertWhen_DeadlineIsTooSoonToAttempt() public {
        vm.prank(poster);
        vm.expectRevert(BountyEscrow.DeadlineTooSoon.selector);
        escrow.post(BOUNTY, uint64(block.timestamp + 1 minutes));
    }

    /// A bounty must promise only what it actually holds, or the shortfall lands on whoever is last.
    function test_CreditsWhatArrivedNotWhatWasAsked() public {
        FeeUSDC fee = new FeeUSDC();
        BountyEscrow e = new BountyEscrow(IERC20(address(fee)), arbiter);
        fee.mint(poster, BOUNTY);
        vm.startPrank(poster);
        fee.approve(address(e), type(uint256).max);
        uint256 id = e.post(BOUNTY, deadline);
        vm.stopPrank();

        assertEq(e.get(id).amount, BOUNTY - BOUNTY / 100, "credited the arrival");
        assertEq(e.get(id).amount, fee.balanceOf(address(e)), "and it is all there");
    }

    // --- awarding ------------------------------------------------------------------------------

    function test_ArbiterPaysTheSolver() public {
        uint256 id = _post();
        vm.prank(arbiter);
        escrow.award(id, solver);
        assertEq(usdc.balanceOf(solver), BOUNTY);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertFalse(escrow.isOpen(id));
    }

    function test_RevertWhen_AnyoneElseAwards() public {
        uint256 id = _post();
        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NotArbiter.selector);
        escrow.award(id, solver);

        vm.prank(poster); // not even the poster
        vm.expectRevert(BountyEscrow.NotArbiter.selector);
        escrow.award(id, solver);
    }

    function test_RevertWhen_AwardingTwice() public {
        uint256 id = _post();
        vm.startPrank(arbiter);
        escrow.award(id, solver);
        vm.expectRevert(BountyEscrow.AlreadySettled.selector);
        escrow.award(id, solver);
        vm.stopPrank();
    }

    function test_RevertWhen_AwardingAfterTheDeadline() public {
        uint256 id = _post();
        vm.warp(deadline + 1);
        vm.prank(arbiter);
        vm.expectRevert(BountyEscrow.DeadlinePassed.selector);
        escrow.award(id, solver);
    }

    function test_AwardOnTheDeadlineItselfIsStillFine() public {
        uint256 id = _post();
        vm.warp(deadline);
        vm.prank(arbiter);
        escrow.award(id, solver);
        assertEq(usdc.balanceOf(solver), BOUNTY);
    }

    function test_RevertWhen_AwardingSomethingThatDoesNotExist() public {
        vm.prank(arbiter);
        vm.expectRevert(BountyEscrow.NoSuchBounty.selector);
        escrow.award(999, solver);
    }

    // --- reclaiming ----------------------------------------------------------------------------

    function test_PosterReclaimsAfterTheDeadline() public {
        uint256 id = _post();
        uint256 before = usdc.balanceOf(poster);
        vm.warp(deadline + 1);
        vm.prank(poster);
        escrow.reclaim(id);
        assertEq(usdc.balanceOf(poster) - before, BOUNTY);
    }

    function test_RevertWhen_ReclaimingBeforeTheDeadline() public {
        uint256 id = _post();
        vm.prank(poster);
        vm.expectRevert(BountyEscrow.DeadlineNotReached.selector);
        escrow.reclaim(id);
    }

    /// The whole point of the deadline: an arbiter that goes quiet cannot keep the money.
    function test_ASilentArbiterCannotStrandTheMoney() public {
        uint256 id = _post();
        vm.warp(deadline + 1);
        vm.prank(poster);
        escrow.reclaim(id);
        assertEq(usdc.balanceOf(address(escrow)), 0);

        vm.prank(arbiter);
        vm.expectRevert(BountyEscrow.AlreadySettled.selector);
        escrow.award(id, solver);
    }

    function test_RevertWhen_SomeoneElseReclaims() public {
        uint256 id = _post();
        vm.warp(deadline + 1);
        vm.prank(stranger);
        vm.expectRevert(BountyEscrow.NotPoster.selector);
        escrow.reclaim(id);
    }

    function test_RevertWhen_ReclaimingAnAwardedBounty() public {
        uint256 id = _post();
        vm.prank(arbiter);
        escrow.award(id, solver);
        vm.warp(deadline + 1);
        vm.prank(poster);
        vm.expectRevert(BountyEscrow.AlreadySettled.selector);
        escrow.reclaim(id);
    }

    // --- the arbiter role ----------------------------------------------------------------------

    function test_ArbiterCanRotateItsKey() public {
        address next = address(0xA2);
        vm.prank(arbiter);
        escrow.setArbiter(next);

        uint256 id = _post();
        vm.prank(arbiter);
        vm.expectRevert(BountyEscrow.NotArbiter.selector);
        escrow.award(id, solver);

        vm.prank(next);
        escrow.award(id, solver);
        assertEq(usdc.balanceOf(solver), BOUNTY);
    }

    function test_RevertWhen_RotatingToNobody() public {
        vm.prank(arbiter);
        vm.expectRevert(BountyEscrow.ZeroAddress.selector);
        escrow.setArbiter(address(0));
    }

    // --- what it has to survive ----------------------------------------------------------------

    /**
     * Settled before the transfer, so a token that calls back finds a bounty already spent.
     *
     * @dev **Two bounties, and this matters.** With only one funded, the escrow holds exactly what
     *      it is paying out, so a reentrant second payout fails on an arithmetic underflow inside
     *      the token — and the test passes whether or not the guard is there, proving nothing. The
     *      first version of this test did exactly that. Funding a second bounty gives the attacker
     *      something real to steal, so the assertion is about the guard rather than about a balance
     *      that happened to run out.
     */
    function test_ReentrancyCannotPayTheSameBountyTwice() public {
        ReentrantUSDC evil = new ReentrantUSDC();
        ReentrantArbiter bot = new ReentrantArbiter();
        BountyEscrow e = new BountyEscrow(IERC20(address(evil)), address(bot));

        evil.mint(poster, BOUNTY * 2);
        vm.startPrank(poster);
        evil.approve(address(e), type(uint256).max);
        uint256 target = e.post(BOUNTY, deadline);
        e.post(BOUNTY, deadline); // somebody else's money, sitting in the same contract
        vm.stopPrank();

        assertEq(evil.balanceOf(address(e)), BOUNTY * 2, "there is more here than the target bounty");

        bot.arm(e, target);
        evil.arm(bot);
        bot.award(target, address(bot));

        assertTrue(bot.reentered(), "the attack actually ran");
        assertEq(evil.balanceOf(address(bot)), BOUNTY, "paid exactly once");
        assertEq(evil.balanceOf(address(e)), BOUNTY, "the other bounty is untouched");
    }

    /// A token that returns false instead of reverting must not be read as success.
    function test_RevertWhen_TheTokenQuietlyFails() public {
        SilentlyFailingUSDC quiet = new SilentlyFailingUSDC();
        BountyEscrow e = new BountyEscrow(IERC20(address(quiet)), arbiter);
        quiet.mint(poster, BOUNTY);
        vm.startPrank(poster);
        quiet.approve(address(e), type(uint256).max);
        uint256 id = e.post(BOUNTY, deadline);
        vm.stopPrank();

        vm.prank(arbiter);
        vm.expectRevert(BountyEscrow.TransferFailed.selector);
        e.award(id, solver);
    }

    function test_RevertWhen_DeployedWithNoTokenOrNoArbiter() public {
        vm.expectRevert(BountyEscrow.ZeroAddress.selector);
        new BountyEscrow(IERC20(address(0)), arbiter);
        vm.expectRevert(BountyEscrow.ZeroAddress.selector);
        new BountyEscrow(IERC20(address(usdc)), address(0));
    }

    /// Bounties must not be able to spend each other's money.
    function testFuzz_BountiesAreIndependent(uint96 a, uint96 b) public {
        vm.assume(a > 0 && b > 0);
        usdc.mint(poster, uint256(a) + b);
        vm.startPrank(poster);
        uint256 first = escrow.post(a, deadline);
        uint256 second = escrow.post(b, deadline);
        vm.stopPrank();

        vm.prank(arbiter);
        escrow.award(first, solver);
        assertEq(usdc.balanceOf(solver), a);
        assertEq(escrow.get(second).amount, b, "the other is untouched");

        vm.warp(deadline + 1);
        vm.prank(poster);
        escrow.reclaim(second);
    }

    /// Whatever happens to one bounty, the escrow never pays out more than it took in.
    function testFuzz_NeverPaysOutMoreThanItHolds(uint96 amount, bool awardIt, uint32 skipAhead) public {
        vm.assume(amount > 0);
        usdc.mint(poster, amount);
        vm.prank(poster);
        uint256 id = escrow.post(amount, deadline);

        vm.warp(block.timestamp + skipAhead);
        if (awardIt && block.timestamp <= deadline) {
            vm.prank(arbiter);
            escrow.award(id, solver);
        } else if (block.timestamp > deadline) {
            vm.prank(poster);
            escrow.reclaim(id);
        }
        assertLe(usdc.balanceOf(solver), amount);
    }
}
