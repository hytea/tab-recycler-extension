document.addEventListener('DOMContentLoaded', async () => {

    const cleanupToggle = document.getElementById('cleanup-mode');
    const ignoreGroupedToggle = document.getElementById('ignore-grouped-tabs');
    const inactivitySelect = document.getElementById('inactivity-threshold');
    const pauseDurationSelect = document.getElementById('pause-duration');
    const customDurationContainer = document.getElementById('custom-duration-container');
    const customDurationInput = document.getElementById('custom-duration');
    const statusText = document.getElementById('status-text');
    const whitelistContainer = document.getElementById('whitelist-container');

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
    updateWhitelist(data.blocklist || []);

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

    function updateWhitelist(blocklist) {
        whitelistContainer.innerHTML = '';

        if (blocklist.length === 0) {
            whitelistContainer.innerHTML = '<div style="font-size: 12px; color: #5f6368; padding: 8px;">No sites whitelisted</div>';
            return;
        }

        blocklist.forEach(site => {
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; font-size: 13px; border-bottom: 1px solid #f1f3f4;';

            const siteName = document.createElement('span');
            siteName.textContent = site;
            siteName.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.style.cssText = 'background: none; border: none; color: #d93025; font-size: 18px; cursor: pointer; padding: 0 4px;';
            removeBtn.title = 'Remove from whitelist';

            removeBtn.addEventListener('click', async () => {
                const newBlocklist = blocklist.filter(s => s !== site);
                await chrome.storage.local.set({ blocklist: newBlocklist });
                updateWhitelist(newBlocklist);
            });

            item.appendChild(siteName);
            item.appendChild(removeBtn);
            whitelistContainer.appendChild(item);
        });
    }
});
