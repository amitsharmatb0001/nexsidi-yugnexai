export interface FeatureFlags {
  requireOtp: boolean;
  requirePayment: boolean;
  deployTarget: "local" | "gcp";
}

export interface GatewayDecision {
  decision: "proceed" | "review";
  feedback?: string;
}

export interface DagTask {
  id: string;
  description: string;
  complexity: number;
  dependsOn: string[];
}

export interface Dag {
  tasks: DagTask[];
}

export interface PipelineCheckpoint<T = unknown> {
  stage: string;
  data: T;
  writtenAt: string; // ISO timestamp
}
