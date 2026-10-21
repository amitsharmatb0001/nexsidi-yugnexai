// Patent claim 10: a hash chain wherein each context object contains the SHA-256 hashes of ALL predecessor context
// objects, enabling complete audit trail reconstruction. Each record of a project stores the ordered list of every
// earlier record's context hash and a chain hash over that list plus its own hash, so a record that is altered,
// removed or reordered breaks every record after it.
import { createHash } from "node:crypto";
import { canonicalize } from "./hash.ts";

export interface ChainRow {
  chainSeq: number;
  contextHash: string;
  predecessorHashes: string[];
  chainHash: string;
}

const chainHashOf = (predecessorHashes: string[], contextHash: string) =>
  createHash("sha256").update(canonicalize({ predecessors: predecessorHashes, context: contextHash })).digest("hex");

/** What a new record stores, given the context hashes of every earlier record of the project (oldest first). */
export function linkRecord(earlierContextHashes: string[], contextHash: string): { predecessorHashes: string[]; chainHash: string } {
  const predecessorHashes = [...earlierContextHashes];
  return { predecessorHashes, chainHash: chainHashOf(predecessorHashes, contextHash) };
}

export interface ChainVerdict {
  valid: boolean;
  checked: number;
  brokenAt?: number;
  reason?: "predecessors_mismatch" | "chain_hash_mismatch";
}

/** Walks a project's records in order and checks that each names exactly the records before it and its chain hash holds. */
export function verifyChain(rows: ChainRow[]): ChainVerdict {
  for (const [i, row] of rows.entries()) {
    const expected = rows.slice(0, i).map((r) => r.contextHash);
    const same = row.predecessorHashes.length === expected.length && row.predecessorHashes.every((x, k) => x === expected[k]);
    if (!same) return { valid: false, checked: i, brokenAt: i, reason: "predecessors_mismatch" };
    if (chainHashOf(row.predecessorHashes, row.contextHash) !== row.chainHash) return { valid: false, checked: i, brokenAt: i, reason: "chain_hash_mismatch" };
  }
  return { valid: true, checked: rows.length };
}
