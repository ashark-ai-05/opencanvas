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
  /**
   * Optional. When present and false, the UI should skip KB search so the
   * first chat turn doesn't sit on "Searching…" while a local model loads.
   * Absent = always ready (API embedders).
   */
  isReady?(): boolean;
}
