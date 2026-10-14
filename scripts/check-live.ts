/**
 * Checks both live gyms from outside, as a stranger's client would, and every link the README and
 * docs/PROOF.md give.
 *
 * Each gym says the chain it is on, names the wallet with its own network, serves its seven exercises
 * and its standings, and the runs PROOF.md names still carry the record transactions it gives. Then
 * every link in both files is opened. Needs the network, so it is not in `gate`:
 *
 *     bun run check:live
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Check = { readonly what: string; readonly ok: boolean; readonly detail: string };
const checks: Check[] = [];
const check = (what: string, ok: boolean, detail = ""): void => { checks.push({ what, ok, detail }); };

async function json(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

const GYMS = [
  { name: "mainnet", url: "https://bench-ai.dev", chainId: 5042, network: "arc" },
  { name: "testnet", url: "https://testnet.bench-ai.dev", chainId: 5042002, network: "arcTestnet" },
] as const;

for (const gym of GYMS) {
  try {
    const settings = await json(`${gym.url}/settings`);
    check(`${gym.name}: on chain ${gym.chainId}`, settings.chainId === gym.chainId, String(settings.chainId));
    const wallet = settings.wallet === null ? null : new URL(settings.wallet);
    check(`${gym.name}: names the wallet, opening on ${gym.network}`, wallet?.searchParams.get("network") === gym.network, String(settings.wallet));
    const problems = await json(`${gym.url}/problems`);
    const list = Array.isArray(problems) ? problems : problems.problems;
    check(`${gym.name}: serves seven exercises`, list?.length === 7, String(list?.length));
    const standings = await json(`${gym.url}/standings`);
    check(`${gym.name}: serves its standings`, Array.isArray(standings.agents) && standings.agents.length > 0, `${standings.agents?.length} agents`);
    const page = await fetch(gym.url, { signal: AbortSignal.timeout(20_000), headers: { accept: "text/html" } });
    check(`${gym.name}: serves its page`, page.ok && (await page.text()).includes("<div id=\"root\""), String(page.status));
  } catch (cause) {
    check(`${gym.name}: answers`, false, String(cause));
  }
}

/** The runs PROOF.md names, with the record transaction it gives for each. */
const RECORDED = [
  { url: "https://bench-ai.dev/attempts/a1", tx: "0xd21ec9f23887123fb0c5407d4f9cf3901c23b87422463708242229955ef78018" },
  { url: "https://bench-ai.dev/attempts/a5", tx: "0xd40d2ed35776a89b8af5ce25aa287665150c14620ffdf25b541607d0478e37ba" },
  { url: "https://testnet.bench-ai.dev/attempts/a10", tx: "0xb11116dfba6a9c548716780ca91d27e472ea38816b13e0595226bc48913b09d3" },
];
for (const run of RECORDED) {
  try {
    const attempt = await json(run.url);
    check(`${run.url}: solved, with the record PROOF.md gives`, attempt.outcome === "solved" && attempt.ranked?.tx === run.tx, `${attempt.outcome} ${attempt.ranked?.tx}`);
  } catch (cause) {
    check(`${run.url}: answers`, false, String(cause));
  }
}

const root = join(import.meta.dir, "..");
const links = new Set<string>();
for (const file of ["README.md", "docs/PROOF.md"]) {
  for (const match of readFileSync(join(root, file), "utf8").matchAll(/https:\/\/[^\s)<>`|]+/g)) links.add(match[0].replace(/[.,]$/, ""));
}
const opened = await Promise.all([...links].map(async (url) => {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
    return { url, ok: res.ok, status: res.status };
  } catch (cause) {
    return { url, ok: false, status: String(cause) };
  }
}));
const broken = opened.filter((link) => !link.ok);
check(`every link in README.md and docs/PROOF.md opens (${opened.length})`, broken.length === 0, broken.map((link) => `${link.status} ${link.url}`).join("; "));

for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.what}${c.detail && !c.ok ? `: ${c.detail}` : ""}`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed} of ${checks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
