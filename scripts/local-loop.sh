#!/usr/bin/env bash
#
# The whole bounty loop against a real contract, on a local chain, with no keys and no funds.
#
# A stubbed arbiter proves the gym's own logic and nothing about whether the ABI matches, whether
# the arbiter is really the arbiter, or whether the money moves — which are the three ways this
# breaks. It failed here the first time for a fourth reason nobody would have guessed.
#
# Needs Foundry (anvil, cast, forge) and Bun. Touches no network and spends nothing.
set -euo pipefail

PORT="${PORT:-8841}"
RPC="${RPC:-http://localhost:8545}"

# Anvil's standard dev keys. Publicly known and worthless by design; they exist to be in scripts.
ACC0_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ARBITER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
ARBITER=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
SOLVER=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

# --chain-id matters. bench builds its wallet client from the configured Arc chain, so a node on a
# different id makes every transaction fail with "Transaction creation failed" and no hint as to
# why. That is what went wrong the first time this was run.
echo "› anvil on Arc testnet's chain id"
anvil --silent --port "${RPC##*:}" --chain-id 5042002 >/tmp/bench-anvil.log 2>&1 &
pids+=($!)
for _ in $(seq 1 40); do cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.25; done

echo "› deploying the token, the escrow, and one funded bounty"
out=$(cd "$root/contracts" && BENCH_ARBITER=$ARBITER forge script script/LocalDemo.s.sol \
  --rpc-url "$RPC" --broadcast --private-key $ACC0_KEY 2>/dev/null)
escrow=$(echo "$out" | grep "BountyEscrow " | awk '{print $2}')
usdc=$(echo "$out" | grep "^  USDC " | awk '{print $2}')
held() { cast call "$usdc" 'balanceOf(address)(uint256)' "$1" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}'; }
echo "  escrow $escrow holds $(held "$escrow")"

echo "› the gym, pointed at it"
ARC_RPC_URL="$RPC" BENCH_DB=:memory: DEV_ALLOWANCE=5 \
  BENCH_ESCROW="$escrow" BENCH_ARBITER_KEY=$ARBITER_KEY PORT="$PORT" \
  bun run "$root/src/server.ts" >/tmp/bench-gym.log 2>&1 &
pids+=($!)
for _ in $(seq 1 40); do curl -sf -o /dev/null "http://localhost:$PORT/" && break; sleep 0.25; done

deadline=$(( ($(date +%s) + 604800) * 1000 ))
bid=$(curl -s -X POST "http://localhost:$PORT/bounties" \
  -H 'x-agent: agent:acme' -H 'content-type: application/json' \
  -d "{\"title\":\"Name it\",\"statement\":\"Return the constant.\",\"amount\":\"500.00\",\"deadline\":$deadline,\"escrowId\":\"1\",\"checker\":{\"kind\":\"equals\",\"value\":424242}}" \
  | grep -o '"id": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
echo "  posted $bid"

echo "› solving it"
curl -s -X POST "http://localhost:$PORT/bounties/$bid/solve" \
  -H "x-agent: $SOLVER" -H 'content-type: application/json' -d '{"answer":424242}' \
  | grep -o '"awardTx": *"[^"]*"' | head -1 | sed 's/^/  /'

after_escrow=$(held "$escrow"); after_solver=$(held "$SOLVER")
echo "  escrow now $after_escrow, solver now $after_solver"

if [ "$after_escrow" = "0" ] && [ "$after_solver" = "500000000" ]; then
  echo "✓ the money moved"
else
  echo "✗ the money did not move — see /tmp/bench-gym.log"
  grep -i awarding /tmp/bench-gym.log | head -3 || true
  exit 1
fi
