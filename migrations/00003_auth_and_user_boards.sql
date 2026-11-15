CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    oidc_sub TEXT UNIQUE,
    username TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    groups JSONB NOT NULL DEFAULT '[]'::jsonb,
    board_seeded BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    oidc_sid TEXT NOT NULL DEFAULT '',
    id_token_enc BYTEA,
    refresh_token_enc BYTEA,
    access_token_expires_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_oidc_sid ON sessions(oidc_sid) WHERE oidc_sid <> '';
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS oidc_revoked_jtis (
    jti TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oidc_revoked_jtis_expires ON oidc_revoked_jtis(expires_at);

-- Seed default local user for non-OIDC mode and assign any pre-existing data
INSERT INTO users (id, oidc_sub, username, display_name, board_seeded)
VALUES ('00000000-0000-0000-0000-000000000001', NULL, 'local', 'Local User', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Per-user Workspaces
ALTER TABLE workspaces
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
UPDATE workspaces SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;
ALTER TABLE workspaces ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON workspaces(user_id);

-- Per-user Integrations
ALTER TABLE integrations
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
UPDATE integrations SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;
ALTER TABLE integrations ALTER COLUMN user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_integrations_user_id ON integrations(user_id);

-- Per-user Preferences with composite primary key (user_id, key)
ALTER TABLE preferences
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
UPDATE preferences SET user_id = '00000000-0000-0000-0000-000000000001' WHERE user_id IS NULL;
ALTER TABLE preferences ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE preferences DROP CONSTRAINT IF EXISTS preferences_pkey;
ALTER TABLE preferences ADD PRIMARY KEY (user_id, key);
