// Thresholds are now dynamic based on testingMode

let candidates = [];
let currentCandidateIndex = 0;

async function init() {
    await checkRecyclingCandidates();
}

async function checkRecyclingCandidates() {
    try {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const currentTab = await chrome.tabs.getCurrent();

        if (!currentTab) return;

        const now = Date.now();
        const storageData = await chrome.storage.local.get(null);
        const blocklist = storageData.blocklist || [];
        const pausedTabs = storageData.pausedTabs || {};
        const isTesting = storageData.testingMode || false;

        // Configuration based on mode
        const threshold = isTesting ? 10 * 1000 : 60 * 60 * 1000;

        // Filter and sort tabs
        candidates = tabs.filter(tab => {
            if (tab.windowId !== currentTab.windowId) return false; // Explicit window check
            if (tab.active || tab.id === currentTab.id) return false;
            if (!tab.lastAccessed) return false;
            if ((now - tab.lastAccessed) <= threshold) return false;

            // Check if tab is paused
            if (pausedTabs[tab.id] && pausedTabs[tab.id] > now) return false;

            // TEST REQUIREMENT: Must have a preview (Only in testing mode)
            if (isTesting && !storageData[`preview_${tab.id}`]) return false;

            // Check blocklist (domain)
            try {
                const url = new URL(tab.url);
                if (blocklist.includes(url.hostname)) return false;
            } catch (e) { return false; }

            return true;
        }).sort((a, b) => b.index - a.index);

        if (candidates.length > 0) {
            showCandidate(0);
        }
    } catch (error) {
        console.error("Error checking candidates:", error);
    }
}

async function showCandidate(index) {
    const storageData = await chrome.storage.local.get(null);
    const recyclingMode = storageData.recyclingMode || 'standard';
    const pauseDuration = storageData.pauseDuration || 4;

    // Pause duration display removed as button is gone

    if (index >= candidates.length) {
        // No more candidates
        document.getElementById('recycle-proposal').classList.add('hidden');
        document.getElementById('status').textContent = "No more tabs to recycle.";
        chrome.runtime.sendMessage({ type: 'CANCEL_RECYCLE' });
        return;
    }

    currentCandidateIndex = index;

    let tabsToRecycle = [];
    if (recyclingMode === 'cleanup') {
        // Take up to 3 candidates
        tabsToRecycle = candidates.slice(index, index + 3);
    } else {
        // Standard mode: take 1
        tabsToRecycle = [candidates[index]];
    }

    if (tabsToRecycle.length === 0) return;

    currentBatchSize = tabsToRecycle.length;
    showProposal(tabsToRecycle);

    // Register with background script
    chrome.runtime.sendMessage({
        type: 'REGISTER_CANDIDATE',
        candidateIds: tabsToRecycle.map(t => t.id)
    });
}

function showProposal(tabs) {
    const proposal = document.getElementById('recycle-proposal');
    const proposalContent = document.getElementById('proposal-content');
    const title = document.getElementById('proposal-title'); // Note: This element might be gone from HTML, need to check if we still need a main title?
    // Actually, the header "Ready to Recycle" is static. The dynamic title was part of the old info block.
    // We can update the header or just leave it. Let's update the header to show count if > 1.

    const headerSpan = document.querySelector('.proposal-header span');
    if (tabs.length > 1) {
        headerSpan.textContent = `♻️ Ready to Recycle (${tabs.length} Tabs)`;
    } else {
        headerSpan.textContent = `♻️ Ready to Recycle`;
    }

    // Clear previous content
    proposalContent.innerHTML = '';

    // Render a card for each tab
    tabs.forEach(tab => {
        const card = document.createElement('div');
        card.className = 'tab-card';

        // Calculate time string
        const minutes = Math.floor((Date.now() - tab.lastAccessed) / 60000);
        const hours = Math.floor(minutes / 60);
        let timeText = "";
        if (hours > 0) {
            timeText = `Last used ${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else {
            timeText = `Last used ${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        }

        // Favicon
        const faviconUrl = tab.favIconUrl || 'icons/default.png';

        card.innerHTML = `
            <div class="card-preview-container">
                <img class="card-preview" src="" alt="Loading preview...">
                <div class="card-pause-overlay">
                    <button class="card-pause-btn button-modern warm sm" role="button"><span class="text">Pause</span></button>
                </div>
            </div>
            <div class="card-info">
                <div class="card-header">
                    <img class="card-favicon" src="${faviconUrl}" onerror="this.src='icons/default.png'">
                    <div class="card-title" title="${tab.title}">${tab.title}</div>
                </div>
                <div class="card-url" title="${tab.url}">${tab.url}</div>
                <div class="card-time">${timeText}</div>
            </div>
        `;

        // Load preview
        chrome.storage.local.get(`preview_${tab.id}`, (result) => {
            const dataUrl = result[`preview_${tab.id}`];
            const img = card.querySelector('.card-preview');
            if (dataUrl) {
                img.src = dataUrl;
            } else {
                // Placeholder or hide?
                img.src = 'icons/default_preview.png'; // We don't have this, maybe just a colored block?
                img.style.backgroundColor = '#eee';
                img.alt = 'No Preview';
            }
        });

        // Click card-info to navigate
        const cardInfo = card.querySelector('.card-info');
        cardInfo.onclick = async (e) => {
            e.stopPropagation();
            try {
                await chrome.tabs.update(tab.id, { active: true });
                const current = await chrome.tabs.getCurrent();
                await chrome.tabs.remove(current.id);
            } catch (err) {
                console.error("Could not navigate:", err);
            }
        };

        // Click pause button to pause this tab
        const pauseBtn = card.querySelector('.card-pause-btn');
        pauseBtn.onclick = async (e) => {
            e.stopPropagation();
            await pauseTabs([tab]);
        };

        proposalContent.appendChild(card);
    });

    proposal.classList.remove('hidden');

    // Bind actions
    document.getElementById('btn-skip').onclick = (e) => { e.stopPropagation(); skipCandidate(); };
}

let currentBatchSize = 1;

function skipCandidate() {
    // Move to next candidate batch
    showCandidate(currentCandidateIndex + currentBatchSize);
}

function disableRecyclingForNow() {
    // Clear all candidates and hide the proposal
    candidates = [];
    document.getElementById('recycle-proposal').classList.add('hidden');
    document.getElementById('status').textContent = ""; // Clear status or leave empty
    chrome.runtime.sendMessage({ type: 'CANCEL_RECYCLE' });
}

// Bind close button
document.getElementById('btn-close-recycling').onclick = disableRecyclingForNow;

// Global Hotkeys
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        skipCandidate();
    }
    // Alt+X to disable recycling
    if (e.altKey && (e.key === 'x' || e.key === 'X')) {
        disableRecyclingForNow();
    }
});

async function pauseTabs(tabs) {
    try {
        const data = await chrome.storage.local.get(['pausedTabs', 'pauseDuration']);
        const pausedTabs = data.pausedTabs || {};
        const pauseDuration = data.pauseDuration || 4; // Default 4 hours
        const pauseUntil = Date.now() + (pauseDuration * 60 * 60 * 1000);

        tabs.forEach(tab => {
            pausedTabs[tab.id] = pauseUntil;
        });

        await chrome.storage.local.set({ pausedTabs });
        skipCandidate();
    } catch (e) {
        console.error(e);
        skipCandidate();
    }
}

init();
