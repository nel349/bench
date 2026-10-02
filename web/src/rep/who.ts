/** Who is being looked up: an ERC-8004 id is digits, an address is 0x and forty hex digits. */
export type Who =
  | { readonly kind: "identity"; readonly id: string }
  | { readonly kind: "address"; readonly address: string }
  | { readonly kind: "neither" };

/** Reads what somebody typed into the rep lookup. Zero is not an id; the registry starts at one. */
export function whoIs(text: string): Who {
  const t = text.trim();
  if (/^\d{1,78}$/.test(t) && BigInt(t) > 0n) return { kind: "identity", id: t };
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return { kind: "address", address: t };
  return { kind: "neither" };
}
