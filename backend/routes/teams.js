const express = require('express');
const crypto = require('crypto');
const db = require('../database');
const { getOverallPercentage } = require('../services/challengeProgress');

const router = express.Router();

// ========== ACCESS CONTROL HELPERS ==========

async function requireTeamMember(req, res, next) {
  const { teamId } = req.params;
  const userId = req.user.userId;

  const member = await db.get(
    `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );

  if (!member) {
    return res.status(403).json({ error: 'You are not a member of this team' });
  }

  req.teamRole = member.role;
  next();
}

async function requireTeamLeader(req, res, next) {
  const { teamId } = req.params;
  const userId = req.user.userId;

  const member = await db.get(
    `SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2`,
    [teamId, userId]
  );

  if (!member || member.role !== 'leader') {
    return res.status(403).json({ error: 'Only team leaders can perform this action' });
  }

  req.teamRole = 'leader';
  next();
}

function generateInviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ========== TEAM ENDPOINTS ==========

// POST /api/teams - Create team
router.post('/', async (req, res) => {
  try {
    const { name, description, max_members } = req.body;
    const userId = req.user.userId;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    const invite_code = generateInviteCode();

    const result = await db.run(
      `INSERT INTO teams (name, description, invite_code, created_by, max_members)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name.trim(), description || null, invite_code, userId, max_members || 15]
    );

    const teamId = result.id;

    // Creator becomes leader
    await db.run(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'leader')`,
      [teamId, userId]
    );

    const team = await db.get(`SELECT * FROM teams WHERE id = $1`, [teamId]);
    res.status(201).json(team);
  } catch (err) {
    console.error('Create team error:', err);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

// GET /api/teams - List my teams
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;

    const teams = await db.all(
      `SELECT t.*, tm.role as my_role,
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
        (SELECT COUNT(*) FROM challenges WHERE team_id = t.id AND is_active = true
          AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE) as active_challenges
       FROM teams t
       JOIN team_members tm ON t.id = tm.team_id AND tm.user_id = $1
       WHERE t.is_active = true
       ORDER BY t.created_at DESC`,
      [userId]
    );

    res.json(teams);
  } catch (err) {
    console.error('List teams error:', err);
    res.status(500).json({ error: 'Failed to list teams' });
  }
});

// GET /api/teams/my-active-challenges - My challenges across all teams
router.get('/my-active-challenges', async (req, res) => {
  try {
    const userId = req.user.userId;

    const challenges = await db.all(
      `SELECT c.*, t.name as team_name,
        cp.percentage as today_percentage,
        (SELECT COALESCE(AVG(cpx.percentage), 0)
         FROM challenge_progress cpx
         WHERE cpx.challenge_id = c.id AND cpx.user_id = $1) as overall_percentage
       FROM challenges c
       JOIN teams t ON c.team_id = t.id
       JOIN challenge_participants cprt ON c.id = cprt.challenge_id AND cprt.user_id = $1
       LEFT JOIN challenge_progress cp ON c.id = cp.challenge_id AND cp.user_id = $1 AND cp.date = CURRENT_DATE
       WHERE c.is_active = true
         AND c.start_date <= CURRENT_DATE
         AND c.end_date >= CURRENT_DATE
       ORDER BY c.end_date ASC
       LIMIT 5`,
      [userId]
    );

    // Get rank for each challenge
    for (const challenge of challenges) {
      const leaderboard = await db.all(
        `SELECT cp2.user_id, COALESCE(AVG(cp2.percentage), 0) as avg_pct
         FROM challenge_participants cprt2
         LEFT JOIN challenge_progress cp2 ON cprt2.challenge_id = cp2.challenge_id AND cprt2.user_id = cp2.user_id
         WHERE cprt2.challenge_id = $1
         GROUP BY cp2.user_id
         ORDER BY avg_pct DESC`,
        [challenge.id]
      );
      const rank = leaderboard.findIndex(r => r.user_id === userId) + 1;
      challenge.my_rank = rank || leaderboard.length;
      challenge.total_participants = leaderboard.length;
    }

    res.json(challenges);
  } catch (err) {
    console.error('My active challenges error:', err);
    res.status(500).json({ error: 'Failed to fetch active challenges' });
  }
});

// GET /api/teams/:teamId - Team details
router.get('/:teamId', requireTeamMember, async (req, res) => {
  try {
    const { teamId } = req.params;

    const team = await db.get(`SELECT * FROM teams WHERE id = $1`, [teamId]);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const members = await db.all(
      `SELECT tm.*, u.name, u.email
       FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1
       ORDER BY tm.role DESC, tm.joined_at ASC`,
      [teamId]
    );

    const challenges = await db.all(
      `SELECT c.*,
        (SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = c.id) as participant_count
       FROM challenges c
       WHERE c.team_id = $1
       ORDER BY c.is_active DESC, c.end_date DESC`,
      [teamId]
    );

    res.json({
      ...team,
      my_role: req.teamRole,
      members,
      challenges
    });
  } catch (err) {
    console.error('Team details error:', err);
    res.status(500).json({ error: 'Failed to fetch team details' });
  }
});

// PUT /api/teams/:teamId - Update team
router.put('/:teamId', requireTeamLeader, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Team name is required' });
    }

    await db.run(
      `UPDATE teams SET name = $1, description = $2 WHERE id = $3`,
      [name.trim(), description || null, teamId]
    );

    const team = await db.get(`SELECT * FROM teams WHERE id = $1`, [teamId]);
    res.json(team);
  } catch (err) {
    console.error('Update team error:', err);
    res.status(500).json({ error: 'Failed to update team' });
  }
});

// DELETE /api/teams/:teamId - Delete team
router.delete('/:teamId', requireTeamLeader, async (req, res) => {
  try {
    const { teamId } = req.params;
    await db.run(`UPDATE teams SET is_active = false WHERE id = $1`, [teamId]);
    res.json({ message: 'Team deleted' });
  } catch (err) {
    console.error('Delete team error:', err);
    res.status(500).json({ error: 'Failed to delete team' });
  }
});

// POST /api/teams/join - Join via invite code
router.post('/join', async (req, res) => {
  try {
    const { invite_code } = req.body;
    const userId = req.user.userId;

    if (!invite_code) {
      return res.status(400).json({ error: 'Invite code is required' });
    }

    const team = await db.get(
      `SELECT * FROM teams WHERE invite_code = $1 AND is_active = true`,
      [invite_code.toUpperCase()]
    );

    if (!team) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    if (team.invite_expires_at && new Date(team.invite_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Invite code has expired' });
    }

    // Check if already a member
    const existing = await db.get(
      `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [team.id, userId]
    );
    if (existing) {
      return res.status(409).json({ error: 'You are already a member of this team' });
    }

    // Check member limit
    const memberCount = await db.get(
      `SELECT COUNT(*) as cnt FROM team_members WHERE team_id = $1`,
      [team.id]
    );
    if (parseInt(memberCount.cnt) >= team.max_members) {
      return res.status(409).json({ error: 'Team is full' });
    }

    await db.run(
      `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'member')`,
      [team.id, userId]
    );

    res.json({ message: 'Joined team successfully', team });
  } catch (err) {
    console.error('Join team error:', err);
    res.status(500).json({ error: 'Failed to join team' });
  }
});

