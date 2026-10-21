export { canonicalize, hashContext } from "./hash.ts";
export { signOutput, verifySignature } from "./sign.ts";
export { verifyContext, triggerRollback, type VerifyResult } from "./verify.ts";
export { linkRecord, verifyChain, type ChainRow, type ChainVerdict } from "./chain.ts";
export { takeSnapshot, latestSnapshot, restoreSnapshot, stageHandoffFile, type SnapshotInfo, type RestoreResult, type StagedHandoff } from "./snapshot.ts";
export { buildCodeMap, dependentsOf, dependenciesOf, type CodeMap, type CodeFileEntry, type CodeSymbol, type ErrorRecord, type CodeMapOptions } from "./code-map.ts";
export { buildTraceGraph, filesForRequirement, requirementsForFile, requirementsAffectedBy, tokenize, type TraceGraph, type TraceInput, type TraceEdge, type FileRequirement } from "./traceability.ts";
