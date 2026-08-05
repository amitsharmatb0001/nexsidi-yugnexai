import { filterSourceManifest, buildStage4Result } from "./activities/index.ts";
const stage4Result = buildStage4Result("simple1");
const manifest = filterSourceManifest(stage4Result);
console.log(manifest.filesWritten.join("\n"));
