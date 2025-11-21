// Background script
console.log("Tab Recycler background loaded.");

// Map of NewTabID -> CandidateTabID
const recyclingMap = new Map();

// Listen for messages from newtab.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'REGISTER_CANDIDATE') {
        const newTabId = sender.tab.id;
        // Support both single ID and array of IDs
        const candidateIds = Array.isArray(message.candidateIds) ? message.candidateIds : [message.candidateId];
        recyclingMap.set(newTabId, candidateIds);
        console.log(`Registered recycling: NewTab ${newTabId} -> Will Close ${candidateIds.join(', ')}`);
    } else if (message.type === 'CANCEL_RECYCLE') {
        const newTabId = sender.tab.id;
        if (recyclingMap.has(newTabId)) {
            console.log(`Cancelled recycling for NewTab ${newTabId}`);
            recyclingMap.delete(newTabId);
        }
    }
});

// Listen for navigation on the new tab
chrome.webNavigation.onCommitted.addListener((details) => {
    // We only care about the main frame
    if (details.frameId !== 0) return;

    const newTabId = details.tabId;

    if (recyclingMap.has(newTabId)) {
        const candidateIds = recyclingMap.get(newTabId);

        // Check transition type to ensure it's a user action (typed, auto_bookmark, generated, etc.)
        // We generally want to recycle on ANY navigation away from newtab.html
        // But we must avoid recycling if the navigation is TO newtab.html (initial load) - handled by registration timing

        console.log(`Navigation detected on ${newTabId}. Closing candidates ${candidateIds.join(', ')}.`);

        // Fetch all tabs first to avoid race conditions with storage
        const tabPromises = candidateIds.map(id => new Promise(resolve => {
            chrome.tabs.get(id, tab => {
                if (chrome.runtime.lastError || !tab) {
                    resolve(null);
                } else {
                    resolve(tab);
                }
            });
        }));

        Promise.all(tabPromises).then(async (tabs) => {
            const validTabs = tabs.filter(t => t !== null);
            if (validTabs.length > 0) {
                await addBatchToHistory(validTabs);
            }

        // Then remove all
            candidateIds.forEach(id => {
                chrome.tabs.remove(id).catch(err => console.log(`Could not close tab ${id} (maybe already closed):`, err));
            });
        });
        recyclingMap.delete(newTabId);
    }
});

// Clean up map if the new tab is closed without navigating
chrome.tabs.onRemoved.addListener((tabId) => {
    if (recyclingMap.has(tabId)) {
        recyclingMap.delete(tabId);
    }
    // Clean up preview
    chrome.storage.local.remove(`preview_${tabId}`);
});

// --- Screenshot Capture Logic ---

const captureQueue = [];
let isCapturing = false;

function scheduleCapture(tabId) {
    // Remove if already in queue to move to back (or just ignore? let's just push if not present)
    if (!captureQueue.includes(tabId)) {
        captureQueue.push(tabId);
        processQueue();
    }
}

function processQueue() {
    if (isCapturing || captureQueue.length === 0) return;

    const tabId = captureQueue.shift();
    isCapturing = true;

    // Small delay before processing to allow rendering to settle, 
    // and also serves as part of the rate limiting buffer.
    setTimeout(() => {
        performCapture(tabId);
    }, 500);
}

function performCapture(tabId) {
    chrome.tabs.get(tabId, (tab) => {
        // If tab is gone or error, just continue
        if (chrome.runtime.lastError || !tab) {
            finishCapture();
            return;
        }

        // Must be active to capture
        if (!tab.active) {
            // If it's not active anymore, we can't capture it with captureVisibleTab.
            // Just skip it.
            finishCapture();
            return;
        }

        // Don't capture restricted URLs or empty URLs
        if (!tab.url ||
            tab.url.startsWith('chrome://') ||
            tab.url.startsWith('edge://') ||
            tab.url.startsWith('about:') ||
            tab.url.startsWith('chrome-extension://') ||
            tab.url.startsWith('file://') ||
            tab.url.startsWith('data:') ||
            tab.url.startsWith('view-source:') ||
            tab.url.includes('newtab.html')) {
            finishCapture();
            return;
        }

        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 20 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                // Ignore specific noisy errors
                const msg = chrome.runtime.lastError.message;
                const ignoredErrors = [
                    "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND",
                    "Cannot access contents of url",
                    "activeTab permission",
                    "Extension manifest must request permission"
                ];

                if (!ignoredErrors.some(err => msg.includes(err))) {
                    console.warn(`Capture skipped for tab ${tabId}: ${msg}`);
                }
            } else if (dataUrl) {
                // console.log(`Captured preview for tab ${tabId}`);
                const key = `preview_${tabId}`;
                chrome.storage.local.set({ [key]: dataUrl });
            }
            finishCapture();
        });
    });
}

