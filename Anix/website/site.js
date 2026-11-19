const APK_URL = '/downloads/Base-Tele-X-WA.apk';
const BOT_LINK_HOSTS = new Set(['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me']);
const SCROLL_COLORS = [
    '#ff304f',
    '#ff476d',
    '#f743a6',
    '#be56f4',
    '#7566ff',
    '#438bff',
    '#27c7e5',
    '#35e0bd',
    '#7ee65a',
    '#e0ed48',
    '#ffb338',
    '#ff6745',
];

function colorAt(progress) {
    const position = progress * (SCROLL_COLORS.length - 1);
    const start = Math.floor(position);
    const end = Math.min(start + 1, SCROLL_COLORS.length - 1);
    const mix = position - start;
    const from = SCROLL_COLORS[start].match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16));
    const to = SCROLL_COLORS[end].match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16));
    const channels = from.map((value, index) => Math.round(value + (to[index] - value) * mix));
    return `rgb(${channels.join(' ')})`;
}

function initializeMotion() {
    const progress = document.querySelector('#scroll-progress');
    let scrollFrame = 0;
    const updateProgress = () => {
        if (scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
            const scrollable = document.documentElement.scrollHeight - window.innerHeight;
            const amount = scrollable > 0 ? window.scrollY / scrollable : 0;
            const scrollAmount = Math.min(1, Math.max(0, amount));
            progress.style.transform = `scaleX(${scrollAmount})`;
            document.documentElement.style.setProperty('--scroll-accent', colorAt(scrollAmount));
            scrollFrame = 0;
        });
    };

    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
    updateProgress();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    document.documentElement.classList.add('motion-ready');
    const revealTargets = document.querySelectorAll('[data-reveal]');
    revealTargets.forEach((target) => {
        const delay = Math.max(0, Number(target.dataset.delay) || 0);
        target.style.setProperty('--reveal-delay', `${delay}ms`);
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.14, rootMargin: '0px 0px -35px 0px' });

        revealTargets.forEach((target) => observer.observe(target));
    } else {
        revealTargets.forEach((target) => target.classList.add('is-visible'));
    }

    if (!window.matchMedia('(pointer: fine)').matches) return;

    const pointerGlow = document.querySelector('#pointer-glow');
    document.body.classList.add('has-pointer-glow');
    window.addEventListener('pointermove', (event) => {
        pointerGlow.style.setProperty('--pointer-x', `${event.clientX}px`);
        pointerGlow.style.setProperty('--pointer-y', `${event.clientY}px`);
    }, { passive: true });

    const card = document.querySelector('.hero-card');
    card.addEventListener('pointermove', (event) => {
        const bounds = card.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const y = (event.clientY - bounds.top) / bounds.height - 0.5;
        card.style.setProperty('--tilt-x', `${-y * 5}deg`);
        card.style.setProperty('--tilt-y', `${x * 6}deg`);
    });
    card.addEventListener('pointerleave', () => {
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
    });

    document.querySelectorAll('.feature-card').forEach((feature) => {
        feature.addEventListener('pointermove', (event) => {
            const bounds = feature.getBoundingClientRect();
            feature.style.setProperty('--card-x', `${event.clientX - bounds.left}px`);
            feature.style.setProperty('--card-y', `${event.clientY - bounds.top}px`);
        });
    });
}

function enableTelegramLinks(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return;
    }

    if (url.protocol !== 'https:' || !BOT_LINK_HOSTS.has(url.hostname.toLowerCase())) return;

    document.querySelectorAll('[data-telegram-link]').forEach((link) => {
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.removeAttribute('aria-disabled');
        link.textContent = link.dataset.readyLabel;
    });
}

async function configureDownloads() {
    const link = document.querySelector('[data-apk-link]');
    try {
        const response = await fetch(APK_URL, { method: 'HEAD', cache: 'no-store' });
        if (!response.ok) return;

        link.disabled = false;
        link.addEventListener('click', () => window.location.assign(APK_URL));
        link.innerHTML = 'Download the APK <span aria-hidden="true">↓</span>';
    } catch (error) {
        console.error('[website] Could not check for the Android APK:', error);
    }
}

async function configureBackgroundMedia() {
    const video = document.querySelector('#background-video');
    const music = document.querySelector('#background-music');
    const musicToggle = document.querySelector('#music-toggle');
    const musicLabel = document.querySelector('#music-label');

    try {
        const response = await fetch('/assets/videos/landing.mp4', { method: 'HEAD', cache: 'no-store' });
        if (response.ok) {
            video.src = '/assets/videos/landing.mp4';
            video.addEventListener('canplay', () => video.classList.add('is-ready'), { once: true });
            video.play().catch((error) => console.warn('[website] Background video could not autoplay:', error));
        }
    } catch (error) {
        console.error('[website] Could not check for the background video:', error);
    }

    try {
        const response = await fetch('/assets/videos/music.mp3', { method: 'HEAD', cache: 'no-store' });
        if (!response.ok) return;

        music.src = '/assets/videos/music.mp3';
        music.volume = 0.25;
        musicToggle.hidden = false;
        musicToggle.addEventListener('click', async () => {
            if (music.paused) {
                try {
                    await music.play();
                    musicLabel.textContent = 'Sound on';
                    musicToggle.setAttribute('aria-label', 'Turn background music off');
                } catch (error) {
                    console.error('[website] Background music could not start:', error);
                }
                return;
            }

            music.pause();
            musicLabel.textContent = 'Sound off';
            musicToggle.setAttribute('aria-label', 'Turn background music on');
        });
    } catch (error) {
        console.error('[website] Could not check for background music:', error);
    }
}

