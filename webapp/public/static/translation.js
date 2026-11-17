/* Translate text nodes, not HTML: event handlers, form values, menu IDs, and
   cart state stay intact. Dynamic dialogs and newly loaded menu items use the
   same pipeline as the initial page. English originals are kept per node. */
(() => {
    if (!document.getElementById('accessibility-toggle')) return;
    // Short labels can be ambiguous in a general translation memory (e.g.
    // "Sweetness" as a term of affection). Reviewed ordering/accessibility terms
    // keep the controls clear; arbitrary menu names still use the live API.
    const cache = new Map([
        ['Decrease text size', 'Reducir el tamaño del texto'],
        ['Increase text size', 'Aumentar el tamaño del texto'],
        ['Sweetness', 'Dulzor'],
        ['Sweetness level', 'Nivel de dulzor'],
        ['Drink size', 'Tamaño de la bebida'],
        ['Quantity', 'Cantidad'],
        ['How many?', '¿Cuántas bebidas?'],
        ['Ice level', 'Cantidad de hielo'],
        ['No ice', 'Sin hielo'],
        ['Light ice', 'Poco hielo'],
        ['Regular ice', 'Hielo normal'],
        ['Extra ice', 'Hielo extra'],
        ['Regular', 'Normal'],
        ['Place order', 'Confirmar pedido'],
        ['Cancel', 'Cancelar'],
        ['Add to order', 'Añadir al pedido'],
        ['Save changes', 'Guardar cambios'],
        ['Edit', 'Editar'],
        ['Remove', 'Eliminar'],
        ['Keep browsing', 'Seguir explorando'],
        ['All drinks', 'Todas las bebidas'],
        ['Refresh', 'Actualizar'],
        ['Close', 'Cerrar'],
        ['Log Out', 'Cerrar sesión'],
        ['Log out', 'Cerrar sesión'],
        ['Sign In', 'Iniciar sesión'],
        ['Manager', 'Gerente'],
        ['Cashier', 'Cajero'],
        ['Kiosk', 'Quiosco'],
        ['MANAGER', 'GERENTE'],
        ['CASHIER', 'CAJA'],
        ['Dashboard', 'Panel principal'],
        ['Order History', 'Historial de pedidos'],
        ['Inventory', 'Inventario'],
        ['Product Usage', 'Uso de ingredientes'],
        ['Restocking', 'Reabastecimiento'],
        ['Employees', 'Empleados'],
        ['Menu Items', 'Productos del menú'],
        ['Reports', 'Informes'],
        ['Customer Orders', 'Pedidos de clientes'],
        ['Order History & Trends', 'Historial y tendencias de pedidos'],
        ['Start Date', 'Fecha inicial'],
        ['End Date', 'Fecha final'],
        ['View Order', 'Ver pedido'],
        ['Order ID', 'N.º de pedido'],
        ['Employee', 'Empleado'],
        ['Date / Time', 'Fecha y hora'],
        ['Details', 'Detalles'],
        ['Total', 'Total'],
        ['Order total', 'Total del pedido'],
        ['Revenue', 'Ingresos'],
        ['Orders', 'Pedidos'],
        ['Quantity Sold', 'Cantidad vendida'],
        ['Ordering Trends', 'Tendencias de pedidos'],
        ['Top Menu Items', 'Productos más vendidos'],
        ['Inventory Item', 'Ingrediente'],
        ['Inventory Items', 'Ingredientes'],
        ['Unit', 'Unidad'],
        ['Reorder Level', 'Nivel de reposición'],
        ['Status', 'Estado'],
        ['Actions', 'Acciones'],
        ['Low', 'Bajo'],
        ['OK', 'Suficiente'],
        ['Delete', 'Eliminar'],
        ['Save Changes', 'Guardar cambios'],
        ['Name', 'Nombre'],
        ['Role', 'Puesto'],
        ['Price', 'Precio'],
        ['Category', 'Categoría'],
        ['Employee ID', 'N.º de empleado'],
        ['Menu Item', 'Producto'],
        ['Menu Item ID', 'N.º de producto'],
        ['Ingredients', 'Ingredientes'],
        ['Employee Records', 'Registros de empleados'],
        ['Report Type', 'Tipo de informe'],
        ['Table View', 'Tabla'],
        ['Graph View', 'Gráfica'],
        ['Sales', 'Ventas'],
        ['Make it extra special', 'Añade ingredientes extra'],
        ['a lot of joy.', 'mucha alegría.']
    ]), records = new WeakMap();
    const attributes = ['placeholder', 'aria-label', 'title', 'alt'];
    const excluded = 'script, style, noscript, [translate="no"], [data-no-translate], [aria-hidden="true"]';
    const panel = document.getElementById('translation-feedback');
    const status = document.getElementById('translation-status');
    const retry = document.getElementById('translation-retry');
    let language = document.documentElement.lang === 'es' ? 'es' : 'en';
    let timer, running = false, dirty = false, failed = false, revision = 0;

    // Long text is split on character boundaries, respecting the provider's
    // byte limit even for accented characters. Preserve whitespace on restore.
    function segments(text) {
        const parts = [];
        let part = '';
        for (const word of text.match(/\S+\s*|\s+/gu) || []) {
            if (new TextEncoder().encode(part + word).length <= 500) { part += word; continue; }
            if (part) { parts.push(part); part = ''; }
            for (const character of word) {
                if (new TextEncoder().encode(part + character).length > 500) { parts.push(part); part = ''; }
                part += character;
            }
        }
        if (part) parts.push(part);
        return parts;
    }
    function binding(node, key, read, write) {
        let map = records.get(node);
        if (!map) { map = new Map(); records.set(node, map); }
        const current = read();
        let record = map.get(key);
        // Application code may replace an earlier translation (e.g. cart count
        // or checkout errors). Capture that new English source independently.
        if (!record || current !== record.last) {
            record = { source: current, last: current };
            map.set(key, record);
        }
        return { record, write };
    }
    function collect() {
        const bindings = [];
        const roots = [document.body, document.querySelector('title')].filter(Boolean);
        function visit(node) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches(excluded)) return;
                for (const attr of attributes) if (node.hasAttribute(attr)) {
                    bindings.push(binding(node, attr, () => node.getAttribute(attr), value => node.setAttribute(attr, value)));
                }
            } else if (node.nodeType === Node.TEXT_NODE) {
                if (/\p{L}/u.test(node.nodeValue)) bindings.push(binding(node, 'text', () => node.nodeValue, value => { node.nodeValue = value; }));
            }
            for (const child of node.childNodes) visit(child);
        }
        roots.forEach(visit);
        return bindings;
    }
    const translated = source => segments(source).map(part => {
        const core = part.trim();
        return core && cache.has(core) ? part.replace(core, cache.get(core)) : part;
    }).join('');
    function observe() {
        observer.observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: attributes });
        const title = document.querySelector('title');
        if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    }
    function paint() {
        // Avoid observing our own writes. Never rebuild controls or interpolate
        // HTML returned by an external service.
        observer.disconnect();
        for (const { record, write } of collect()) {
            const value = language === 'es' ? translated(record.source) : record.source;
            if (value !== record.last) { write(value); record.last = value; }
        }
        document.documentElement.lang = language;
        observe();
    }
    let retryAt = 0, retryTimer;
    function feedback(state) {
        clearTimeout(retryTimer);
        const waitSeconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
        panel.hidden = state === 'off' || state === 'ready';
        retry.hidden = state !== 'error';
        retry.disabled = state === 'error' && waitSeconds > 0;
        status.textContent = state === 'loading' ? 'Traduciendo al español… / Translating to Spanish…'
            : state === 'error' ? (waitSeconds > 0
                ? `El servicio de traducción ha limitado las solicitudes. Espera al menos ${waitSeconds} segundos antes de reintentar o elige English. / Translation service is rate-limited. Wait at least ${waitSeconds} seconds before retrying, or choose English.`
                : 'No se pudo traducir todo. Parte del texto sigue en inglés. Intenta de nuevo o elige English. / Some text could not be translated. Retry or choose English.')
                : '';
        if (state === 'error' && waitSeconds > 0) {
            retryTimer = setTimeout(() => { if (language === 'es' && failed) feedback('error'); }, Math.min(waitSeconds * 1000, 2147483647));
        }
    }
    async function refresh() {
        if (running) { dirty = true; return; }
        if (language !== 'es') { paint(); feedback('off'); return; }
        if (failed) { paint(); return; }
        if (retryAt > Date.now()) { failed = true; paint(); feedback('error'); return; }
        running = true; dirty = false;
        const generation = revision;
        // Apply cached/reviewed labels immediately while new phrases load.
        paint();
        const missing = [...new Set(collect().flatMap(({ record }) => segments(record.source).map(part => part.trim())))]
            .filter(text => /\p{L}/u.test(text) && !cache.has(text));
        let changed = false;
        if (missing.length) feedback('loading');
        try {
            for (let index = 0; index < missing.length;) {
                if (language !== 'es' || generation !== revision) break;
                const texts = [];
                let length = 0;
                while (index < missing.length && texts.length < 32 && length + missing[index].length <= 4000) {
                    length += missing[index].length; texts.push(missing[index++]);
                }
                const response = await fetch('/api/translate', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target: 'es', texts })
                });
                if (!response.ok) {
                    const retrySeconds = Number(response.headers?.get('retry-after'));
                    if (response.status === 429 && generation === revision && language === 'es' && Number.isFinite(retrySeconds) && retrySeconds > 0) {
                        retryAt = Math.max(retryAt, Date.now() + retrySeconds * 1000);
                    }
                    throw new Error('Translation request failed.');
                }
                const data = await response.json();
                if (!Array.isArray(data.translations) || data.translations.length !== texts.length) throw new Error('Invalid translations.');
                if (generation === revision && language === 'es' && Number.isFinite(data.retryAfterSeconds) && data.retryAfterSeconds > 0) {
                    retryAt = Math.max(retryAt, Date.now() + data.retryAfterSeconds * 1000);
                }
                let incomplete = false;
                data.translations.forEach((value, i) => {
                    if (typeof value !== 'string' || !value.trim()) { incomplete = true; return; }
                    // Providers may HTML-encode entities. Decode in an inert
                    // textarea, then only insert the result as a text node.
                    const decoder = document.createElement('textarea');
                    decoder.innerHTML = value;
                    cache.set(texts[i], decoder.value); changed = true;
                });
                paint();
                if (incomplete) throw new Error('Translation service unavailable.');
            }
        } catch {
            if (generation === revision && language === 'es') failed = true;
        } finally {
            paint(); running = false;
            feedback(language !== 'es' ? 'off' : failed ? 'error' : 'ready');
            if (changed) document.dispatchEvent(new CustomEvent('translation:updated'));
            if (dirty || generation !== revision) schedule();
        }
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 60); }
    const observer = new MutationObserver(records => {
        if (records.some(record => !((record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement)?.closest(excluded)))) schedule();
    });
    document.addEventListener('accessibility:language-change', event => {
        language = event.detail.language === 'es' ? 'es' : 'en';
        revision++; failed = false;
        feedback(language === 'es' ? 'loading' : 'off');
        paint(); schedule();
    });
    retry.addEventListener('click', () => {
        if (Date.now() < retryAt) { feedback('error'); return; }
        failed = false; schedule();
    });
    // Menu search can match either the original name or its displayed Spanish
    // translation. The database and checkout always use the original item IDs.
    window.POSLanguage = {
        searchText: source => `${source} ${translated(source)}`,
        label: source => language === 'es' ? translated(source) : source
    };
    observe(); schedule();
})();
