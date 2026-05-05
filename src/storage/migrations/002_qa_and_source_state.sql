-- Migration 002 — QA enrichment + per-project source state.
--
-- qa_pairs: stores the LLM-synthesised 12 hypothetical user queries plus a
-- factual response paragraph for each enriched chunk. The embeddings table
-- stores the embedding of those 12 queries (NOT the chunk body) so vector
-- recall is biased toward the way users actually phrase questions. The
-- chunk body is still indexed by FTS5 unchanged.
--
-- source_state: per-project, per-source cursor + counts so a re-ingest is
-- idempotent and fast. The (project, source_id) compound primary key lets
-- one DB host multiple KBs without colliding source IDs.

CREATE TABLE qa_pairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  queries_json TEXT NOT NULL,
  response_text TEXT NOT NULL,
  model TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  UNIQUE (chunk_id),
  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);
CREATE INDEX idx_qa_pairs_hash ON qa_pairs (content_hash);

CREATE TABLE source_state (
  project TEXT NOT NULL,
  source_id TEXT NOT NULL,
  cursor TEXT,
  last_run_at INTEGER NOT NULL,
  doc_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project, source_id)
);
CREATE INDEX idx_source_state_project ON source_state (project);