// DELETE /api/teams/:teamId/leave - Leave team
router.delete('/:teamId/leave', requireTeamMember, async (req, res) => {
  try {
    const { teamId } = req.params;
    const userId = req.user.userId;

    if (req.teamRole === 'leader') {
      // Check if there are other members to transfer leadership
      const otherMembers = await db.all(
        `SELECT user_id FROM team_members WHERE team_id = $1 AND user_id != $2`,
        [teamId, userId]
      );
      if (otherMembers.length > 0) {
        return res.status(400).json({
          error: 'Leaders must transfer leadership before leaving. Promote another member first.'
        });
      }
      // Last member — deactivate team
      await db.run(`UPDATE teams SET is_active = false WHERE id = $1`, [teamId]);
    }

    await db.run(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId]
    );

    // Remove from challenge participants too
    await db.run(
      `DELETE FROM challenge_participants
       WHERE user_id = $1 AND challenge_id IN (SELECT id FROM challenges WHERE team_id = $2)`,
      [userId, teamId]
    );

    res.json({ message: 'Left team successfully' });
  } catch (err) {
    console.error('Leave team error:', err);
    res.status(500).json({ error: 'Failed to leave team' });
  }
});

// POST /api/teams/:teamId/regenerate-invite - New invite code
router.post('/:teamId/regenerate-invite', requireTeamLeader, async (req, res) => {
  try {
    const { teamId } = req.params;
    const newCode = generateInviteCode();

    await db.run(
      `UPDATE teams SET invite_code = $1 WHERE id = $2`,
      [newCode, teamId]
    );

    res.json({ invite_code: newCode });
  } catch (err) {
    console.error('Regenerate invite error:', err);
    res.status(500).json({ error: 'Failed to regenerate invite code' });
  }
});

