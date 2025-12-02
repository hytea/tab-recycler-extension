document.addEventListener('DOMContentLoaded', async () => {

    const cleanupToggle = document.getElementById('cleanup-mode');
    const ignoreGroupedToggle = document.getElementById('ignore-grouped-tabs');
    const inactivitySelect = document.getElementById('inactivity-threshold');
    const pauseDurationSelect = document.getElementById('pause-duration');
    const customDurationContainer = document.getElementById('custom-duration-container');
    const customDurationInput = document.getElementById('custom-duration');
    const statusText = document.getElementById('status-text');

    // Load current state
    const data = await chrome.storage.local.get(['recyclingMode', 'ignoreGroupedTabs', 'pauseDuration', 'blocklist', 'minInactiveTime']);

    cleanupToggle.checked = data.recyclingMode === 'cleanup';
    ignoreGroupedToggle.checked = !!data.ignoreGroupedTabs;
    inactivitySelect.value = data.minInactiveTime || 3600000;

    const pauseDuration = data.pauseDuration || 4;
    // Check if it's a standard value or custom
    if ([1, 2, 4, 8, 24].includes(pauseDuration)) {
        pauseDurationSelect.value = pauseDuration;
        customDurationContainer.style.display = 'none';
    } else {
        pauseDurationSelect.value = 'custom';
        customDurationInput.value = pauseDuration;
        customDurationContainer.style.display = 'flex';
    }

    updateStatus();

    // Listen for changes


    cleanupToggle.addEventListener('change', async () => {
        const mode = cleanupToggle.checked ? 'cleanup' : 'standard';
        await chrome.storage.local.set({ recyclingMode: mode });
        updateStatus();
    });

    ignoreGroupedToggle.addEventListener('change', async () => {
        await chrome.storage.local.set({ ignoreGroupedTabs: ignoreGroupedToggle.checked });
        updateStatus();
    });

    inactivitySelect.addEventListener('change', async () => {
        await chrome.storage.local.set({ minInactiveTime: parseInt(inactivitySelect.value) });
        updateStatus();
    });

    pauseDurationSelect.addEventListener('change', async () => {
        if (pauseDurationSelect.value === 'custom') {
            customDurationContainer.style.display = 'flex';
            const duration = parseInt(customDurationInput.value);
            await chrome.storage.local.set({ pauseDuration: duration });
        } else {
            customDurationContainer.style.display = 'none';
            const duration = parseInt(pauseDurationSelect.value);
            await chrome.storage.local.set({ pauseDuration: duration });
        }
        updateStatus();
    });

    customDurationInput.addEventListener('change', async () => {
        const duration = parseInt(customDurationInput.value);
        if (duration >= 1 && duration <= 168) {
            await chrome.storage.local.set({ pauseDuration: duration });
            updateStatus();
        }
    });

    function updateStatus() {

        const isCleanup = cleanupToggle.checked;
        const isIgnoreGrouped = ignoreGroupedToggle.checked;

        // Get actual pause duration value
        let pauseDuration;
        if (pauseDurationSelect.value === 'custom') {
            pauseDuration = parseInt(customDurationInput.value, 10);
        } else {
            pauseDuration = parseInt(pauseDurationSelect.value, 10);
        }

        const minInactiveTime = parseInt(inactivitySelect.value);
        let timeThresholdDisplay = "";
        if (minInactiveTime < 60000) {
            timeThresholdDisplay = `${minInactiveTime / 1000} seconds`;
        } else if (minInactiveTime < 3600000) {
            const m = minInactiveTime / 60000;
            timeThresholdDisplay = `${m} minute${m !== 1 ? 's' : ''}`;
        } else {
            const h = minInactiveTime / 3600000;
            timeThresholdDisplay = `${h} hour${h !== 1 ? 's' : ''}`;
        }

        const timeThreshold = timeThresholdDisplay;
        const countText = isCleanup ? "up to 3 tabs" : "1 tab";
        const groupText = isIgnoreGrouped ? "not candidates" : "candidates";

        statusText.innerHTML = `
            <strong>Current Behavior:</strong><br>
            Tabs inactive for over ${timeThreshold} are candidates for recycling. When opening a new tab, ${countText} will be proposed for recycling. Tabs in groups are ${groupText} for recycling. When you pause a tab it will only be proposed as a candidate again after ${pauseDuration} hour${pauseDuration !== 1 ? 's' : ''}.
        `;
    }

    // Screen Navigation
    const screens = {
        main: document.getElementById('main-screen'),
        history: document.getElementById('history-screen'),
        whitelist: document.getElementById('whitelist-screen'),
        priority: document.getElementById('priority-screen')
    };

    const navItems = document.querySelectorAll('.nav-item');
    const backFromHistory = document.getElementById('back-from-history');
    const backFromWhitelist = document.getElementById('back-from-whitelist');
    const backFromPriority = document.getElementById('back-from-priority');

    function switchScreen(screenName) {
        // Hide all screens
        Object.values(screens).forEach(screen => screen.classList.remove('active'));

        // Show selected screen
        screens[screenName].classList.add('active');

        // Update nav items
        navItems.forEach(item => {
            if (item.dataset.screen === screenName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Load data for specific screens
        if (screenName === 'history') {
            loadHistory();
        } else if (screenName === 'whitelist') {
            loadWhitelist();
        } else if (screenName === 'priority') {
            loadPriority();
        }
    }

    // Navigation event listeners
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            switchScreen(item.dataset.screen);
        });
    });

    backFromHistory.addEventListener('click', () => {
        switchScreen('main');
    });

    backFromWhitelist.addEventListener('click', () => {
        switchScreen('main');
    });

    backFromPriority.addEventListener('click', () => {
        switchScreen('main');
    });

    // History Screen Functions
    async function loadHistory() {
        const data = await chrome.storage.local.get('recyclingHistory');
        const history = data.recyclingHistory || [];
        const list = document.getElementById('history-list');
        list.innerHTML = '';

        if (history.length === 0) {
            list.innerHTML = '<div class="empty-state">No recycling history yet.</div>';
            return;
        }

        history.forEach(item => {
            const div = document.createElement('div');
            div.className = 'history-item';

            // Time formatting
            const date = new Date(item.timestamp);
            const now = new Date();
            const diff = now - date;
            const minutes = Math.floor(diff / 60000);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            let timeStr;
            if (days > 0) {
                timeStr = `${days}d ago`;
            } else if (hours > 0) {
                timeStr = `${hours}h ago`;
            } else if (minutes > 0) {
                timeStr = `${minutes}m ago`;
            } else {
                timeStr = 'Just now';
            }

            div.innerHTML = `
                <img class="history-favicon" src="${item.favIconUrl || 'icons/default.png'}" alt="Favicon">
                <div class="history-details">
                    <div class="history-title" title="${item.title}">${item.title}</div>
                    <div class="history-url" title="${item.url}">${item.url}</div>
                </div>
                <div class="history-time">${timeStr}</div>
            `;

            div.addEventListener('click', () => {
                chrome.tabs.create({ url: item.url });
            });

            list.appendChild(div);
        });
    }

    // Whitelist Screen Functions
    async function loadWhitelist() {
        const data = await chrome.storage.local.get('blocklist');
        const blocklist = data.blocklist || [];
        const list = document.getElementById('whitelist-list');
        list.innerHTML = '';

        if (blocklist.length === 0) {
            list.innerHTML = '<div class="empty-state">No sites whitelisted.</div>';
            return;
        }

        blocklist.forEach(site => {
            const item = document.createElement('div');
            item.className = 'whitelist-item';

            const siteName = document.createElement('span');
            siteName.className = 'whitelist-site';
            siteName.textContent = site;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-button';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove from whitelist';

            removeBtn.addEventListener('click', async () => {
                const newBlocklist = blocklist.filter(s => s !== site);
                await chrome.storage.local.set({ blocklist: newBlocklist });
                loadWhitelist();
            });

            item.appendChild(siteName);
            item.appendChild(removeBtn);
            list.appendChild(item);
        });
    }

    // Add whitelist functionality
    const whitelistInput = document.getElementById('whitelist-input');
    const addWhitelistBtn = document.getElementById('add-whitelist-btn');

    async function addToWhitelist() {
        const input = whitelistInput.value.trim();
        if (!input) return;

        // Clean up the input (remove protocol, www, trailing slash)
        let hostname = input.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

        const data = await chrome.storage.local.get('blocklist');
        const blocklist = data.blocklist || [];

        if (!blocklist.includes(hostname)) {
            blocklist.push(hostname);
            await chrome.storage.local.set({ blocklist });
            loadWhitelist();
        }

        whitelistInput.value = '';
    }

    addWhitelistBtn.addEventListener('click', addToWhitelist);
    whitelistInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addToWhitelist();
        }
    });

    // Priority Sites Screen Functions
    async function loadPriority() {
        const data = await chrome.storage.local.get('prioritySites');
        const prioritySites = data.prioritySites || [];
        const list = document.getElementById('priority-list');
        list.innerHTML = '';

        if (prioritySites.length === 0) {
            list.innerHTML = '<div class="empty-state">No priority sites added.</div>';
            return;
        }

        prioritySites.forEach(site => {
            const item = document.createElement('div');
            item.className = 'whitelist-item';

            const siteName = document.createElement('span');
            siteName.className = 'whitelist-site';
            siteName.textContent = site;

            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-button';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove from priority list';

            removeBtn.addEventListener('click', async () => {
                const newPrioritySites = prioritySites.filter(s => s !== site);
                await chrome.storage.local.set({ prioritySites: newPrioritySites });
                loadPriority();
            });

            item.appendChild(siteName);
            item.appendChild(removeBtn);
            list.appendChild(item);
        });
    }

    // Add priority site functionality
    const priorityInput = document.getElementById('priority-input');
    const addPriorityBtn = document.getElementById('add-priority-btn');

    async function addToPriority() {
        const input = priorityInput.value.trim();
        if (!input) return;

        // Clean up the input (remove protocol, www, trailing slash)
        let hostname = input.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

        const data = await chrome.storage.local.get('prioritySites');
        const prioritySites = data.prioritySites || [];

        if (!prioritySites.includes(hostname)) {
            prioritySites.push(hostname);
            await chrome.storage.local.set({ prioritySites });
            loadPriority();
        }

        priorityInput.value = '';
    }

    addPriorityBtn.addEventListener('click', addToPriority);
    priorityInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addToPriority();
        }
    });
});
