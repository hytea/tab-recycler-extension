// Thresholds are now dynamic based on testingMode

let candidates = [];
let currentCandidateIndex = 0;
let currentProposalIds = [];

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
        const ignoreGroupedTabs = storageData.ignoreGroupedTabs || false;

        // Configuration based on mode
        const minInactiveTime = storageData.minInactiveTime || 3600000;
        const threshold = isTesting ? 10 * 1000 : minInactiveTime;

        // Filter and sort tabs
        candidates = tabs.filter(tab => {
            if (tab.windowId !== currentTab.windowId) return false; // Explicit window check
            if (tab.active || tab.id === currentTab.id) return false;
            if (!tab.lastAccessed) return false;
            if ((now - tab.lastAccessed) <= threshold) return false;

            // Check if tab is paused
            if (pausedTabs[tab.id] && pausedTabs[tab.id] > now) return false;

            // Check if tab is in a group and we should ignore it
            if (ignoreGroupedTabs && tab.groupId !== -1) return false;

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
    currentProposalIds = tabsToRecycle.map(t => t.id);
    showProposal(tabsToRecycle);

    // Register with background script
    chrome.runtime.sendMessage({
        type: 'REGISTER_CANDIDATE',
        candidateIds: currentProposalIds
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
                    <button class="card-pause-btn button-modern warm sm warm" role="button"><span class="text">Pause</span></button>
                </div>
            </div>
            <div class="card-info">
                <div class="card-header">
                    <img class="card-favicon" src="${faviconUrl}" alt="Favicon">
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
                await addToHistory(tab);
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

            // Remove the card visually
            card.remove();

            // Update local tracking
            currentProposalIds = currentProposalIds.filter(id => id !== tab.id);

            // Check if any cards remain
            const remaining = proposalContent.querySelectorAll('.tab-card').length;
            if (remaining === 0) {
                // No candidates left in this batch
                chrome.runtime.sendMessage({ type: 'CANCEL_RECYCLE' });
                skipCandidate();
            } else {
                // Update background script with remaining candidates
                chrome.runtime.sendMessage({
                    type: 'REGISTER_CANDIDATE',
                    candidateIds: currentProposalIds
                });

                // Update header count
                if (headerSpan) {
                    if (remaining > 1) {
                        headerSpan.textContent = `♻️ Ready to Recycle (${remaining} Tabs)`;
                    } else {
                        headerSpan.textContent = `♻️ Ready to Recycle`;
                    }
                }
            }
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
    } catch (e) {
        console.error(e);
    }
}

// History Management
async function addToHistory(tab) {
    try {
        const data = await chrome.storage.local.get('recyclingHistory');
        let history = data.recyclingHistory || [];

        const newItem = {
            title: tab.title,
            url: tab.url,
            favIconUrl: tab.favIconUrl,
            timestamp: Date.now()
        };

        // Add to beginning
        history.unshift(newItem);

        // Keep last 10
        if (history.length > 10) {
            history = history.slice(0, 10);
        }

        await chrome.storage.local.set({ recyclingHistory: history });
    } catch (e) {
        console.error("Error saving history:", e);
    }
}

async function renderHistory() {
    const data = await chrome.storage.local.get('recyclingHistory');
    const history = data.recyclingHistory || [];
    const list = document.getElementById('history-list');
    list.innerHTML = '';

    if (history.length === 0) {
        list.innerHTML = '<div class="empty-history">No history yet.</div>';
        return;
    }

    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';

        // Time formatting
        const date = new Date(item.timestamp);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        div.innerHTML = `
            <img class="history-favicon" src="${item.favIconUrl || 'icons/default.png'}" alt="Favicon">
            <div class="history-details">
                <div class="history-title" title="${item.title}">${item.title}</div>
                <div class="history-url" title="${item.url}">${item.url}</div>
            </div>
            <div class="history-time">${timeStr}</div>
        `;

        div.onclick = () => {
            chrome.tabs.create({ url: item.url });
        };

        list.appendChild(div);
    });
}

// History UI Binding
const modal = document.getElementById('history-modal');
const btnHistory = document.getElementById('btn-history');
const closeHistory = document.getElementById('close-history');

if (btnHistory) {
    btnHistory.onclick = () => {
        renderHistory();
        modal.classList.remove('hidden');
    };
}

if (closeHistory) {
    closeHistory.onclick = () => {
        modal.classList.add('hidden');
    };
}

// Close modal when clicking outside
window.onclick = (event) => {
    if (event.target == modal) {
        modal.classList.add('hidden');
    }
};

// News Feed Functionality
async function loadNewsFeed() {
    const newsContainer = document.getElementById('news-items');

    try {
        // Using the free tier of Hacker News API as a reliable, CORS-friendly source
        const response = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
        const storyIds = await response.json();

        // Get the top 5 stories
        const topStoryIds = storyIds.slice(0, 5);
        const stories = await Promise.all(
            topStoryIds.map(id =>
                fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
                    .then(r => r.json())
            )
        );

        // Clear loading state
        newsContainer.innerHTML = '';

        // Render news items
        stories.forEach(story => {
            if (!story) return;

            const newsItem = document.createElement('a');
            newsItem.className = 'news-item';
            newsItem.href = story.url || `https://news.ycombinator.com/item?id=${story.id}`;
            newsItem.target = '_blank';
            newsItem.rel = 'noopener noreferrer';

            // Calculate time ago
            const timeAgo = getTimeAgo(story.time * 1000);

            newsItem.innerHTML = `
                <div class="news-item-source">HN</div>
                <div class="news-item-content">
                    <h3 class="news-item-title">${escapeHtml(story.title)}</h3>
                    <div class="news-item-time">${timeAgo} • ${story.score || 0} points</div>
                </div>
            `;

            newsContainer.appendChild(newsItem);
        });
    } catch (error) {
        console.error('Failed to load news:', error);
        newsContainer.innerHTML = '<div style="text-align: center; color: #9aa0a6; padding: 20px; font-size: 12px;">Unable to load news</div>';
    }
}

function getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Load news feed on page load
loadNewsFeed();

init();
