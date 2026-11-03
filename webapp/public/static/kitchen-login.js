'use strict';
const form = document.getElementById('kitchen-login-form');
const select = document.getElementById('kitchen-employee');
const message = document.getElementById('login-message');
async function loadEmployees() {
    try {
        const response = await fetch('/api/login-employees?view=kitchen');
        const employees = await response.json();
        if (!response.ok) throw new Error(employees.error || 'Unable to load employees.');
        select.replaceChildren(new Option('Select an employee', ''));
        for (const employee of employees) {
            select.add(new Option(`${employee.name} (${employee.role})`, employee.employee_id));
        }
    } catch (error) { message.textContent = error.message; message.classList.add('error'); }
}
form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!select.value) return;
    const button = form.querySelector('button');
    button.disabled = true;
    try {
        const response = await fetch('/api/session', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ view: 'kitchen', employeeId: select.value })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Sign-in failed.');
        location.assign(result.location);
    } catch (error) {
        message.textContent = error.message;
        message.classList.add('error');
        button.disabled = false;
    }
});
loadEmployees();
