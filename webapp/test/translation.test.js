const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTranslator } = require('../lib/translation');
const { JSDOM } = require('jsdom');
const ejs = require('ejs');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { createApp } = require('../application');

function request(handler, texts, target = 'es', ip = 'test') {
    let result;
    return handler({ body: { texts, target }, ip }, { json: data => { result = data; }, set: () => {} }).then(() => result);
}
const providerResponse = text => ({ ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: text } }) });

test('public translation route works without an employee session or database access', async t => {
    const server = createApp({ env: { MYMEMORY_EMAIL: 'translator@example.com' }, db: { query: () => { throw new Error('No database access expected'); } },
        translationFetch: async url => {
            assert.equal(new URL(url).searchParams.get('de'), 'translator@example.com');
            return providerResponse('Té nuevo');
        } }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/translate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: 'es', texts: ['New Tea'] })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { translations: ['Té nuevo'] });
});

test('translation service uses the documented keyless API and caches/deduplicates source text', async () => {
    const calls = [];
    const handler = createTranslator({ fetchImpl: async (url, options) => {
        calls.push(url);
        const parsed = new URL(url);
        assert.equal(parsed.origin + parsed.pathname, 'https://api.mymemory.translated.net/get');
        assert.equal(parsed.searchParams.get('langpair'), 'en|es');
        assert.ok(options.signal);
        return providerResponse('Té de guayaba');
    } });
    assert.deepEqual((await request(handler, ['New Guava Tea', 'New Guava Tea'])).translations, ['Té de guayaba', 'Té de guayaba']);
    await request(handler, ['New Guava Tea']);
    assert.equal(calls.length, 1);
});

test('translation rejects invalid batches, unsupported languages, and oversized UTF-8 segments', async () => {
    const handler = createTranslator({ fetchImpl: () => { throw new Error('must not fetch'); } });
    for (const texts of [[], [''], [null], ['é'.repeat(251)], Array(33).fill('Tea')]) {
        await assert.rejects(request(handler, texts), { status: 400 });
    }
    await assert.rejects(request(handler, ['Tea'], 'fr'), { status: 400 });
});

test('optional contact email is sent only to the provider and never returned to the browser', async () => {
    const handler = createTranslator({ contactEmail: 'translator@example.com', fetchImpl: async url => {
        assert.equal(new URL(url).searchParams.get('de'), 'translator@example.com');
        return providerResponse('Té');
    } });
    const result = await request(handler, ['Tea']);
    assert.deepEqual(result, { translations: ['Té'] });
    assert.ok(!JSON.stringify(result).includes('translator@example.com'));
});

test('failed/quota-limited segments can be retried while successful segments stay cached', async () => {
    let fail = true, calls = 0;
    const handler = createTranslator({ fetchImpl: async url => {
        calls++;
        if (new URL(url).searchParams.get('q') === 'Tea' && fail) return { ok: true, json: async () => ({ responseStatus: 403, quotaFinished: true }) };
        return providerResponse('Español');
    } });
    assert.deepEqual((await request(handler, ['Tea', 'Milk'])).translations, [null, 'Español']);
    fail = false;
    assert.deepEqual((await request(handler, ['Tea', 'Milk'])).translations, ['Español', 'Español']);
    assert.equal(calls, 3);
});

test('translation cache expires and per-client requests are bounded', async () => {
    let time = 0, calls = 0;
    const handler = createTranslator({ now: () => time, fetchImpl: async () => { calls++; return providerResponse('Té'); } });
    for (let i = 0; i < 30; i++) await request(handler, ['Tea']);
    await assert.rejects(request(handler, ['Tea']), { status: 429 });
    assert.equal(calls, 1);
    time = 86400001;
    await request(handler, ['Tea']);
    assert.equal(calls, 2);
});

