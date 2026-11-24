
(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const inputSelector = 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input[type="url"], textarea';
    let activeButton = null;
    let activeRecognition = null;
    let language = document.documentElement.lang === 'es' ? 'es-US' : 'en-US';

    function resetButton() {
        if (activeButton) {
            activeButton.classList.remove('voice-input-active');
            activeButton.setAttribute('aria-label', 'Start voice typing');
            activeButton.setAttribute('aria-pressed', 'false');
            activeButton.title = 'Start voice typing';
        }
        activeButton = null;
        activeRecognition = null;
    }

    function stopListening() {
        const recognition = activeRecognition;
        resetButton();
        if (recognition) recognition.stop();
    }

    function insertText(control, text) {
        const start = Number.isInteger(control.selectionStart) ? control.selectionStart : control.value.length;
        const end = Number.isInteger(control.selectionEnd) ? control.selectionEnd : control.value.length;
        const before = control.value.slice(0, start);
        const after = control.value.slice(end);
        const separator = before && !/\s$/.test(before) ? ' ' : '';
        const value = `${before}${separator}${text}${after}`;
        const cursor = before.length + separator.length + text.length;
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')?.set;
        if (setter) setter.call(control, value);
        else control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        control.focus();
        if (typeof control.setSelectionRange === 'function') control.setSelectionRange(cursor, cursor);
    }

    function startListening(control, button) {
        if (!SpeechRecognition) {
            window.alert('Voice typing is not supported in this browser. Please use Chrome or Edge.');
            return;
        }

        if (activeRecognition) stopListening();

        const recognition = new SpeechRecognition();
        recognition.lang = language;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        activeRecognition = recognition;
        activeButton = button;

        button.classList.add('voice-input-active');
        button.setAttribute('aria-label', 'Stop voice typing');
        button.setAttribute('aria-pressed', 'true');
        button.title = 'Listening... click to stop';

        recognition.onresult = event => {
            let finalText = '';
            let interimText = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) finalText += transcript;
                else interimText += transcript;
            }

            if (finalText.trim()) insertText(control, finalText.trim());

            if (activeButton === button && interimText.trim()) {
                button.title = `Hearing: ${interimText.trim()}`;
            } else if (activeButton === button) {
                button.title = 'Listening... click to stop';
            }
        };

        recognition.onerror = event => {
            if (activeRecognition !== recognition) return;

            if (event.error !== 'no-speech' && event.error !== 'aborted') {
                resetButton();

                const message = event.error === 'not-allowed'
                    ? 'Microphone permission was denied. Allow microphone access in your browser settings.'
                    : event.error === 'network'
                        ? 'Speech recognition needs an internet connection. Please try again.'
                        : 'Voice typing encountered an error. Please try again.';

                window.alert(message);
            }
        };

        recognition.onend = () => {
            if (activeRecognition === recognition) resetButton();
        };

        try {
            recognition.start();
        } catch {
            resetButton();
            window.alert('Voice typing could not start. Please try again.');
        }
    }

    function addVoiceButton(control) {
        if (control.dataset.voiceInputReady || control.disabled || control.readOnly) return;
        if (control.matches('input') && ['password', 'hidden', 'number', 'date', 'time', 'checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'color', 'range'].includes(control.type)) return;
        if (control.closest('.voice-input-wrap')) return;

        control.dataset.voiceInputReady = 'true';

        const wrapper = document.createElement('span');
        wrapper.className = 'voice-input-wrap';
        control.parentNode.insertBefore(wrapper, control);
        wrapper.append(control);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'voice-input-button';
        button.textContent = '🎙';
        button.title = 'Start voice typing';
        button.setAttribute('aria-label', 'Start voice typing');
        button.setAttribute('aria-pressed', 'false');

        button.addEventListener('click', () => {
            if (activeButton === button) stopListening();
            else startListening(control, button);
        });

        wrapper.append(button);
    }

    function scan(root = document) {
        if (root.matches?.(inputSelector)) addVoiceButton(root);
        root.querySelectorAll?.(inputSelector).forEach(addVoiceButton);
    }

    if (!SpeechRecognition) {
        document.documentElement.classList.add('voice-input-unsupported');
        return;
    }

    scan();

    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }))).observe(document.body, { childList: true, subtree: true });

    document.addEventListener('accessibility:language-change', event => {
        language = event.detail?.language === 'es' ? 'es-US' : 'en-US';
        if (activeRecognition) stopListening();
    });
})();
