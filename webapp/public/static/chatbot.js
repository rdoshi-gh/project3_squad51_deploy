(() => {
    const panel = document.getElementById('kiosk-chat');
    if (!panel) return;
    const input = document.getElementById('kiosk-chat-question');
    const log = document.getElementById('kiosk-chat-log');
    const status = document.getElementById('kiosk-chat-status');
    const send = document.getElementById('kiosk-chat-send');
    let history = [], busy = false, controller, expiry;
    function bubble(role, content) {
        const node = document.createElement('p');
        node.className = `kiosk-chat-bubble kiosk-chat-${role}`;
        const label = document.createElement('strong');
        label.textContent = role === 'user' ? 'You' : 'Poppy';
        node.append(label, document.createTextNode(content));
        log.append(node);
        log.scrollTop = log.scrollHeight;
    }
    function clear() {
        controller?.abort(); controller = null;
        clearTimeout(expiry);
        history = []; busy = false; send.disabled = false;
        log.replaceChildren(); input.value = ''; status.textContent = '';
        bubble('assistant', 'Hi, I’m Poppy! Looking for a drink or a little help ordering? Ask away.');
    }
    async function ask(question) {
        if (busy || !question.trim()) return;
        question = question.trim();
        if (question.length > 500) { status.textContent = 'Please keep your question under 500 characters.'; return; }
        clearTimeout(expiry);
        busy = true; send.disabled = true;
        const request = new AbortController(); controller = request;
        bubble('user', question); input.value = ''; status.textContent = 'Poppy is thinking…';
        const timeout = setTimeout(() => request.abort(), 25000);
        try {
            const response = await fetch('/api/kiosk/chat', { method: 'POST', signal: request.signal,
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: question, history }) });
            const data = await response.json();
            if (controller !== request) return;
            if (!response.ok) throw new Error(data.error || 'Poppy is unavailable. Please try again.');
            if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('Poppy could not answer. Please try again.');
            bubble('assistant', data.reply);
            history = [...history, { role: 'user', content: question }, { role: 'assistant', content: data.reply }].slice(-8);
            status.textContent = '';
        } catch (error) {
            if (controller !== request) return;
            status.textContent = error.name === 'AbortError' ? 'Poppy took too long to respond. Please try again.' : error.message;
            input.value = question;
        } finally {
            clearTimeout(timeout);
            if (controller === request) {
                busy = false; send.disabled = false; controller = null;
                if (panel.open) input.focus();
                expiry = setTimeout(clear, 3 * 60 * 1000);
            }
        }
    }
    document.getElementById('kiosk-chat-open').addEventListener('click', () => { panel.showModal(); input.focus(); });
    document.getElementById('kiosk-chat-close').addEventListener('click', () => panel.close());
    document.getElementById('kiosk-chat-clear').addEventListener('click', () => { clear(); input.focus(); });
    document.getElementById('kiosk-chat-form').addEventListener('submit', event => { event.preventDefault(); ask(input.value); });
    panel.querySelectorAll('.kiosk-chat-suggestions button').forEach(button => button.addEventListener('click', () => ask(button.textContent)));
    // Shared kiosks should not retain one customer's questions after checkout or inactivity.
    // Checkout already updates the cart count; observe its transition to empty instead of changing ordering behavior.
    const count = document.getElementById('kiosk-cart-count');
    let previousCount = count?.textContent;
    if (count) new MutationObserver(() => {
        const next = count.textContent;
        if (previousCount !== '0' && next === '0') clear();
        previousCount = next;
    }).observe(count, { childList: true, characterData: true, subtree: true });
    clear();
})();
