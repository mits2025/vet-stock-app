CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  claim_token_hash TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  gcash_sender_name TEXT NOT NULL,
  gcash_reference TEXT NOT NULL UNIQUE,
  amount_centavos INTEGER NOT NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  rejection_reason TEXT,
  license_token TEXT,
  license_expires_at TEXT
);

CREATE INDEX IF NOT EXISTS payment_requests_status_submitted
ON payment_requests(status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS payment_requests_installation_reviewed
ON payment_requests(installation_id, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  payment_request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_request_created
ON audit_events(payment_request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS request_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS request_rate_limits_expiry
ON request_rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS security_events_type_created
ON security_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS review_locks (
  installation_id TEXT PRIMARY KEY,
  lock_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS review_locks_expiry
ON review_locks(expires_at);