// PUT /api/teams/:teamId/members/:userId/role - Promote/demote
router.put('/:teamId/members/:userId/role', requireTeamLeader, async (req, res) => {
  try {
    const { teamId, userId } = req.params;
    const { role } = req.body;

    if (!['leader', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be leader or member' });
    }

    const member = await db.get(
      `SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId]
    );

    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    await db.run(
      `UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3`,
      [role, teamId, userId]
    );

    res.json({ message: `Member role updated to ${role}` });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// DELETE /api/teams/:teamId/members/:userId - Kick member
router.delete('/:teamId/members/:userId', requireTeamLeader, async (req, res) => {
  try {
    const { teamId, userId } = req.params;

    // Can't kick yourself
    if (parseInt(userId) === req.user.userId) {
      return res.status(400).json({ error: 'Cannot kick yourself. Use leave instead.' });
    }

    await db.run(
      `DELETE FROM team_members WHERE team_id = $1 AND user_id = $2`,
      [teamId, userId]
    );

    // Remove from challenges
    await db.run(
      `DELETE FROM challenge_participants
       WHERE user_id = $1 AND challenge_id IN (SELECT id FROM challenges WHERE team_id = $2)`,
      [userId, teamId]
    );

    res.json({ message: 'Member removed' });
  } catch (err) {
    console.error('Kick member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// ========== CHALLENGE ENDPOINTS ==========

// POST /api/teams/:teamId/challenges - Create challenge
router.post('/:teamId/challenges', requireTeamLeader, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { name, description, metric_type, target_value, target_unit, start_date, end_date } = req.body;

    if (!name || !metric_type || !target_value || !target_unit || !start_date || !end_date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const validMetrics = ['calories_burned', 'steps', 'water_intake', 'protein_goal', 'workout_count', 'sleep_hours'];
    if (!validMetrics.includes(metric_type)) {
      return res.status(400).json({ error: 'Invalid metric type' });
    }

    if (new Date(end_date) <= new Date(start_date)) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    const result = await db.run(
      `INSERT INTO challenges (team_id, name, description, metric_type, target_value, target_unit, start_date, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [teamId, name.trim(), description || null, metric_type, target_value, target_unit, start_date, end_date, req.user.userId]
    );

    // Auto-join the creator
    await db.run(
      `INSERT INTO challenge_participants (challenge_id, user_id) VALUES ($1, $2)`,
      [result.id, req.user.userId]
    );

    const challenge = await db.get(`SELECT * FROM challenges WHERE id = $1`, [result.id]);
    res.status(201).json(challenge);
  } catch (err) {
    console.error('Create challenge error:', err);
    res.status(500).json({ error: 'Failed to create challenge' });
  }
});

// GET /api/teams/:teamId/challenges - List challenges
router.get('/:teamId/challenges', requireTeamMember, async (req, res) => {
  try {
    const { teamId } = req.params;
    const { status } = req.query;
    const userId = req.user.userId;

    let whereClause = 'c.team_id = $1';
    if (status === 'active') {
      whereClause += ` AND c.is_active = true AND c.start_date <= CURRENT_DATE AND c.end_date >= CURRENT_DATE`;
    } else if (status === 'completed') {
      whereClause += ` AND (c.end_date < CURRENT_DATE OR c.is_active = false)`;
    } else if (status === 'upcoming') {
      whereClause += ` AND c.start_date > CURRENT_DATE AND c.is_active = true`;
    }

    const challenges = await db.all(
      `SELECT c.*,
        (SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = c.id) as participant_count,
        (SELECT 1 FROM challenge_participants WHERE challenge_id = c.id AND user_id = $2) as joined
       FROM challenges c
       WHERE ${whereClause}
       ORDER BY c.start_date DESC`,
      [teamId, userId]
    );

    res.json(challenges);
  } catch (err) {
    console.error('List challenges error:', err);
    res.status(500).json({ error: 'Failed to list challenges' });
  }
});

// GET /api/teams/:teamId/challenges/:challengeId - Challenge detail
router.get('/:teamId/challenges/:challengeId', requireTeamMember, async (req, res) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user.userId;

    const challenge = await db.get(
      `SELECT c.*,
        (SELECT COUNT(*) FROM challenge_participants WHERE challenge_id = c.id) as participant_count
       FROM challenges c WHERE c.id = $1`,
      [challengeId]
    );

    if (!challenge) return res.status(404).json({ error: 'Challenge not found' });

    // My progress
    const myProgress = await db.all(
      `SELECT date, current_value, percentage
       FROM challenge_progress
       WHERE challenge_id = $1 AND user_id = $2
       ORDER BY date DESC`,
      [challengeId, userId]
    );

    const overallPct = await getOverallPercentage(challengeId, userId);

    // Check if joined
    const joined = await db.get(
      `SELECT 1 FROM challenge_participants WHERE challenge_id = $1 AND user_id = $2`,
      [challengeId, userId]
    );

    res.json({
      ...challenge,
      joined: !!joined,
      my_progress: myProgress,
      my_overall_percentage: overallPct
    });
  } catch (err) {
    console.error('Challenge detail error:', err);
    res.status(500).json({ error: 'Failed to fetch challenge' });
  }
});

