const { InputError } = require('./validation');

// Loyalty: customers earn 1 point per whole dollar they actually pay.
const pointsFor = total => Math.floor(total);

// Redeemable rewards. Each one trades points for a fixed discount on a kiosk order.
// Kept on the server so a client cannot invent its own exchange rate.
const REWARDS = Object.freeze([
    Object.freeze({ id: 'save-2', points: 25, discountCents: 200, label: '$2 off your order' }),
    Object.freeze({ id: 'save-5', points: 50, discountCents: 500, label: '$5 off your order' }),
    Object.freeze({ id: 'save-12', points: 100, discountCents: 1200, label: '$12 off your order' })
]);

function findReward(rewardId) {
    if (rewardId === undefined || rewardId === null || rewardId === '') return null;
    const reward = REWARDS.find(row => row.id === rewardId);
    if (!reward) throw new InputError('Choose a valid reward.');
    return reward;
}

// A reward may not exceed the order subtotal, so points are never spent on a discount that goes unused.
function applyReward(subtotalCents, reward) {
    if (!reward) return { discountCents: 0, totalCents: subtotalCents };
    if (reward.discountCents > subtotalCents) throw new InputError(`Add more to your order to use ${reward.label}.`);
    return { discountCents: reward.discountCents, totalCents: subtotalCents - reward.discountCents };
}

module.exports = { REWARDS, findReward, applyReward, pointsFor };
