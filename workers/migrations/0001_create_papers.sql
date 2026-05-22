CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read')),
  arxiv_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);
CREATE INDEX IF NOT EXISTS idx_papers_updated_at ON papers(updated_at);
