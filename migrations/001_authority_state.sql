CREATE TABLE admissary_authority_state (
  kind text PRIMARY KEY CHECK (kind IN ('product', 'assurance')),
  revision bigint NOT NULL CHECK (revision >= 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((payload->>'revision')::bigint = revision)
);
