class InputError extends Error {
    constructor(message, status = 422) {
        super(message);
        this.status = status;
    }
}

function number(value, label, options = {}) {
    if (value === null || value === undefined || typeof value === 'boolean'
        || !['string', 'number'].includes(typeof value) || String(value).trim() === '') {
        throw new InputError(`${label} is required.`);
    }
    const result = Number(value);
    if (!Number.isFinite(result) || result < (options.min ?? 0)
        || result > (options.max ?? 99999999) || (options.integer && !Number.isInteger(result))) {
        throw new InputError(`Enter a valid ${label.toLowerCase()}.`);
    }
    return result;
}

function id(value) {
    return number(value, 'ID', { min: 1, max: 2147483647, integer: true });
}

function text(value, label, max = 150) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
        throw new InputError(`${label} must contain 1–${max} characters.`);
    }
    return value.trim();
}

function dateRange(start, end) {
    for (const value of [start, end]) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            throw new InputError('Choose valid start and end dates.');
        }
        const date = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
            throw new InputError('Choose valid start and end dates.');
        }
    }
    if (start > end) throw new InputError('Start date must be on or before end date.');
    return [start, end];
}

module.exports = { InputError, number, id, text, dateRange };
