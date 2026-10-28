const express = require('express');
const ejs = require('ejs');
const path = require('node:path');
const { db: defaultDb } = require('./lib/db');
const { sessions } = require('./lib/session');
const { InputError, id, text, number, dateRange } = require('./lib/validation');
const { getReport, getRange, LAST_WEEK } = require('./lib/reports');
const { saveOrder } = require('./lib/orders');

function createApp({ db = defaultDb, secret = process.env.SESSION_SECRET, app = express() } = {}) {
    const session = sessions(secret);
    const route = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
    app.disable('x-powered-by');
    // Import the renderer explicitly so Vercel includes it in the function bundle.
    app.engine('ejs', ejs.renderFile);
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use((req, res, next) => {
        res.set('X-Content-Type-Options', 'nosniff');
        res.set('Referrer-Policy', 'same-origin');
        res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
        if (!req.path.startsWith('/static/')) res.set('Cache-Control', 'no-store');
        req.session = session.read(req);
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
            try {
                if (new URL(req.get('origin')).host !== req.get('host')) throw new Error();
            } catch { return res.status(403).json({ error: 'Please submit changes from this application.' }); }
        }
        next();
    });
    app.use(express.json({ limit: '100kb' }));
    app.use('/static', express.static(path.join(__dirname, 'public', 'static')));
    function requireSession(view) {
        return (req, res, next) => {
            if (!req.session) return res.status(401).json({ error: 'Please sign in again.' });
            if (view && (req.session.view !== view || (view === 'manager' && req.session.role.toLowerCase() !== 'manager'))) {
                return res.status(403).json({ error: 'This action is not available for your role.' });
            }
            next();
        };
    }
    app.get('/', (req, res) => res.render('index'));
    // The customer kiosk is public and intentionally has no links to employee views.
    app.get('/kiosk', (req, res) => res.render('kiosk'));

    for (const view of ['manager', 'cashier']) {
        app.get(`/${view}/login`, (req, res) => res.render('login', { view }));
        app.get(`/${view}`, (req, res) => {
            if (!req.session || req.session.view !== view) return res.redirect(`/${view}/login`);
            res.render(view, { employee: req.session });
        });
    }
    app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Popping POS' }));
    app.get('/api/login-employees', route(async (req, res) => {
        if (!['cashier', 'manager'].includes(req.query.view)) throw new InputError('Choose a valid employee view.');
        res.json(await db.query(`SELECT employee_id, name, role FROM employees ${req.query.view === 'manager' ? "WHERE LOWER(role) = 'manager'" : ''} ORDER BY name, employee_id`));
    }));
    app.post('/api/session', route(async (req, res) => {
        const view = req.body.view;
        if (!['cashier', 'manager'].includes(view)) throw new InputError('Choose a valid employee view.');
        const [employee] = await db.query('SELECT employee_id, name, role FROM employees WHERE employee_id = $1', [id(req.body.employeeId)]);
        if (!employee || (view === 'manager' && employee.role.toLowerCase() !== 'manager')) throw new InputError('Select an employee with the required role.', 403);
        session.signIn(res, employee, view);
        res.json({ location: `/${view}` });
    }));
    app.post('/api/logout', (req, res) => { res.clearCookie('popping_session'); res.json({ ok: true }); });
    app.get('/api/menu', requireSession(), route(async (req, res) => res.json(await db.query('SELECT * FROM menu_items ORDER BY category, name, menu_item_id'))));
    app.get('/api/kiosk/menu', route(async (req, res) => res.json(await db.query('SELECT menu_item_id, name, category, price FROM menu_items ORDER BY category, name, menu_item_id'))));
    app.post('/api/kiosk/orders', route(async (req, res) => {
        res.status(201).json(await saveOrder(db, 6, req.body.lines));
    }));
    app.post('/api/orders', requireSession('cashier'), route(async (req, res) => res.status(201).json(await saveOrder(db, req.session.employeeId, req.body.lines))));
    app.use('/api/manager', requireSession('manager'));
    app.get('/api/manager/range', route(async (req, res) => res.json(await getRange(db))));
    app.get('/api/manager/reports', route(async (req, res) => res.json(await getReport(db, req.query.type, req.query.start, req.query.end))));
    app.get('/api/manager/dashboard', route(async (req, res) => {
        const range = await getRange(db);
        const daily = await getReport(db, 'daily', range.start, range.last);
        const top = await db.query(`SELECT m.name, SUM(oi.quantity) AS quantity FROM order_items oi JOIN customer_orders o USING(order_id)
            JOIN menu_items m USING(menu_item_id) WHERE o.order_timestamp >= $1::date AND o.order_timestamp < $2::date + interval '1 day'
            AND LOWER(m.category) <> 'topping' GROUP BY m.menu_item_id, m.name ORDER BY quantity DESC, m.name LIMIT 3`, [range.start, range.last]);
        const low = await db.query('SELECT * FROM inventory_items WHERE quantity <= reorder_level ORDER BY name, inventory_item_id');
        res.json({ range, daily, top, low });
    }));
    app.get('/api/manager/orders', route(async (req, res) => {
        const params = dateRange(req.query.start, req.query.end);
        const window = "o.order_timestamp >= $1::date AND o.order_timestamp < $2::date + interval '1 day'";
        const rows = await db.query(`SELECT o.*, e.name AS employee FROM customer_orders o LEFT JOIN employees e USING(employee_id)
            WHERE ${window} ORDER BY order_timestamp DESC, order_id DESC LIMIT 500`, params);
        const [totals] = await db.query(`SELECT COUNT(*) AS orders, COALESCE(SUM(total_price),0) AS revenue FROM customer_orders o WHERE ${window}`, params);
        const top = await db.query(`SELECT m.name, SUM(oi.quantity) AS quantity FROM order_items oi JOIN customer_orders o USING(order_id)
            JOIN menu_items m USING(menu_item_id) WHERE ${window} AND LOWER(m.category) <> 'topping'
            GROUP BY m.menu_item_id, m.name ORDER BY quantity DESC, m.name LIMIT 3`, params);
        res.json({ rows, totals, top });
    }));
    app.get('/api/manager/orders/:id', route(async (req, res) => {
        const orderId = id(req.params.id);
        const [order] = await db.query('SELECT o.*, e.name AS employee FROM customer_orders o LEFT JOIN employees e USING(employee_id) WHERE order_id = $1', [orderId]);
        if (!order) throw new InputError('Order not found.', 404);
        const items = await db.query('SELECT m.name, oi.quantity, m.price AS current_price FROM order_items oi JOIN menu_items m USING(menu_item_id) WHERE order_id = $1 ORDER BY order_item_id', [orderId]);
        res.json({ order, items });
    }));
    app.get('/api/manager/inventory/:id/review', route(async (req, res) => {
        const itemId = id(req.params.id);
        const [item] = await db.query('SELECT * FROM inventory_items WHERE inventory_item_id = $1', [itemId]);
        if (!item) throw new InputError('Inventory item not found.', 404);
        const [usage] = await db.query(`${LAST_WEEK} SELECT
            COALESCE(SUM(CASE WHEN o.order_timestamp >= w.e - 6 THEN oi.quantity * r.quantity_required ELSE 0 END),0) AS week,
            COALESCE(SUM(oi.quantity * r.quantity_required),0) / 4.0 AS average
            FROM w LEFT JOIN customer_orders o ON o.order_timestamp >= w.e - 27 AND o.order_timestamp < w.e + interval '1 day'
            LEFT JOIN order_items oi USING(order_id) LEFT JOIN recipes r ON r.menu_item_id = oi.menu_item_id AND r.inventory_item_id = $1`, [itemId]);
        const requests = await db.query('SELECT * FROM reorder_requests WHERE inventory_item_id = $1 ORDER BY request_date_time DESC, reorder_request_id DESC LIMIT 4', [itemId]);
        res.json({ item, week: Number(usage.week), average: Number(usage.average), suggested: Math.ceil(Number(usage.average)), requests });
    }));
    const entities = {
        inventory: { table: 'inventory_items', key: 'inventory_item_id', fields: ['name', 'quantity', 'unit', 'reorder_level'] },
        menu: { table: 'menu_items', key: 'menu_item_id', fields: ['name', 'category', 'price'] },
        employees: { table: 'employees', key: 'employee_id', fields: ['name', 'role'] }
    };
    function valuesFor(entity, body) {
        return entity.fields.map(field => {
            if (['quantity', 'reorder_level', 'price'].includes(field)) return number(body[field], field.replaceAll('_', ' '), { max: field === 'price' ? 9999.99 : 99999999.99 });
            const value = text(body[field], field.replaceAll('_', ' '));
            if (field === 'role' && !['Manager', 'Cashier'].includes(value)) throw new InputError('Choose Manager or Cashier.');
            return value;
        });
    }
    for (const [name, entity] of Object.entries(entities)) {
        app.get(`/api/manager/${name}`, route(async (req, res) => res.json(await db.query(`SELECT * FROM ${entity.table} ORDER BY name, ${entity.key}`))));
        app.post(`/api/manager/${name}`, route(async (req, res) => {
            const values = valuesFor(entity, req.body);
            const row = await db.transaction(async client => {
                const nextId = await db.nextId(client, entity.table, entity.key);
                const duplicate = await client.query(`SELECT 1 FROM ${entity.table} WHERE LOWER(name) = LOWER($1)`, [values[0]]);
                if (duplicate.rows.length) throw new InputError('An item or employee with this name already exists.', 409);
                const result = await client.query(`INSERT INTO ${entity.table} (${entity.key}, ${entity.fields.join(', ')}) VALUES (${[nextId, ...values].map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, [nextId, ...values]);
                return result.rows[0];
            });
            res.status(201).json(row);
        }));
        app.patch(`/api/manager/${name}/:id`, route(async (req, res) => {
            const recordId = id(req.params.id);
            const values = valuesFor(entity, req.body);
            if (name === 'employees' && recordId === req.session.employeeId && req.body.role !== 'Manager') throw new InputError('You cannot remove your own manager role.');
            const [row] = await db.query(`UPDATE ${entity.table} SET ${entity.fields.map((field, i) => `${field} = $${i + 1}`).join(', ')} WHERE ${entity.key} = $${values.length + 1} RETURNING *`, [...values, recordId]);
            if (!row) throw new InputError('Record not found.', 404);
            res.json(row);
        }));
        app.delete(`/api/manager/${name}/:id`, route(async (req, res) => {
            const recordId = id(req.params.id);
            if (name === 'employees' && recordId === req.session.employeeId) throw new InputError('You cannot delete your own employee record.');
            await db.transaction(async client => {
                if (name !== 'employees') await client.query(`DELETE FROM recipes WHERE ${entity.key} = $1`, [recordId]);
                const { rows } = await client.query(`DELETE FROM ${entity.table} WHERE ${entity.key} = $1 RETURNING ${entity.key}`, [recordId]);
                if (!rows.length) throw new InputError('Record not found.', 404);
            });
            res.json({ ok: true });
        }));
    }
    for (const [action, field] of [['count', 'quantity'], ['reorder-level', 'reorder_level']]) {
        app.patch(`/api/manager/inventory/:id/${action}`, route(async (req, res) => {
            const [row] = await db.query(`UPDATE inventory_items SET ${field} = $1 WHERE inventory_item_id = $2 RETURNING *`, [number(req.body.value, action, { max: 99999999.99 }), id(req.params.id)]);
            if (!row) throw new InputError('Inventory item not found.', 404);
            res.json(row);
        }));
    }
    app.get('/api/manager/menu/:id/ingredients', route(async (req, res) => res.json(await db.query(`SELECT r.*, i.name, i.unit FROM recipes r
        JOIN inventory_items i USING(inventory_item_id) WHERE menu_item_id = $1 ORDER BY i.name, r.recipe_id`, [id(req.params.id)]))));
    app.post('/api/manager/menu/:id/ingredients', route(async (req, res) => {
        const menuId = id(req.params.id), inventoryId = id(req.body.inventory_item_id);
        const quantity = number(req.body.quantity_required, 'Quantity required', { min: 0.0001, max: 999999.9999 });
        const row = await db.transaction(async client => {
            const recipeId = await db.nextId(client, 'recipes', 'recipe_id');
            const existing = await client.query('SELECT 1 FROM recipes WHERE menu_item_id = $1 AND inventory_item_id = $2', [menuId, inventoryId]);
            if (existing.rows.length) throw new InputError('This ingredient is already in the recipe. Remove it before adding a new quantity.', 409);
            return (await client.query('INSERT INTO recipes (recipe_id, menu_item_id, inventory_item_id, quantity_required) VALUES ($1,$2,$3,$4) RETURNING *', [recipeId, menuId, inventoryId, quantity])).rows[0];
        });
        res.status(201).json(row);
    }));
    app.delete('/api/manager/menu/:id/ingredients/:inventoryId', route(async (req, res) => {
        await db.query('DELETE FROM recipes WHERE menu_item_id = $1 AND inventory_item_id = $2', [id(req.params.id), id(req.params.inventoryId)]);
        res.json({ ok: true });
    }));
    app.get('/api/manager/reorders', route(async (req, res) => res.json(await db.query(`SELECT r.*, i.name, i.unit FROM reorder_requests r
        JOIN inventory_items i USING(inventory_item_id) ORDER BY request_date_time DESC, reorder_request_id DESC LIMIT 100`))));
    app.post('/api/manager/reorders', route(async (req, res) => {
        const inventoryId = id(req.body.inventory_item_id), quantity = number(req.body.quantity_requested, 'Quantity requested', { min: 0.01, max: 99999999.99 });
        const row = await db.transaction(async client => {
            const requestId = await db.nextId(client, 'reorder_requests', 'reorder_request_id');
            return (await client.query('INSERT INTO reorder_requests (reorder_request_id, inventory_item_id, quantity_requested, request_date_time) VALUES ($1,$2,$3,NOW()) RETURNING *', [requestId, inventoryId, quantity])).rows[0];
        });
        res.status(201).json(row);
    }));
    app.get('/user', route(async (req, res) => res.render('user', { teammembers: await db.query('SELECT * FROM teammates') })));
    app.use('/api', (req, res) => res.status(404).json({ error: 'This action was not found.' }));
    app.use((req, res) => res.status(404).render('error', { message: 'Page not found.' }));
    app.use((error, req, res, next) => {
        let status = error.status || 503;
        let message = error.status ? error.message : 'Unable to reach the database. Please try again.';
        if (error.code === '23503') { status = 409; message = 'This record is linked to order or reorder history, or a referenced item no longer exists.'; }
        if (error.code === '23505') { status = 409; message = 'A record with these details already exists.'; }
        if (error.type === 'entity.parse.failed') { status = 400; message = 'Please submit valid form data.'; }
        if (status >= 500) console.error('Request failed:', error.message);
        if (req.path.startsWith('/api/')) res.status(status).json({ error: message });
        else res.status(status).render('error', { message });
    });
    return app;
}

module.exports = { createApp };