async function waitFor(check) {
    for (let i = 0; i < 150; i++) {
        if (check()) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Timed out waiting for translation');
}

async function kiosk(t, { fail = false, saved = 'en', defer = false } = {}) {
    const html = await ejs.renderFile(path.join(__dirname, '../views/kiosk.ejs'), {
        customer: { firstName: 'Private Name', points: 12 }, googleEnabled: false, signinError: ''
    });
    const dom = new JSDOM(html, { url: 'http://localhost/kiosk', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window, d = w.document, batches = [], orders = [];
    const observers = [], Observer = w.MutationObserver;
    w.MutationObserver = class extends Observer {
        constructor(callback) { super(callback); observers.push(this); }
    };
    t.after(async () => { await new Promise(resolve => setImmediate(resolve)); observers.forEach(observer => observer.disconnect()); w.close(); });
    const menu = [{ menu_item_id: 17, name: 'New Guava Tea', category: 'Fruit Tea', price: '5.50' },
        { menu_item_id: 18, name: 'Boba', category: 'Topping', price: '0.75' }];
    let shouldFail = fail;
    const deferred = [];
    w.TextEncoder = TextEncoder;
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    w.localStorage.setItem('pos-accessibility-settings', JSON.stringify({ language: saved }));
    w.fetch = async (url, options) => {
        if (url === '/api/kiosk/menu') return { ok: true, json: async () => menu };
        if (url === '/api/kiosk/orders') { orders.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ order_id: 9, total: 5.50 }) }; }
        assert.equal(url, '/api/translate');
        const { texts } = JSON.parse(options.body); batches.push(...texts);
        if (defer) await new Promise(resolve => deferred.push(resolve));
        return { ok: true, json: async () => ({ translations: texts.map(text => shouldFail ? null
            : text === 'New Guava Tea' ? 'Té de guayaba nuevo' : `ES ${text}`) }) };
    };
    for (const file of ['accessibility', 'translation', 'kiosk']) w.eval(readFileSync(path.join(__dirname, `../public/static/${file}.js`), 'utf8'));
    const language = value => {
        d.getElementById('accessibility-language').value = value;
        d.getElementById('accessibility-language').dispatchEvent(new w.Event('change', { bubbles: true }));
    };
    const submitName = () => {
        d.getElementById('kiosk-customer-name').value = 'Private Name';
        d.getElementById('kiosk-name-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    };
    await waitFor(() => d.querySelector('.kiosk-add-drink'));
    return { w, d, menu, batches, orders, language, submitName, deferred, recover: () => { shouldFail = false; } };
}

test('Spanish translates new database menu names, attributes, and dynamic dialogs without changing order IDs or customer names', async t => {
    const ui = await kiosk(t);
    ui.language('es');
    await waitFor(() => ui.d.querySelector('.kiosk-drink-card h3').textContent === 'Té de guayaba nuevo');
    assert.equal(ui.d.documentElement.lang, 'es');
    assert.match(ui.d.getElementById('kiosk-customer-name').placeholder, /^ES /);
    ui.submitName();
    assert.equal(ui.d.getElementById('kiosk-name-greeting').textContent, 'Private Name');
    ui.d.querySelector('.kiosk-add-drink').click();
    await waitFor(() => ui.d.getElementById('kiosk-dialog-title').textContent.startsWith('ES '));
    assert.equal(ui.d.querySelector('#kiosk-dialog select').getAttribute('aria-label'), 'Tamaño de la bebida');
    assert.ok(ui.d.getElementById('kiosk-dialog').textContent.includes('Dulzor'));
    const select = ui.d.querySelector('#kiosk-dialog select');
    select.value = 'Small';
    ui.d.querySelector('#kiosk-dialog form').dispatchEvent(new ui.w.Event('submit', { cancelable: true }));
    ui.language('en');
    assert.equal(ui.d.querySelector('.kiosk-drink-card h3').textContent, 'New Guava Tea');
    ui.d.getElementById('kiosk-review').click();
    const place = [...ui.d.querySelectorAll('#kiosk-dialog button')].find(button => button.textContent === 'Place order');
    place.click();
    await waitFor(() => ui.orders.length === 1);
    assert.equal(ui.orders[0].lines[0].menuItemId, 17);
    assert.equal(ui.orders[0].lines[0].size, 'Small');
    assert.equal(ui.orders[0].customerName, 'Private Name');
    assert.ok(!ui.batches.some(text => text.includes('Private Name')));
});

test('Spanish menu search accepts translated words without accents and English names', async t => {
    const ui = await kiosk(t, { saved: 'es' });
    await waitFor(() => ui.d.querySelector('.kiosk-drink-card h3').textContent === 'Té de guayaba nuevo');
    const search = ui.d.getElementById('kiosk-search');
    for (const term of ['guayaba', 'te', 'Guava']) {
        search.value = term; search.dispatchEvent(new ui.w.Event('input'));
        assert.equal(ui.d.querySelectorAll('.kiosk-drink-card').length, 1);
    }
});

test('translation failure leaves English usable, offers retry, and recovers without resetting the cart', async t => {
    const ui = await kiosk(t, { fail: true });
    ui.language('es');
    await waitFor(() => !ui.d.getElementById('translation-retry').hidden);
    assert.match(ui.d.getElementById('translation-status').textContent, /No se pudo/);
    assert.equal(ui.d.querySelector('.kiosk-drink-card h3').textContent, 'New Guava Tea');
    ui.recover(); ui.d.getElementById('translation-retry').click();
    await waitFor(() => ui.d.querySelector('.kiosk-drink-card h3').textContent === 'Té de guayaba nuevo');
    assert.equal(ui.d.getElementById('translation-retry').hidden, true);
});

test('switching to English during a pending request prevents stale Spanish writes', async t => {
    const ui = await kiosk(t, { defer: true });
    ui.language('es'); await waitFor(() => ui.deferred.length > 0);
    ui.language('en'); ui.deferred.shift()();
    await waitFor(() => ui.d.getElementById('translation-feedback').hidden);
    assert.equal(ui.d.documentElement.lang, 'en');
    assert.equal(ui.d.querySelector('.kiosk-drink-card h3').textContent, 'New Guava Tea');
});

test('new menu items appearing after translation are picked up automatically', async t => {
    const ui = await kiosk(t, { saved: 'es' });
    await waitFor(() => ui.d.querySelector('.kiosk-drink-card h3').textContent === 'Té de guayaba nuevo');
    ui.menu.push({ menu_item_id: 99, name: 'Brand New Peach Tea', category: 'Fruit Tea', price: '6.00' });
    ui.d.getElementById('kiosk-search').dispatchEvent(new ui.w.Event('input'));
    await waitFor(() => [...ui.d.querySelectorAll('.kiosk-drink-card h3')].some(node => node.textContent === 'ES Brand New Peach Tea'));
    assert.ok(ui.batches.includes('Brand New Peach Tea'));
});

test('long Unicode text is segmented safely and provider markup stays inert text', async t => {
    const ui = await kiosk(t);
    const label = ui.d.createElement('p');
    const original = 'Tea é '.repeat(120);
    label.textContent = original; ui.d.body.append(label);
    const baseFetch = ui.w.fetch;
    ui.w.fetch = async (url, options) => {
        if (url !== '/api/translate') return baseFetch(url, options);
        const { texts } = JSON.parse(options.body);
        assert.ok(texts.every(text => Buffer.byteLength(text, 'utf8') <= 500));
        return { ok: true, json: async () => ({ translations: texts.map(() => '<img src=x onerror="alert(1)">') }) };
    };
    ui.language('es');
    await waitFor(() => label.textContent.includes('<img'));
    assert.equal(label.querySelector('img'), null);
    ui.language('en');
    assert.equal(label.textContent, original);
});
