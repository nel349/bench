import { parseAbi } from "viem";

/**
 * The two calls the funding flow makes, as an ABI rather than hand-packed bytes.
 *
 * The page this replaces built its calldata by concatenating a hard-coded selector with
 * `.padStart(64, "0")` — which works until an argument is a different type, an address arrives
 * lowercase, or a signature changes, and then it sends a well-formed transaction to the wrong
 * function. `encodeFunctionData` reads this and cannot.
 */
export const USDC_ABI = parseAbi([
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

export const GATEWAY_ABI = parseAbi([
  "function depositFor(address token, address depositor, uint256 value)",
  "function availableBalance(address token, address depositor) view returns (uint256)",
]);
