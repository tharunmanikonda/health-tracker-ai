const db = require('../../database');

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

module.exports = { requireTeamMember, requireTeamLeader };
