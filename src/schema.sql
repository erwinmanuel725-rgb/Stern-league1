CREATE TABLE IF NOT EXISTS players (
  id smallint PRIMARY KEY,
  name text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('league','mod','bettor')),
  base_j int NOT NULL DEFAULT 0, base_v int NOT NULL DEFAULT 0, base_d int NOT NULL DEFAULT 0,
  base_l int NOT NULL DEFAULT 0, base_bp int NOT NULL DEFAULT 0, base_bc int NOT NULL DEFAULT 0,
  balance int NOT NULL DEFAULT 0,
  claim_hash text,
  claimed_at timestamptz
);
CREATE TABLE IF NOT EXISTS matches (
  id int PRIMARY KEY,
  matchday smallint NOT NULL,
  home smallint NOT NULL REFERENCES players(id),
  away smallint NOT NULL REFERENCES players(id),
  day_in_md smallint NOT NULL,
  hour smallint NOT NULL,
  referee text NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_md ON matches(matchday);
CREATE TABLE IF NOT EXISTS results (
  match_id int PRIMARY KEY REFERENCES matches(id),
  home_goals smallint NOT NULL CHECK (home_goals >= 0),
  away_goals smallint NOT NULL CHECK (away_goals >= 0),
  forfeit smallint NOT NULL DEFAULT 0 CHECK (forfeit IN (0,1,2)),
  voided boolean NOT NULL DEFAULT false,
  entered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS history_matches (
  id serial PRIMARY KEY,
  matchday smallint NOT NULL,
  home_name text NOT NULL, away_name text NOT NULL,
  home_idx smallint, away_idx smallint,
  hs smallint NOT NULL, "as" smallint NOT NULL,
  forfeit smallint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bets (
  id bigserial PRIMARY KEY,
  player_id smallint NOT NULL REFERENCES players(id),
  match_id int REFERENCES matches(id),
  outcome smallint CHECK (outcome IN (0,1,2)),
  stake int NOT NULL CHECK (stake > 0 AND stake <= 1000),
  odd double precision NOT NULL,
  status char(1) NOT NULL DEFAULT 'p' CHECK (status IN ('p','w','l','v')),
  delta int,
  type varchar(10) NOT NULL DEFAULT 'single' CHECK (type IN ('single','combo')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS bets_match ON bets(match_id);
CREATE INDEX IF NOT EXISTS bets_player ON bets(player_id);
CREATE TABLE IF NOT EXISTS bet_legs (
  id bigserial PRIMARY KEY,
  bet_id bigint NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  match_id int NOT NULL REFERENCES matches(id),
  outcome smallint NOT NULL CHECK (outcome IN (0,1,2)),
  odd double precision NOT NULL,
  status char(1) NOT NULL DEFAULT 'p' CHECK (status IN ('p','w','l','v')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bet_id, match_id)
);
CREATE INDEX IF NOT EXISTS bet_legs_match ON bet_legs(match_id);
CREATE INDEX IF NOT EXISTS bet_legs_bet ON bet_legs(bet_id);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id bigserial PRIMARY KEY,
  player_id smallint NOT NULL REFERENCES players(id),
  delta int NOT NULL,
  balance_after int NOT NULL,
  reason text NOT NULL,
  bet_id bigint, match_id int,
  note text,
  actor text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wtx_player ON wallet_transactions(player_id, id DESC);
CREATE TABLE IF NOT EXISTS admin_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  ip text, action text NOT NULL, success boolean NOT NULL DEFAULT true,
  detail jsonb
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip text
);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);
