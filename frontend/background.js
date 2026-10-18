
const DEFAULT_SITES = [
  "roblox.com",
  "instagram.com",
  "tiktok.com",
  "reddit.com"
];

const BLOCK_RULE_ID_START = 1000;

async function getState() {
  return await chrome.storage.local.get({
    sessionActive: false,
    blockedSites: DEFAULT_SITES,
    sessionStartedAt: null
  });
}

function isValidDomain(site) {
  return (
    typeof site === "string" &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(site)
  );
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
          redirect: {
            extensionPath: "/blocked.html"
          }
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

async function startSession() {
  const state = await getState();

  // Apply the blocking rules before marking the session active.
  await updateBlockingRules(state.blockedSites, true);

  await chrome.storage.local.set({
    sessionActive: true,
    sessionStartedAt: Date.now()
  });
}

async function stopSession() {
  await updateBlockingRules([], false);

  await chrome.storage.local.set({
    sessionActive: false,
    sessionStartedAt: null
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

  // If a session is active, update the rules immediately.
  if (state.sessionActive) {
    await updateBlockingRules(sites, true);
  }

  await chrome.storage.local.set({
    blockedSites: sites
  });
}

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

      sendResponse({
        ok: false,
        error: error.message
      });
    });

    return true;
  }
);