// POST /api/teams/:teamId/challenges/:challengeId/join - Join challenge
router.post('/:teamId/challenges/:challengeId/join', requireTeamMember, async (req, res) => {
  try {
    const { challengeId } = req.params;
    const userId = req.user.userId;

    const challenge = await db.get(`SELECT * FROM challenges WHERE id = $1`, [challengeId]);
    if (!challenge) return res.status(404).json({ error: 'Challenge not found' });

    if (!challenge.is_active) {
      return res.status(400).json({ error: 'Challenge is no longer active' });
    }

    const existing = await db.get(
      `SELECT 1 FROM challenge_participants WHERE challenge_id = $1 AND user_id = $2`,
      [challengeId, userId]
    );
    if (existing) {
      return res.status(409).json({ error: 'Already joined this challenge' });
    }

    await db.run(
      `INSERT INTO challenge_participants (challenge_id, user_id) VALUES ($1, $2)`,
      [challengeId, userId]
    );

    res.json({ message: 'Joined challenge' });
  } catch (err) {
    console.error('Join challenge error:', err);
    res.status(500).json({ error: 'Failed to join challenge' });
  }
});

// DELETE /api/teams/:teamId/challenges/:challengeId - Delete challenge
router.delete('/:teamId/challenges/:challengeId', requireTeamLeader, async (req, res) => {
  try {
    const { challengeId } = req.params;
    await db.run(`UPDATE challenges SET is_active = false WHERE id = $1`, [challengeId]);
    res.json({ message: 'Challenge deleted' });
  } catch (err) {
    console.error('Delete challenge error:', err);
    res.status(500).json({ error: 'Failed to delete challenge' });
  }
});

// ========== LEADERBOARD & STATS ==========

// GET /api/teams/:teamId/challenges/:challengeId/leaderboard
router.get('/:teamId/challenges/:challengeId/leaderboard', requireTeamMember, async (req, res) => {
  try {
    const { challengeId } = req.params;

    // Privacy: only return name + percentage, never raw values
    const leaderboard = await db.all(
      `SELECT u.name, u.id as user_id,
        COALESCE(AVG(cp.percentage), 0) as avg_percentage
       FROM challenge_participants cprt
       JOIN users u ON cprt.user_id = u.id
       LEFT JOIN challenge_progress cp ON cprt.challenge_id = cp.challenge_id AND cprt.user_id = cp.user_id
       WHERE cprt.challenge_id = $1
       GROUP BY u.id, u.name
       ORDER BY avg_percentage DESC`,
      [challengeId]
    );

    const ranked = leaderboard.map((entry, i) => ({
      rank: i + 1,
      name: entry.name,
      user_id: entry.user_id,
      percentage: Math.round(entry.avg_percentage * 100) / 100
    }));

    res.json(ranked);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /api/teams/:teamId/members/:userId/stats - Leader-only: full health stats
router.get('/:teamId/members/:userId/stats', requireTeamLeader, async (req, res) => {
  try {
    const { userId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    // Check the target user is a member
    const member = await db.get(
      `SELECT tm.*, u.name, u.email FROM team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1 AND tm.user_id = $2`,
      [req.params.teamId, userId]
    );

    if (!member) return res.status(404).json({ error: 'Member not found' });

    // Gather full health stats
    const [whoop, food, water, workouts, sleep, weight] = await Promise.all([
      db.get(`SELECT * FROM whoop_metrics WHERE user_id = $1 AND date = $2`, [userId, today]),
      db.all(`SELECT * FROM food_logs WHERE user_id = $1 AND DATE(timestamp) = $2`, [userId, today]),
      db.get(`SELECT COALESCE(SUM(amount), 0) as total FROM water_logs WHERE user_id = $1 AND DATE(timestamp) = $2`, [userId, today]),
      db.all(`SELECT * FROM workouts_manual WHERE user_id = $1 AND date = $2`, [userId, today]),
      db.get(`SELECT * FROM sleep_manual WHERE user_id = $1 AND date = $2`, [userId, today]),
      db.get(`SELECT * FROM weight_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 1`, [userId])
    ]);

    const foodTotals = food.reduce((acc, f) => ({
      calories: acc.calories + (f.calories || 0),
      protein: acc.protein + (f.protein || 0),
      carbs: acc.carbs + (f.carbs || 0),
      fat: acc.fat + (f.fat || 0)
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    res.json({
      member: { name: member.name, email: member.email, joined_at: member.joined_at },
      date: today,
      whoop: whoop || null,
      nutrition: foodTotals,
      food_logs: food,
      water: water?.total || 0,
      workouts,
      sleep: sleep || (whoop ? { duration: whoop.sleep_hours, quality: whoop.sleep_score } : null),
      weight: weight || null
    });
  } catch (err) {
    console.error('Member stats error:', err);
    res.status(500).json({ error: 'Failed to fetch member stats' });
  }
});

module.exports = router;
