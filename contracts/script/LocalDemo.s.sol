// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BountyEscrow, IERC20} from "../src/BountyEscrow.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/**
 * @notice Stands the whole thing up on a local chain: a token, an escrow, and one funded bounty.
 *
 * @dev So the gym can be run against a real contract rather than a stub. A stubbed arbiter proves
 *      the gym's own logic and nothing about whether the ABI matches, whether the arbiter is
 *      actually the arbiter, or whether the money moves — which are the three ways this breaks.
 *
 *      Local only. Arc's USDC is a precompile at 0x3600…, and no local chain has it.
 *
 *      forge script script/LocalDemo.s.sol --rpc-url http://localhost:8545 --broadcast
 */
contract LocalDemo is Script {
    function run() external {
        address arbiter = vm.envAddress("BENCH_ARBITER");
        uint256 amount = vm.envOr("BOUNTY_AMOUNT", uint256(500e6));

        vm.startBroadcast();
        MockUSDC usdc = new MockUSDC();
        BountyEscrow escrow = new BountyEscrow(IERC20(address(usdc)), arbiter);

        usdc.mint(msg.sender, amount);
        usdc.approve(address(escrow), amount);
        uint256 id = escrow.post(amount, uint64(block.timestamp + 7 days));
        vm.stopBroadcast();

        console.log("USDC        ", address(usdc));
        console.log("BountyEscrow", address(escrow));
        console.log("arbiter     ", escrow.arbiter());
        console.log("bounty id   ", id);
        console.log("held        ", usdc.balanceOf(address(escrow)));
    }
}
