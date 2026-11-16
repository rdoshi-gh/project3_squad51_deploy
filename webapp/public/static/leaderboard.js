(() => {
    const { h, api, send, numeric, announce } = POS;
    const results = document.getElementById('leaderboard-results');
    const error = document.getElementById('leaderboard-error');
    const refresh = document.getElementById('leaderboard-refresh');
    const personal = document.getElementById('leaderboard-personal');
    const nameForm = document.getElementById('leaderboard-name-form');
    const nameInput = document.getElementById('leaderboard-display-name');
    const saveName = document.getElementById('leaderboard-save-name');
    const nameMessage = document.getElementById('leaderboard-name-message');
    let loading = false, saving = false, nameDirty = false;

    function renderPersonal(me) {
        personal.hidden = !me;
        document.getElementById('leaderboard-signin').hidden = Boolean(me);
        if (!me) {
            nameInput.value = '';
            nameDirty = false;
            nameMessage.textContent = '';
            return;
        }
        const rank = document.getElementById('leaderboard-my-rank');
        rank.textContent = me.rank === null ? 'Not ranked yet' : `#${numeric(me.rank)}`;
        if (me.rank === null) rank.removeAttribute('translate');
        else rank.setAttribute('translate', 'no');
        document.getElementById('leaderboard-my-points').textContent = numeric(me.lifetimePoints);
        document.getElementById('leaderboard-my-balance').textContent = numeric(me.points);
        document.getElementById('leaderboard-unranked').hidden = me.rank !== null;
        if (!nameDirty) nameInput.value = me.hasDisplayName ? me.displayName : '';
    }

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
        if (loading || saving) return;
        loading = true;
        refresh.disabled = true;
        saveName.disabled = true;
        results.setAttribute('aria-busy', 'true');
        error.hidden = true;
        try {
            const data = await api('/api/kiosk/leaderboard');
            renderLeaders(data.leaders);
            renderPersonal(data.me);
            announce('Leaderboard updated.');
        } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
            // Keep any previous ranking visible when refresh fails.
            if (!results.querySelector('table')) results.replaceChildren(h('p', { class: 'leaderboard-message' }, 'The leaderboard is unavailable. Select Refresh to try again.'));
        } finally {
            results.setAttribute('aria-busy', 'false');
            refresh.disabled = false;
            saveName.disabled = false;
            loading = false;
        }
    }
    nameInput.addEventListener('input', () => { nameDirty = true; nameMessage.textContent = ''; });
    nameForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (saving || loading) return;
        saving = true;
        nameInput.disabled = true;
        saveName.disabled = true;
        refresh.disabled = true;
        nameMessage.textContent = '';
        let saved = false;
        try {
            const result = await send('/api/kiosk/leaderboard/profile', 'PATCH', { displayName: nameInput.value });
            nameInput.value = result.displayName;
            nameDirty = false;
            nameMessage.setAttribute('role', 'status');
            nameMessage.textContent = 'Display name saved.';
            announce('Display name saved.');
            saved = true;
        } catch (err) {
            nameMessage.setAttribute('role', 'alert');
            nameMessage.textContent = err.message;
        } finally {
            saving = false;
            nameInput.disabled = false;
            saveName.disabled = false;
            refresh.disabled = false;
        }
        if (saved) await load();
    });
    refresh.addEventListener('click', load);
    load();
})();
