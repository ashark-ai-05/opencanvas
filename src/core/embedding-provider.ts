export type EmbeddingProbeResult = {
  ok: boolean;
  latencyMs?: number;
  dims?: number;
  error?: string;
};

export type EmbeddingCapabilities = {
  batchSize: number;
  offline: boolean;
};

export interface EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dims: number;
  readonly capabilities: EmbeddingCapabilities;
  embed(texts: string[]): Promise<Float32Array[]>;
  probe(): Promise<EmbeddingProbeResult>;
}
