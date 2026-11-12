
(() => {
    const toggle = document.getElementById('accessibility-toggle');
    const panel = document.getElementById('accessibility-panel');
    if (!toggle || !panel) return;

    const status = document.getElementById('accessibility-status');
    const settings = { textScale: 1, controlScale: 1, highContrast: false, readableSpacing: false, language: 'en' };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const textControls = 'button, input, select, textarea, [role="button"]';
    const roundControls = '.kiosk-add-drink, .kiosk-quantity-button, .accessibility-close';

    function collectElements(root) {
        const elements = [];
        if (root.nodeType === Node.ELEMENT_NODE) elements.push(root);
        if (root.querySelectorAll) elements.push(...root.querySelectorAll('*'));
        return elements;
    }

    function hasDirectText(element) {
        return Array.from(element.childNodes).some(node =>
            node.nodeType === Node.TEXT_NODE && node.textContent.trim()
        );
    }

    function captureAccessibilitySizes(root = document.body) {
        const page = document.body;
        const previousTextScale = page.style.getPropertyValue('--accessibility-text-scale');
        const previousControlScale = page.style.getPropertyValue('--accessibility-control-scale');

        page.style.setProperty('--accessibility-text-scale', '1');
        page.style.setProperty('--accessibility-control-scale', '1');

        collectElements(root).forEach(element => {
            if ((hasDirectText(element) || element.matches(textControls)) && !element.dataset.accessibilityBaseFontSize) {
                const baseFontSize = getComputedStyle(element).fontSize;
                element.dataset.accessibilityBaseFontSize = baseFontSize;
                element.style.setProperty('font-size', `calc(${baseFontSize} * var(--accessibility-text-scale, 1))`, 'important');
            }

            if (element.matches(textControls) && !element.dataset.accessibilityBaseControlSize) {
                const style = getComputedStyle(element);
                const base = {
                    minHeight: style.minHeight,
                    paddingTop: style.paddingTop,
                    paddingRight: style.paddingRight,
                    paddingBottom: style.paddingBottom,
                    paddingLeft: style.paddingLeft
                };

                if (element.matches(roundControls)) {
                    base.width = style.width;
                    base.height = style.height;
                }

                element.dataset.accessibilityBaseControlSize = JSON.stringify(base);
                element.style.setProperty('min-height', `calc(${base.minHeight} * var(--accessibility-control-scale, 1))`, 'important');
                element.style.setProperty('padding-top', `calc(${base.paddingTop} * var(--accessibility-control-scale, 1))`, 'important');
                element.style.setProperty('padding-right', `calc(${base.paddingRight} * var(--accessibility-control-scale, 1))`, 'important');
                element.style.setProperty('padding-bottom', `calc(${base.paddingBottom} * var(--accessibility-control-scale, 1))`, 'important');
                element.style.setProperty('padding-left', `calc(${base.paddingLeft} * var(--accessibility-control-scale, 1))`, 'important');

                if (base.width) element.style.setProperty('width', `calc(${base.width} * var(--accessibility-control-scale, 1))`, 'important');
                if (base.height) element.style.setProperty('height', `calc(${base.height} * var(--accessibility-control-scale, 1))`, 'important');
            }
        });

        if (previousTextScale) page.style.setProperty('--accessibility-text-scale', previousTextScale);
        else page.style.removeProperty('--accessibility-text-scale');

        if (previousControlScale) page.style.setProperty('--accessibility-control-scale', previousControlScale);
        else page.style.removeProperty('--accessibility-control-scale');
    }

    function refreshAccessibilitySizes() {
        const page = document.body;
        page.style.setProperty('--accessibility-text-scale', '1');
        page.style.setProperty('--accessibility-control-scale', '1');

        document.querySelectorAll('[data-accessibility-base-font-size]').forEach(element => {
            element.style.removeProperty('font-size');
            delete element.dataset.accessibilityBaseFontSize;
        });

        document.querySelectorAll('[data-accessibility-base-control-size]').forEach(element => {
            const base = JSON.parse(element.dataset.accessibilityBaseControlSize);
            ['min-height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'].forEach(property => element.style.removeProperty(property));
            if (base.width) element.style.removeProperty('width');
            if (base.height) element.style.removeProperty('height');
            delete element.dataset.accessibilityBaseControlSize;
        });

        captureAccessibilitySizes(document.body);
        page.style.setProperty('--accessibility-text-scale', settings.textScale);
        page.style.setProperty('--accessibility-control-scale', settings.controlScale);
    }

    function applySettings(message = 'Accessibility settings updated.') {
        const page = document.body;
        page.style.setProperty('--accessibility-text-scale', settings.textScale);
        page.style.setProperty('--accessibility-control-scale', settings.controlScale);
        page.classList.toggle('accessibility-high-contrast', settings.highContrast);
        page.classList.toggle('accessibility-readable-spacing', settings.readableSpacing);
        document.getElementById('accessibility-high-contrast').checked = settings.highContrast;
        document.getElementById('accessibility-readable-spacing').checked = settings.readableSpacing;
        status.textContent = message;

        try {
            localStorage.setItem('pos-accessibility-settings', JSON.stringify(settings));
        } catch { /* Storage may be unavailable. */ }
    }

    try {
        const saved = JSON.parse(localStorage.getItem('pos-accessibility-settings') || '{}');
        Object.assign(settings, saved);
        settings.textScale = clamp(Number(settings.textScale) || 1, 0.9, 1.5);
        settings.controlScale = clamp(Number(settings.controlScale) || 1, 1, 1.5);
        settings.language = settings.language === 'es' ? 'es' : 'en';
    } catch { /* Start with accessible defaults if storage is unavailable. */ }

    function setLanguage(language) {
        settings.language = language;
        document.documentElement.lang = language;

        try {
            localStorage.setItem('pos-accessibility-settings', JSON.stringify(settings));
        } catch { /* Storage may be unavailable. */ }

        const detail = { language, source: 'accessibility-menu' };
        document.dispatchEvent(new CustomEvent('accessibility:language-change', { detail }));
        document.dispatchEvent(new CustomEvent('kiosk:language-change', { detail }));

        status.textContent = language === 'es'
            ? 'Español seleccionado. La integración de traducción está pendiente.'
            : 'English selected. Translation integration is ready to be connected.';
    }

    toggle.addEventListener('click', () => {
        const opening = panel.hidden;
        panel.hidden = !opening;
        toggle.setAttribute('aria-expanded', String(opening));
        if (opening) document.getElementById('accessibility-language').focus();
    });

    document.getElementById('accessibility-close').addEventListener('click', closePanel);

    function closePanel() {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
    }

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !panel.hidden) closePanel();
    });

    document.getElementById('accessibility-language').addEventListener('change', event => setLanguage(event.target.value));

    document.getElementById('accessibility-text-smaller').addEventListener('click', () => {
        settings.textScale = clamp(Math.round((settings.textScale - 0.1) * 10) / 10, 0.9, 1.5);
        applySettings('Text size decreased.');
    });

    document.getElementById('accessibility-text-larger').addEventListener('click', () => {
        settings.textScale = clamp(Math.round((settings.textScale + 0.1) * 10) / 10, 0.9, 1.5);
        applySettings('Text size increased.');
    });

    document.getElementById('accessibility-text-reset').addEventListener('click', () => {
        settings.textScale = 1;
        applySettings('Text size reset. Other accessibility settings were not changed.');
    });

    document.getElementById('accessibility-controls-smaller').addEventListener('click', () => {
        settings.controlScale = clamp(Math.round((settings.controlScale - 0.1) * 10) / 10, 1, 1.5);
        applySettings('Button size decreased.');
    });

    document.getElementById('accessibility-controls-larger').addEventListener('click', () => {
        settings.controlScale = clamp(Math.round((settings.controlScale + 0.1) * 10) / 10, 1, 1.5);
        applySettings('Button size increased.');
    });

    document.getElementById('accessibility-controls-reset').addEventListener('click', () => {
        settings.controlScale = 1;
        applySettings('Button size reset. Other accessibility settings were not changed.');
    });

    document.getElementById('accessibility-high-contrast').addEventListener('change', event => {
        settings.highContrast = event.target.checked;
        applySettings();
    });

    document.getElementById('accessibility-readable-spacing').addEventListener('change', event => {
        settings.readableSpacing = event.target.checked;
        applySettings();
    });

    document.getElementById('accessibility-language').value = settings.language;
    document.documentElement.lang = settings.language;

    captureAccessibilitySizes(document.body);
    applySettings('Saved accessibility preferences restored.');

    const observer = new MutationObserver(records => {
        records.forEach(record => {
            record.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) captureAccessibilitySizes(node);
                else if (node.nodeType === Node.TEXT_NODE) captureAccessibilitySizes(record.target);
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    let resizeFrame = 0;
    window.addEventListener('resize', () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(refreshAccessibilitySizes);
    });
})();
