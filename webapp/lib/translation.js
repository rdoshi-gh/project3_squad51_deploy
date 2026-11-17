const { InputError } = require('./validation');

// MyMemory's GET API needs no key. An optional contact email increases its
// documented free allowance. Each segment is limited to 500
// UTF-8 bytes. Cache by source text, so new/edited menu names need no dictionary.
function createTranslator({ fetchImpl = fetch, now = Date.now, contactEmail = '', logger = console } = {}) {
    const cache = new Map(), pending = new Map(), clients = new Map();
    const ttl = 24 * 60 * 60 * 1000;
    let active = 0;
    const waiting = [];
    let blockedUntil = 0;

    function providerCooldown(response) {
        const header = response.headers?.get('retry-after');
        const delay = typeof header === 'string' && /^\d+$/.test(header.trim())
            ? Number(header) * 1000 : Date.parse(header) - now();
        // When the provider gives no usable reset time, pause for one minute.
        const milliseconds = Number.isFinite(delay) && delay > 0 ? delay : 60000;
        blockedUntil = Math.max(blockedUntil, now() + milliseconds);
        return Math.ceil((blockedUntil - now()) / 1000);
    }

    async function translate(text) {
        const saved = cache.get(text);
        if (saved && saved.expires > now()) return saved.value;
        if (pending.has(text)) return pending.get(text);
        const work = (async () => {
            // Bound concurrency across requests, not just within one batch.
            if (active >= 4) await new Promise(resolve => waiting.push(resolve));
            else active++;
            const diagnostic = { stage: 'connection' };
            try {
                // Check after acquiring a slot: queued lookups must also stop as
                // soon as one in-flight request reports a provider rate limit.
                if (blockedUntil > now()) {
                    diagnostic.stage = 'cooldown';
                    diagnostic.httpStatus = 429;
                    diagnostic.retryAfterSeconds = Math.ceil((blockedUntil - now()) / 1000);
                    throw new Error('Translation provider is cooling down.');
                }
                const url = new URL('https://api.mymemory.translated.net/get');
                url.search = new URLSearchParams({ q: text, langpair: 'en|es' }).toString();
                if (contactEmail) url.searchParams.set('de', contactEmail);
                const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(12000) });
                diagnostic.stage = 'http';
                diagnostic.httpStatus = response.status || null;
                if (response.status === 429) diagnostic.retryAfterSeconds = providerCooldown(response);
                if (!response.ok) throw new Error('Translation service unavailable.');
                diagnostic.stage = 'json';
                const data = await response.json();
                diagnostic.stage = data.quotaFinished ? 'quota' : 'provider';
                diagnostic.providerStatus = Number(data.responseStatus) || null;
                if (Number(data.responseStatus) === 429) diagnostic.retryAfterSeconds = providerCooldown(response);
                if (Number(data.responseStatus) !== 200 || data.quotaFinished) throw new Error('Translation service limit reached.');
                diagnostic.stage = 'translation';
                const value = data.responseData?.translatedText;
                if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error('Invalid translation response.');
                if (cache.size >= 2000) cache.delete(cache.keys().next().value);
                cache.set(text, { value, expires: now() + ttl });
                return value;
            } catch (cause) {
                // Only structured status/code fields are retained. Error messages
                // can contain the request URL, contact email, or translated text.
                const code = cause?.cause?.code || cause?.code || cause?.name;
                if (typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code)) diagnostic.code = code;
                const error = new InputError('Spanish translation is temporarily unavailable or its free daily limit has been reached. Please try again later.', 503);
                error.translationDiagnostic = diagnostic;
                throw error;
            } finally {
                if (waiting.length) waiting.shift()();
                else active--;
            }
        })();
        pending.set(text, work);
        try { return await work; }
        finally { pending.delete(text); }
    }

    return async function handler(req, res) {
        const { texts, target } = req.body || {};
        if (target !== 'es' || !Array.isArray(texts) || !texts.length || texts.length > 32
            || texts.some(value => typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > 500)
            || texts.reduce((sum, value) => sum + value.length, 0) > 4000) {
            throw new InputError('Send 1–32 English text segments (up to 500 bytes each) with target es.', 400);
        }
        const time = now(), key = req.ip;
        for (const [ip, value] of clients) if (value.expires <= time) clients.delete(ip);
        const client = clients.get(key) || { count: 0, expires: time + 60000 };
        if (++client.count > 30 || (!clients.has(key) && clients.size >= 1024)) {
            res.set('Retry-After', '60');
            throw new InputError('Too many translation requests. Please wait a minute.', 429);
        }
        clients.set(key, client);
        // Return successful segments even if another segment fails. The browser
        // can keep and reuse them rather than consuming the free quota again.
        const results = await Promise.allSettled(texts.map(translate));
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length) {
            const reasons = [...new Set(failures.map(result => JSON.stringify(result.reason.translationDiagnostic || { stage: 'unknown' })))].map(value => JSON.parse(value));
            logger.warn('Translation provider failure:', JSON.stringify({
                emailConfigured: Boolean(contactEmail.trim()), failedSegments: failures.length, reasons
            }));
        }
        const retryAfterSeconds = Math.max(0, Math.ceil((blockedUntil - now()) / 1000));
        if (retryAfterSeconds) res.set('Retry-After', String(retryAfterSeconds));
        res.json({ translations: results.map(result => result.status === 'fulfilled' ? result.value : null),
            ...(failures.length && retryAfterSeconds ? { retryAfterSeconds } : {}) });
    };
}

module.exports = { createTranslator };
