const FNV_OFFSET_BASIS_A = 0x811c9dc5;
const FNV_OFFSET_BASIS_B = 0x9e3779b9; // distinct seed so the two passes diverge
const FNV_PRIME = 0x01000193;

function fnv1a32(input: string, offsetBasis: number): number {
  let hash = offsetBasis;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * Deterministic, synchronous, non-cryptographic hash, hex-encoded. Two
 * 32-bit FNV-1a passes with different seeds, concatenated into a 64-bit
 * (16 hex char) digest.
 *
 * Used to derive local dedup identity keys (design.md §3), which also
 * become the `entries` object store's IndexedDB primary key. `putEntry` is
 * an upsert, so the property that actually matters here is COLLISION
 * RESISTANCE at expected entry volumes — a collision silently overwrites an
 * unrelated article with no error — not cryptographic strength (a dedup key
 * is never a security boundary). A single 32-bit FNV-1a pass (~4*10^9
 * buckets) did not leave enough headroom for that; 64 bits (~1.8*10^19
 * buckets) does, while staying synchronous and dependency-free, which
 * `domain/**` requires (design.md §1 — zero imports; Web Crypto's
 * `subtle.digest` is async-only).
 */
export function shortHash(input: string): string {
  const high = fnv1a32(input, FNV_OFFSET_BASIS_A);
  const low = fnv1a32(input, FNV_OFFSET_BASIS_B);
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}
