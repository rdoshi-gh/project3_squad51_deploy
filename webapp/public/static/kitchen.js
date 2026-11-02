// Initial Kitchen Display: retrieve real orders, render safely, and complete
// orders via the Express API. Automatic polling is added in commit four.
'use strict';

const progressList = document.getElementById('in-progress-orders');
const readyList = document.getElementById('ready-orders');
const message = document.getElementById('kitchen-message');

async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
}

function orderCard(order, isReady) {
    const article = document.createElement('article');
    article.className = 'order-card';
    const heading = document.createElement('div');
    heading.className = 'order-heading';
    const title = document.createElement('h3');
    title.textContent = `Order #${order.order_id}`;
    const time = document.createElement('span');
    time.className = 'order-time';
    time.textContent = String(order.order_timestamp || '').replace('T', ' ').slice(11, 16);
    heading.append(title, time);
    article.append(heading);

    const list = document.createElement('ul');
    list.className = 'order-items';
    for (const item of order.items || []) {
        const li = document.createElement('li');
        if (String(item.category).toLowerCase() === 'topping') li.className = 'topping';
        const qty = document.createElement('span');
        qty.textContent = `${item.quantity}×`;
        li.append(qty, document.createTextNode(item.name));
        list.append(li);
    }
    article.append(list);

    if (isReady) {
        const label = document.createElement('span');
        label.className = 'ready-label';
        label.textContent = '✓ Ready';
        article.append(label);
    } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mark-ready';
        button.textContent = '✓ Mark Ready';
        button.setAttribute('aria-label', `Mark order ${order.order_id} ready`);
        button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'Saving…';
            try {
                await api(`/api/kitchen/orders/${order.order_id}/ready`, { method: 'PATCH' });
                await refreshOrders();
            } catch (error) {
                message.textContent = error.message;
                message.classList.add('error');
                button.disabled = false;
                button.textContent = '✓ Mark Ready';
            }
        });
        article.append(button);
    }
    return article;
}

function renderList(container, orders, ready) {
    container.replaceChildren();
    if (!orders.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = ready ? 'No completed orders recently.' : 'No orders waiting. ✓';
        container.append(empty);
    }
    for (const order of orders) container.append(orderCard(order, ready));
}

async function refreshOrders() {
    try {
        const orders = await api('/api/kitchen/orders');
        renderList(progressList, orders.inProgress, false);
        renderList(readyList, orders.ready, true);
        document.getElementById('in-progress-count').textContent = orders.inProgress.length;
        document.getElementById('ready-count').textContent = orders.ready.length;
        message.classList.remove('error');
        message.textContent = 'Orders are up to date.';
    } catch (error) {
        message.classList.add('error');
        message.textContent = error.message;
    }
}

document.getElementById('refresh-button').addEventListener('click', refreshOrders);
document.getElementById('logout-button').addEventListener('click', async () => {
    try {
        const result = await api('/api/logout', { method: 'POST' });
        location.href = result.location || '/';
    } catch (error) { message.textContent = error.message; }
});
refreshOrders();
