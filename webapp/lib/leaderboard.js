const { InputError, text } = require('./validation');

const LEADERBOARD_LIMIT = 10;
const displayName = row => row.display_name || `Boba fan #${row.customer_id}`;

async function getLeaderboard(db, customerId) {
    // Rank by points alone so ties share a place (1, 1, 3). The ID only makes
    // ordering and the ten-customer cutoff stable when scores are tied.
    const rows = await db.query(`SELECT customer_id, display_name, lifetime_points,
        RANK() OVER (ORDER BY lifetime_points DESC) AS rank
        FROM customers WHERE lifetime_points > 0
        ORDER BY lifetime_points DESC, customer_id LIMIT $1`, [LEADERBOARD_LIMIT]);
    const leaders = rows.map(row => ({ displayName: displayName(row),
        lifetimePoints: Number(row.lifetime_points), rank: Number(row.rank),
        isYou: Number(row.customer_id) === customerId }));
    let me = null;
    if (customerId) {
        // Calculate the customer's rank against everyone, including those
        // outside the Top 10. Zero-point customers have not ranked yet.
        const [row] = await db.query(`SELECT c.customer_id, c.display_name, c.points, c.lifetime_points,
            CASE WHEN c.lifetime_points > 0 THEN
                1 + (SELECT COUNT(*) FROM customers other WHERE other.lifetime_points > c.lifetime_points)
            END AS rank FROM customers c WHERE c.customer_id = $1`, [customerId]);
        if (row) me = { displayName: displayName(row), hasDisplayName: Boolean(row.display_name),
            lifetimePoints: Number(row.lifetime_points), points: Number(row.points),
            rank: row.rank === null ? null : Number(row.rank) };
    }
    return { leaders, me };
}

async function updateDisplayName(db, customerId, value) {
    const name = text(value, 'Display name', 40);
    const [row] = await db.query(`UPDATE customers SET display_name = $1
        WHERE customer_id = $2 RETURNING display_name`, [name, customerId]);
    if (!row) throw new InputError('Please sign in again.', 401);
    return { displayName: row.display_name };
}

module.exports = { getLeaderboard, updateDisplayName, LEADERBOARD_LIMIT };
