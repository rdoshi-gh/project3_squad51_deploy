const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWeather } = require('../lib/weather');
const env = { OPENWEATHER_API_KEY: 'private-test-key' };
function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
}
test('weather uses coordinates, Fahrenheit, a private key, and coalesces and caches requests', async () => {
    let calls = 0;
    let time = 1;
    const weather = createWeather({ env, now: () => time, fetchImpl: async url => {
        calls++;
        const params = new URL(url).searchParams;
        assert.equal(params.get('appid'), env.OPENWEATHER_API_KEY);
        assert.equal(params.get('units'), 'imperial');
        assert.equal(params.get('lat'), '30.6280');
        return { ok: true, json: async () => ({ main: { temp: 79.6, feels_like: 82.1 }, weather: [{ id: 800, description: 'clear sky', icon: '01d' }] }) };
    } });
    const a = response(), b = response();
    await Promise.all([weather({}, a), weather({}, b)]);
    assert.equal(calls, 1);
    assert.equal(a.body.temperature, 80);
    assert.deepEqual(a.body, b.body);
    assert.ok(!JSON.stringify(a.body).includes(env.OPENWEATHER_API_KEY));
    await weather({}, response());
    assert.equal(calls, 1);
    time += 600001;
    await weather({}, response());
    assert.equal(calls, 2);
});
test('missing keys and upstream failures return a safe unavailable response and back off', async () => {
    const missing = response();
    await createWeather({ env: {} })({}, missing);
    assert.equal(missing.statusCode, 503);
    let calls = 0;
    const weather = createWeather({ env, fetchImpl: async () => { calls++; throw new Error('private-test-key'); } });
    const failed = response();
    await weather({}, failed);
    await weather({}, response());
    assert.equal(calls, 1);
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.body.error, 'Weather unavailable');
});
test('malformed readings are rejected instead of displaying invalid temperatures', async () => {
    const res = response();
    await createWeather({ env, fetchImpl: async () => ({ ok: true, json: async () => ({ main: {} }) }) })({}, res);
    assert.equal(res.statusCode, 503);
});
