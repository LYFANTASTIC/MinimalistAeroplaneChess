CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username citext NOT NULL UNIQUE,
  email citext NOT NULL UNIQUE,
  display_name varchar(16) NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.user_wallets (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  points_balance numeric(12, 2) NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.user_stats (
  user_id uuid PRIMARY KEY REFERENCES app.users(id) ON DELETE CASCADE,
  games_played bigint NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  games_won bigint NOT NULL DEFAULT 0 CHECK (games_won >= 0),
  planes_defeated bigint NOT NULL DEFAULT 0 CHECK (planes_defeated >= 0),
  happy_collisions bigint NOT NULL DEFAULT 0 CHECK (happy_collisions >= 0),
  lifetime_points_earned numeric(14, 2) NOT NULL DEFAULT 0 CHECK (lifetime_points_earned >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code varchar(4),
  status text NOT NULL DEFAULT 'playing' CHECK (status IN ('playing', 'finished', 'abandoned')),
  end_reason text,
  happy_mode boolean NOT NULL DEFAULT false,
  team_mode boolean NOT NULL DEFAULT false,
  piece_count smallint NOT NULL CHECK (piece_count BETWEEN 1 AND 4),
  launch_number text NOT NULL CHECK (launch_number IN ('even', '2', '4', '6')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  winner_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  winner_team_no smallint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.match_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES app.matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  seat smallint NOT NULL CHECK (seat BETWEEN 1 AND 4),
  team_no smallint,
  is_ai boolean NOT NULL,
  display_name_snapshot varchar(32) NOT NULL,
  placement smallint CHECK (placement IS NULL OR placement BETWEEN 1 AND 4),
  planes_defeated integer NOT NULL DEFAULT 0 CHECK (planes_defeated >= 0),
  happy_collisions integer NOT NULL DEFAULT 0 CHECK (happy_collisions >= 0),
  account_points_earned numeric(12, 2) NOT NULL DEFAULT 0 CHECK (account_points_earned >= 0),
  movement_distance integer NOT NULL DEFAULT 0 CHECK (movement_distance >= 0),
  bounce_distance integer NOT NULL DEFAULT 0 CHECK (bounce_distance >= 0),
  dice_statistics jsonb NOT NULL DEFAULT '{}'::jsonb,
  titles jsonb NOT NULL DEFAULT '[]'::jsonb,
  finished_at timestamptz,
  UNIQUE (match_id, seat),
  CHECK ((is_ai AND user_id IS NULL) OR NOT is_ai)
);

CREATE UNIQUE INDEX IF NOT EXISTS match_players_match_user_uidx
  ON app.match_players (match_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.match_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES app.matches(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL CHECK (sequence_no > 0),
  event_type text NOT NULL CHECK (event_type IN ('plane_defeated', 'happy_collision', 'game_finished')),
  actor_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES app.users(id) ON DELETE SET NULL,
  target_piece_index smallint CHECK (target_piece_index IS NULL OR target_piece_index BETWEEN 0 AND 3),
  reward_points numeric(12, 2) NOT NULL DEFAULT 0 CHECK (reward_points >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS app.points_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL CHECK (amount <> 0),
  reason text NOT NULL CHECK (reason IN ('plane_defeated', 'happy_collision', 'migration', 'admin_adjustment')),
  match_id uuid REFERENCES app.matches(id) ON DELETE SET NULL,
  match_event_id uuid REFERENCES app.match_events(id) ON DELETE SET NULL,
  balance_after numeric(12, 2) NOT NULL CHECK (balance_after >= 0),
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS matches_started_at_idx ON app.matches (started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS match_players_user_history_idx
  ON app.match_players (user_id, match_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS points_ledger_user_history_idx
  ON app.points_ledger (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS match_events_actor_idx
  ON app.match_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

