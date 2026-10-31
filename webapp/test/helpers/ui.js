const { JSDOM } = require('jsdom');
const ejs = require('ejs');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Render the real employee page and run its browser code against a DOM. Network
// responses and navigation are supplied by the test; no team data is accessed.
async function createUi({ view = 'cashier', page = '', fetch = async () => { throw new Error('Unexpected request'); } } = {}) {
    const html = await ejs.renderFile(path.join(__dirname, '../../views', `${view}.ejs`), {
        employee: { employeeId: 1, name: 'Test Employee', role: view === 'manager' ? 'Manager' : 'Cashier' }
    });
    const dom = new JSDOM(html, { url: `http://localhost/${view}${page ? `#${page}` : ''}` });
    const { window } = dom;
    // jsdom does not implement the browser's native dialog open/close methods.
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
    const navigation = [], requests = [];
    const location = {
        get hash() { return window.location.hash; },
        set hash(value) { window.location.hash = value; },
        assign: url => navigation.push({ method: 'assign', url }),
        replace: url => navigation.push({ method: 'replace', url })
    };
    const context = vm.createContext({ window, document: window.document, Node: window.Node, location,
        URLSearchParams, AbortController, structuredClone, setTimeout, clearTimeout,
        fetch: async (url, options) => { requests.push({ url, options }); return fetch(url, options); } });
    const run = name => {
        vm.runInContext(readFileSync(path.join(__dirname, '../../public/static', `${name}.js`), 'utf8'), context, { filename: `${name}.js` });
        context.POS = window.POS;
    };
    run('common');
    const dialog = window.document.getElementById('modal');
    return { dom, window, document: window.document, dialog, POS: window.POS, navigation, requests, run,
        findButton: (label, root = dialog) => [...root.querySelectorAll('button')].find(control => control.textContent === label) };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
module.exports = { createUi, flush, response };
