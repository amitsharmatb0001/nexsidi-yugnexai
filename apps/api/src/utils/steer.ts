// Fix #3: Atomic STEER.md consumption
//
// Original design: "write STEER.md → file cleared after delivery"
// Race condition: Tilotma reads file while Riya still running → race on delete.
//
// Fix: rename to .STEER.processed (atomic on Linux/Windows NTFS) then read.
// Only one process wins the rename — any concurrent caller gets ENOENT, returns null.

import { existsSync, readFileSync, renameSync } from "fs";
import { resolve } from "path";

const STEER_PATH      = resolve(process.cwd(), "STEER.md");
const PROCESSED_PATH  = resolve(process.cwd(), ".STEER.processed");

export function consumeSteer(): string | null {
  if (!existsSync(STEER_PATH)) return null;
  try {
    renameSync(STEER_PATH, PROCESSED_PATH);          // atomic — only one winner
    return readFileSync(PROCESSED_PATH, "utf-8").trim();
  } catch {
    return null; // another process won the rename
  }
}
