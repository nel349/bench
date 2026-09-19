// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {BountyEscrow, IERC20} from "../src/BountyEscrow.sol";

/**
 * @notice Deploys BountyEscrow.
 *
 * @dev Deterministic, through the CREATE2 factory at 0x4e59b4...4956C that Foundry uses when a salt
 *      is supplied. The same bytecode and salt land on the same address on every chain, so the
 *      testnet deployment and the mainnet one share an address and the config does not need two
 *      entries that can drift apart.
 *
 *      USDC is Arc's native dollar seen through its ERC-20 view — the rail the mandate's allowance
 *      meters, so a bounty funded here is bounded by the same limit as everything else an agent
 *      does. It is the same address on both networks.
 *
 *      ARBITER is the address trusted to name a winner. It should be the gym's own key and nothing
 *      else, because it is the one thing here that is not enforced by the contract.
 *
 *      forge script script/DeployEscrow.s.sol --rpc-url arc_testnet --broadcast
 */
contract DeployEscrow is Script {
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    bytes32 internal constant SALT = keccak256("bench.BountyEscrow.v1");

    function run() external {
        address arbiter = vm.envAddress("BENCH_ARBITER");
        require(arbiter != address(0), "BENCH_ARBITER must name the address that will award bounties");

        vm.startBroadcast();
        BountyEscrow escrow = new BountyEscrow{salt: SALT}(IERC20(USDC), arbiter);
        vm.stopBroadcast();

        console.log("BountyEscrow:", address(escrow));
        console.log("token:       ", address(escrow.token()));
        console.log("arbiter:     ", escrow.arbiter());
    }
}