function finishCapture() {
    // Enforce minimum interval between captures to respect quota (2 calls per second max)
    // We wait 1000ms before allowing next capture to be safe.
    setTimeout(() => {
        isCapturing = false;
        processQueue();
    }, 1000);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active) {
        scheduleCapture(tabId);
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    scheduleCapture(activeInfo.tabId);
});

// --- Garbage Collection ---
// Ensure we don't store previews for tabs that no longer exist (e.g. after crash/restart)
function cleanupStorage() {
    chrome.storage.local.get(null, (items) => {
        const previewKeys = Object.keys(items).filter(key => key.startsWith('preview_'));
        if (previewKeys.length === 0) return;

        chrome.tabs.query({}, (tabs) => {
            const openTabIds = new Set(tabs.map(t => t.id));
            const keysToRemove = [];

            previewKeys.forEach(key => {
                const tabId = parseInt(key.replace('preview_', ''), 10);
                if (!openTabIds.has(tabId)) {
                    keysToRemove.push(key);
                }
            });

            if (keysToRemove.length > 0) {
                chrome.storage.local.remove(keysToRemove);
                console.log(`Cleaned up ${keysToRemove.length} orphaned previews.`);
            }
        });
    });
}

chrome.runtime.onStartup.addListener(cleanupStorage);
chrome.runtime.onInstalled.addListener(cleanupStorage);

// --- Context Menu ---
chrome.runtime.onInstalled.addListener(() => {
    // Create context menu for extension icon
    chrome.contextMenus.create({
        id: 'add-to-whitelist',
        title: 'Add current site to whitelist',
        contexts: ['action']
    });

    chrome.contextMenus.create({
        id: 'configure-pause-duration',
        title: 'Configure pause duration',
        contexts: ['action']
    });

    // Cleanup expired pauses on startup
    cleanupExpiredPauses();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'add-to-whitelist' && tab) {
        addCurrentSiteToWhitelist(tab);
    } else if (info.menuItemId === 'configure-pause-duration') {
        // Open popup (or could open an options page)
        chrome.action.openPopup();
    }
});

async function addCurrentSiteToWhitelist(tab) {
    try {
        const url = new URL(tab.url);
        const hostname = url.hostname;
        const data = await chrome.storage.local.get('blocklist');
        const blocklist = data.blocklist || [];
        if (!blocklist.includes(hostname)) {
            blocklist.push(hostname);
            await chrome.storage.local.set({ blocklist });
            console.log(`Added ${hostname} to whitelist`);
        }
    } catch (e) {
        console.error('Failed to add to whitelist:', e);
    }
}

// Cleanup expired pauses
async function cleanupExpiredPauses() {
    try {
        const data = await chrome.storage.local.get('pausedTabs');
        const pausedTabs = data.pausedTabs || {};
        const now = Date.now();
        let changed = false;

        Object.keys(pausedTabs).forEach(tabId => {
            if (pausedTabs[tabId] <= now) {
                delete pausedTabs[tabId];
                changed = true;
            }
        });

        if (changed) {
            await chrome.storage.local.set({ pausedTabs });
            console.log('Cleaned up expired pauses');
        }
    } catch (e) {
        console.error('Failed to cleanup pauses:', e);
    }
}

// Run pause cleanup periodically (every hour)
setInterval(cleanupExpiredPauses, 60 * 60 * 1000);

// History Management (Duplicated from newtab.js for background execution)
async function addBatchToHistory(tabs) {
    try {
        const data = await chrome.storage.local.get('recyclingHistory');
        let history = data.recyclingHistory || [];

        // Add all new items
        tabs.forEach(tab => {
            history.unshift({
                title: tab.title,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                timestamp: Date.now()
            });
        });

        // Keep last 10
        if (history.length > 10) {
            history = history.slice(0, 10);
        }

        await chrome.storage.local.set({ recyclingHistory: history });
        console.log(`Saved ${tabs.length} tabs to history.`);
    } catch (e) {
        console.error("Error saving history:", e);
    }
}
