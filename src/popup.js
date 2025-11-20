document.addEventListener('DOMContentLoaded', async () => {
    const testToggle = document.getElementById('testing-mode');
    const cleanupToggle = document.getElementById('cleanup-mode');
    const pauseDurationSelect = document.getElementById('pause-duration');
    const customDurationContainer = document.getElementById('custom-duration-container');
    const customDurationInput = document.getElementById('custom-duration');
    const whitelistContainer = document.getElementById('whitelist-container');
    const statusText = document.getElementById('status-text');

    // Load current state
    const data = await chrome.storage.local.get(['testingMode', 'recyclingMode', 'pauseDuration', 'blocklist']);
    testToggle.checked = !!data.testingMode;
    cleanupToggle.checked = data.recyclingMode === 'cleanup';

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
    testToggle.addEventListener('change', async () => {
        await chrome.storage.local.set({ testingMode: testToggle.checked });
        updateStatus();
    });

    cleanupToggle.addEventListener('change', async () => {
        const mode = cleanupToggle.checked ? 'cleanup' : 'standard';
        await chrome.storage.local.set({ recyclingMode: mode });
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
        const isTesting = testToggle.checked;
        const isCleanup = cleanupToggle.checked;

        // Get actual pause duration value
        let pauseDuration;
        if (pauseDurationSelect.value === 'custom') {
            pauseDuration = customDurationInput.value;
        } else {
            pauseDuration = pauseDurationSelect.value;
        }

        const timeThreshold = isTesting ? "10 seconds" : "1 hour";
        const countBehavior = isCleanup
            ? "up to 3 tabs will be proposed for recycling"
            : "the single best candidate will be recycled";

        statusText.innerHTML = `
            <strong>Current Behavior:</strong><br>
            Tabs inactive for over ${timeThreshold} are candidates. 
            When opening a new tab, ${countBehavior}.<br>
            <strong>Pause Duration:</strong> ${pauseDuration} hour${pauseDuration > 1 ? 's' : ''}
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
