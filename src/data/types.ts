export type ID = string;

export type League = {
  id: ID;
  name: string;
  status: 'upcoming' | 'active' | 'completed';
  current_round: number;
};

export type Round = {
  id: ID;
  league_id: ID;
  round_number: number;
  name: string;
  pick_deadline_utc: string;
  status: 'upcoming' | 'locked' | 'completed';
};

export type Team = {
  id: ID;
  league_id: ID;
  name: string;
  code: string;
  logo_url?: string;
};

export type Player = {
  id: ID;
  display_name: string;
};

export type Membership = {
  id: ID;
  league_id: ID;
  player_id: ID;
  is_active: boolean;
  joined_at: string;
  eliminated_at?: string;
  final_position?: number;
};

export type Pick = {
  id: ID;
  league_id: ID;
  round_id: ID;
  player_id: ID;
  team_id: ID;
  created_at: string;
  status: 'pending' | 'through' | 'eliminated' | 'no-pick';
  reason?: 'loss' | 'draw' | 'no-pick';
};

export type Fixture = {
  id: ID;
  round_id: ID;
  home_team_id: ID;
  away_team_id: ID;
  kickoff_utc?: string;
  result: 'home_win' | 'away_win' | 'draw' | 'not_set';
  winning_team_id?: ID;
};
