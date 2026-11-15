// Cache and coalesce requests across kiosk visitors to conserve the API allowance.
function createWeather({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    let cached;
    let expires = 0;
    let pending;
    const location = env.OPENWEATHER_LOCATION || 'College Station, TX';
    return async function weather(req, res) {
        if (!env.OPENWEATHER_API_KEY) return res.status(503).json({ location, error: 'Weather unavailable' });
        if (now() >= expires) {
            if (!pending) pending = (async () => {
                try {
                    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
                    url.search = new URLSearchParams({ lat: env.OPENWEATHER_LAT || '30.6280', lon: env.OPENWEATHER_LON || '-96.3344', appid: env.OPENWEATHER_API_KEY, units: 'imperial' });
                    const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(5000) });
                    if (!response.ok) throw new Error('Weather service unavailable');
                    const data = await response.json();
                    const condition = data.weather?.[0];
                    if (!Number.isFinite(data.main?.temp) || !Number.isFinite(data.main?.feels_like) || !condition?.description || !Number.isInteger(condition.id)) throw new Error('Invalid weather');
                    cached = { location, temperature: Math.round(data.main.temp), feelsLike: Math.round(data.main.feels_like), description: condition.description, conditionId: condition.id, night: condition.icon?.endsWith('n') || false };
                    expires = now() + 10 * 60 * 1000;
                } catch {
                    // Never expose upstream errors or the API key, or serve old readings as current.
                    cached = null;
                    expires = now() + 60 * 1000;
                } finally { pending = null; }
            })();
            await pending;
        }
        if (!cached) return res.status(503).json({ location, error: 'Weather unavailable' });
        res.json(cached);
    };
}

module.exports = { createWeather };
