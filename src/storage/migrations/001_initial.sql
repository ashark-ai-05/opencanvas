-- Spec §4 schemas. Tables are created here; populated by indexers in Plan 3+.

CREATE TABLE chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  uri          TEXT NOT NULL,
  body         TEXT NOT NULL,
  meta_json    TEXT,
  embedder_id  TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (source_id, uri)
);

CREATE INDEX idx_chunks_source ON chunks (source_id);
CREATE INDEX idx_chunks_kind ON chunks (kind);

CREATE TABLE symbols (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    TEXT NOT NULL,
  file         TEXT NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  lang         TEXT NOT NULL,
  refs_json    TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_symbols_name ON symbols (name);
CREATE INDEX idx_symbols_source ON symbols (source_id);

CREATE TABLE links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_chunk_id   INTEGER NOT NULL,
  to_uri          TEXT NOT NULL,
  link_type       TEXT NOT NULL,
  confidence      REAL NOT NULL,
  FOREIGN KEY (from_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE INDEX idx_links_from ON links (from_chunk_id);
CREATE INDEX idx_links_to ON links (to_uri);

CREATE TABLE prompt_cache (
  key           TEXT PRIMARY KEY,
  response      TEXT NOT NULL,
  tokens_in     INTEGER NOT NULL,
  tokens_out    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  ttl_ms        INTEGER NOT NULL,
  profile_id    TEXT NOT NULL
);

CREATE INDEX idx_prompt_cache_profile ON prompt_cache (profile_id);

CREATE TABLE result_cache (
  uri           TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  shape_json    TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL,
  ttl_ms        INTEGER NOT NULL
);

CREATE TABLE sync_state (
  source_id        TEXT PRIMARY KEY,
  last_synced_at   INTEGER NOT NULL,
  cursor           TEXT
);

CREATE VIRTUAL TABLE fts USING fts5 (
  body,
  content='chunks',
  content_rowid='id'
);

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO fts (rowid, body) VALUES (new.id, new.body);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO fts (fts, rowid, body) VALUES ('delete', old.id, old.body);
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO fts (fts, rowid, body) VALUES ('delete', old.id, old.body);
  INSERT INTO fts (rowid, body) VALUES (new.id, new.body);
END;

-- Vector index via sqlite-vec. Dimension matches the default bundled embedder
-- (bge-small-en-v1.5 = 384). Re-creating the table at a different dim
-- requires a re-index -- handled in a future migration if/when we change defaults.
CREATE VIRTUAL TABLE embeddings USING vec0 (
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