function initializeMascot() {
    const companion = document.querySelector('#mascot-companion');
    const button = document.querySelector('#mascot-button');
    const speech = document.querySelector('#mascot-speech');
    const pupils = companion.querySelectorAll('.mascot-pupil');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const expressionNames = ['is-happy', 'is-wink', 'is-surprised', 'is-love', 'is-playful', 'is-curious', 'is-angry'];
    const idleLines = [
        { expression: 'is-happy', message: 'Hey, I’m RICHY MD. Ready to pair your WhatsApp?' },
        { expression: 'is-curious', message: 'GTA 6 question: what are you most excited to explore?' },
        { expression: 'is-curious', message: 'In GTA 6, would you explore first or jump into missions?' },
        { expression: 'is-curious', message: 'Who are you more curious about in GTA 6: Lucia or Jason?' },
        { expression: 'is-playful', message: 'What’s your wildest GTA 6 prediction?' },
        { expression: 'is-happy', message: 'I’ll be right here if you need a hand getting paired.' },
    ];
    let lineIndex = -1;
    let speechTimeout;
    let chatterTimeout;
    let blinkTimeout;
    let blinkCloseTimeout;

    const speak = (message, expression, duration) => {
        window.clearTimeout(speechTimeout);
        companion.classList.remove(...expressionNames, 'is-speaking', 'is-reacting');
        companion.classList.add(expression, 'is-speaking', 'has-message');
        speech.textContent = message;
        button.setAttribute('aria-label', `RICHY MD says: ${message}`);

        speechTimeout = window.setTimeout(() => {
            companion.classList.remove(expression, 'is-speaking', 'is-reacting', 'has-message');
            button.setAttribute('aria-label', 'RICHY MD companion. Click for a reaction.');
        }, duration);
    };

    const scheduleAutonomousSpeech = (delay = 1800) => {
        window.clearTimeout(chatterTimeout);
        if (document.hidden) return;

        chatterTimeout = window.setTimeout(() => {
            lineIndex = (lineIndex + 1) % idleLines.length;
            const line = idleLines[lineIndex];
            speak(line.message, line.expression, 3600);
            scheduleAutonomousSpeech(7800 + Math.random() * 4200);
        }, delay);
    };

    button.addEventListener('click', () => {
        window.clearTimeout(chatterTimeout);
        speak('No! Easy there!', 'is-angry', 2100);
        companion.classList.add('is-reacting');
        scheduleAutonomousSpeech(6200);
    });

    const scheduleBlink = () => {
        if (reducedMotion || document.hidden) return;
        blinkTimeout = window.setTimeout(() => {
            companion.classList.add('is-blinking');
            blinkCloseTimeout = window.setTimeout(() => companion.classList.remove('is-blinking'), 125);
            scheduleBlink();
        }, 2600 + Math.random() * 3600);
    };

    if (!reducedMotion) {
        scheduleBlink();
    }
    scheduleAutonomousSpeech();

    document.addEventListener('visibilitychange', () => {
        window.clearTimeout(chatterTimeout);
        window.clearTimeout(blinkTimeout);
        window.clearTimeout(blinkCloseTimeout);
        window.clearTimeout(speechTimeout);
        companion.classList.remove(...expressionNames, 'is-speaking', 'is-reacting', 'is-blinking', 'has-message');
        companion.classList.remove('is-blinking');
        if (document.hidden) return;
        button.setAttribute('aria-label', 'RICHY MD companion. Click for a reaction.');
        scheduleAutonomousSpeech(1800);
        scheduleBlink();
    });

    if (reducedMotion || !window.matchMedia('(pointer: fine)').matches) return;

    let pointerX = window.innerWidth / 2;
    let pointerY = window.innerHeight / 2;
    let pointerFrame = 0;
    const updateEyes = () => {
        const bounds = button.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height * 0.41;
        const x = Math.max(-4.5, Math.min(4.5, ((pointerX - centerX) / window.innerWidth) * 11));
        const y = Math.max(-3.5, Math.min(3.5, ((pointerY - centerY) / window.innerHeight) * 9));

        pupils.forEach((pupil) => pupil.setAttribute('transform', `translate(${x} ${y})`));
        pointerFrame = 0;
    };

    window.addEventListener('pointermove', (event) => {
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (!pointerFrame) pointerFrame = window.requestAnimationFrame(updateEyes);
    }, { passive: true });

    window.addEventListener('pointerout', (event) => {
        if (event.relatedTarget) return;
        pointerX = window.innerWidth / 2;
        pointerY = window.innerHeight / 2;
        if (!pointerFrame) pointerFrame = window.requestAnimationFrame(updateEyes);
    }, { passive: true });

    window.addEventListener('pagehide', () => {
        window.clearTimeout(blinkTimeout);
        window.clearTimeout(blinkCloseTimeout);
        window.clearTimeout(chatterTimeout);
        window.clearTimeout(speechTimeout);
    }, { once: true });
}

async function initializeWebsite() {
    document.querySelector('#year').textContent = String(new Date().getFullYear());
    initializeMotion();
    initializeMascot();
    document.querySelectorAll('[data-telegram-link]').forEach((link) => {
        link.textContent = link.dataset.missingLabel || link.textContent;
    });

    try {
        const response = await fetch('/site-config.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`site config returned HTTP ${response.status}`);
        const config = await response.json();
        if (config.telegramBotUrl) enableTelegramLinks(config.telegramBotUrl);
    } catch (error) {
        console.error('[website] Could not load the Telegram bot link:', error);
    }

    await Promise.all([configureDownloads(), configureBackgroundMedia()]);
}

initializeWebsite();
