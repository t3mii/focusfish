
const DEFAULT_SITES = [
  "roblox.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com"
];

const BLOCK_RULE_ID_START = 1000;
const TRACKING_ALARM = "focusfish-tracking";

const EMPTY_STATS = {
  siteTimeMs: {},
  idleTimeMs: 0,
  blockedAttempts: 0
};

async function getState() {
  return chrome.storage.local.get({
    sessionActive: false,
    blockedSites: DEFAULT_SITES,
    sessionStartedAt: null,
    sessionStats: EMPTY_STATS,
    trackingDomain: null,
    trackingCheckpointAt: null,
    browserIdle: false
  });
}

function isValidDomain(site) {
  return typeof site === "string" &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(site);
}

async function getActiveDomain() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  const url = tabs[0]?.url;

  if (!url) return null;

  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }

    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function updateBlockingRules(sites, enabled) {
  const oldRules =
    await chrome.declarativeNetRequest.getDynamicRules();

  const removeRuleIds = oldRules
    .filter(rule => rule.id >= BLOCK_RULE_ID_START)
    .map(rule => rule.id);

  const addRules = enabled
    ? sites.map((site, index) => ({
        id: BLOCK_RULE_ID_START + index,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { extensionPath: "/blocked.html" }
        },
        condition: {
          requestDomains: [site],
          resourceTypes: ["main_frame"]
        }
      }))
    : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });
}

// Save elapsed time since the last checkpoint.
async function recordActivity() {
  const state = await getState();
  const now = Date.now();
  const checkpoint = state.trackingCheckpointAt;

  if (!state.sessionActive || !checkpoint) return;

  // Avoid recording an enormous duration after an extended suspension.
  const elapsed = Math.min(now - checkpoint, 2 * 60 * 1000);

  if (elapsed > 0) {
    const stats = {
      ...EMPTY_STATS,
      ...state.sessionStats,
      siteTimeMs: {
        ...(state.sessionStats?.siteTimeMs || {})
      }
    };

    if (state.browserIdle) {
      stats.idleTimeMs += elapsed;
    } else if (state.trackingDomain) {
      const domain = state.trackingDomain;

      stats.siteTimeMs[domain] =
        (stats.siteTimeMs[domain] || 0) + elapsed;
    }

    await chrome.storage.local.set({ sessionStats: stats });
  }

  await chrome.storage.local.set({
    trackingCheckpointAt: now
  });
}

async function refreshTrackedDomain() {
  await recordActivity();

  const state = await getState();
  if (!state.sessionActive) return;

  const domain = state.browserIdle
    ? null
    : await getActiveDomain();

  await chrome.storage.local.set({
    trackingDomain: domain,
    trackingCheckpointAt: Date.now()
  });
}

async function startSession() {
  const state = await getState();

  await updateBlockingRules(state.blockedSites, true);

  const idleState = await chrome.idle.queryState(60);
  const isIdle = idleState !== "active";

  await chrome.storage.local.set({
    sessionActive: true,
    sessionStartedAt: Date.now(),
    sessionStats: {
      siteTimeMs: {},
      idleTimeMs: 0,
      blockedAttempts: 0
    },
    browserIdle: isIdle,
    trackingDomain: isIdle ? null : await getActiveDomain(),
    trackingCheckpointAt: Date.now()
  });

  await chrome.alarms.create(TRACKING_ALARM, {
    periodInMinutes: 1
  });
}

async function stopSession() {
  await recordActivity();
  await updateBlockingRules([], false);
  await chrome.alarms.clear(TRACKING_ALARM);

  await chrome.storage.local.set({
    sessionActive: false,
    sessionStartedAt: null,
    trackingDomain: null,
    trackingCheckpointAt: null
  });
}

async function updateSites(sites) {
  if (
    !Array.isArray(sites) ||
    !sites.every(isValidDomain) ||
    new Set(sites).size !== sites.length
  ) {
    throw new Error("Invalid website list.");
  }

  const state = await getState();

  if (state.sessionActive) {
    await updateBlockingRules(sites, true);
  }

  await chrome.storage.local.set({ blockedSites: sites });
}

// Checkpoint time periodically while the extension worker is active.
chrome.alarms.create(TRACKING_ALARM, {
  periodInMinutes: 1
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === TRACKING_ALARM) {
    await recordActivity();
  }
});

// Track tab switches and URL changes.
chrome.tabs.onActivated.addListener(async () => {
  await refreshTrackedDomain();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    if (tab.active) {
      if (tab.url?.endsWith("/blocked.html")) {
        const state = await getState();

        if (state.sessionActive) {
          const stats = {
            ...EMPTY_STATS,
            ...state.sessionStats
          };

          stats.blockedAttempts =
            (stats.blockedAttempts || 0) + 1;

          await chrome.storage.local.set({
            sessionStats: stats
          });
        }
      }

      await refreshTrackedDomain();
    }
  }
});

// Stop counting website time when Chrome reports idle or locked.
chrome.idle.setDetectionInterval(60);

chrome.idle.onStateChanged.addListener(async idleState => {
  await recordActivity();

  const state = await getState();
  if (!state.sessionActive) return;

  const isIdle = idleState !== "active";

  await chrome.storage.local.set({
    browserIdle: isIdle,
    trackingDomain: isIdle ? null : await getActiveDomain(),
    trackingCheckpointAt: Date.now()
  });
});

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    (async () => {
      if (message.type === "START_SESSION") {
        await startSession();
        sendResponse({ ok: true });

      } else if (message.type === "STOP_SESSION") {
        await stopSession();
        sendResponse({ ok: true });

      } else if (message.type === "GET_STATE") {
        const state = await getState();

        // Update the latest elapsed time before displaying stats.
        await recordActivity();

        sendResponse(await getState());

      } else if (message.type === "UPDATE_SITES") {
        await updateSites(message.sites);
        sendResponse({ ok: true });

      } else {
        sendResponse({
          ok: false,
          error: "Unknown message type."
        });
      }
    })().catch(error => {
      console.error("FocusFish error:", error);
      sendResponse({ ok: false, error: error.message });
    });

    return true;
  }
);
