(() => {
    const { h, api, numeric, announce } = POS;
    const results = document.getElementById('leaderboard-results');
    const error = document.getElementById('leaderboard-error');
    const refresh = document.getElementById('leaderboard-refresh');

    function renderLeaders(leaders) {
        if (!leaders.length) {
            results.replaceChildren(h('p', { class: 'leaderboard-message' }, 'No Lifetime Points yet. Your next signed-in order could start the leaderboard!'));
            return;
        }
        results.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'leaderboard-table' },
            h('caption', { class: 'sr-only' }, 'Top 10 customers by Lifetime Points'),
            h('thead', {}, h('tr', {}, ['Rank', 'Customer', 'Lifetime Points'].map(label => h('th', { scope: 'col' }, label)))),
            h('tbody', {}, leaders.map(row => h('tr', { class: row.isYou ? 'leaderboard-you' : '' },
                h('td', { class: 'leaderboard-rank', translate: 'no' }, `#${numeric(row.rank)}`),
                h('th', { scope: 'row' }, h('span', { translate: 'no', class: 'leaderboard-name' }, row.displayName),
                    row.isYou ? h('span', { class: 'leaderboard-you-label' }, 'You') : null),
                h('td', { class: 'leaderboard-points', translate: 'no' }, numeric(row.lifetimePoints))))))));
    }

    async function load() {
        refresh.disabled = true;
        results.setAttribute('aria-busy', 'true');
        error.hidden = true;
        try {
            const data = await api('/api/kiosk/leaderboard');
            renderLeaders(data.leaders);
            document.getElementById('leaderboard-signin').hidden = Boolean(data.me);
            announce('Leaderboard updated.');
        } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
            // Keep any previous ranking visible when refresh fails.
            if (!results.querySelector('table')) results.replaceChildren(h('p', { class: 'leaderboard-message' }, 'The leaderboard is unavailable. Select Refresh to try again.'));
        } finally {
            results.setAttribute('aria-busy', 'false');
            refresh.disabled = false;
        }
    }
    refresh.addEventListener('click', load);
    load();
})();
