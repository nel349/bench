import { BaseError, ContractFunctionRevertedError } from "viem";

/**
 * Whether a read failed because the contract itself said no, which is an answer, or for any other
 * reason, which is not.
 *
 * A contract that refuses a question returns data saying why: `ERC721NonexistentToken(42)` for an
 * identity nobody holds, the plugin's own error for a session key an account never granted. The
 * client library also calls a node's internal error a revert, with no data behind it, and a node
 * that is down is no revert at all. Read as "the contract said no", each of those turned an outage
 * into a fact: an identity nobody holds, an allowance that does not exist.
 *
 * So only a revert that carries the contract's own data counts, and data means what a contract
 * returns: bytes, beginning with the four that name the error. A node's own error can carry `data`
 * too, a sentence such as "upstream request timeout" or an empty `0x`, and those are not it.
 *
 * The other way round is a limit, and a deliberate one. A node that strips a revert's data, as some
 * do, makes a real refusal look like a failure here, and the caller is told to try again where it
 * could have been told no. That is the safe direction: nothing false is said. Arc's own endpoint
 * returns the data, which was checked against the plugin on 10 October.
 */
const CONTRACT_DATA = /^0x[0-9a-fA-F]{8,}$/;
const SELECTOR = /^0x[0-9a-fA-F]{8}$/;

export function refusedByContract(error: unknown): boolean {
  const revert = error instanceof BaseError ? error.walk((e) => e instanceof ContractFunctionRevertedError) : null;
  if (!(revert instanceof ContractFunctionRevertedError)) return false;
  // The library fills both from whatever the node sent as `data`, words included, so each is held
  // to the shape of what a contract returns before it is believed.
  const named = typeof revert.signature === "string" && SELECTOR.test(revert.signature);
  const carried = typeof revert.raw === "string" && CONTRACT_DATA.test(revert.raw);
  return named || carried;
}
