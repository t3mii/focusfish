
const sessionButton = document.getElementById("sessionButton");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const timer = document.getElementById("timer");
const sessionMessage = document.getElementById("sessionMessage");
const siteList = document.getElementById("siteList");
const siteCount = document.getElementById("siteCount");
const addSiteForm = document.getElementById("addSiteForm");
const siteInput = document.getElementById("siteInput");
const siteMessage = document.getElementById("siteMessage");
const cameraButton = document.getElementById("cameraButton");
const cameraStatus = document.getElementById("cameraStatus");

let currentState = {
  sessionActive: false,
  blockedSites: [],
  sessionStartedAt: null
};

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map(value => String(value).padStart(2, "0"))
    .join(":");
}

function formatShortTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function renderReport(state) {
  const stats = state.sessionStats || {};
  const siteTimes = stats.siteTimeMs || {};

  const elapsed = state.sessionActive && state.sessionStartedAt
    ? Date.now() - state.sessionStartedAt
    : 0;

  document.getElementById("reportDuration").textContent =
    formatShortTime(elapsed);

  document.getElementById("reportIdle").textContent =
    formatShortTime(stats.idleTimeMs || 0);

  document.getElementById("reportBlocked").textContent =
    stats.blockedAttempts || 0;

  const activityList = document.getElementById("activityList");
  activityList.replaceChildren();

  const entries = Object.entries(siteTimes)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    const item = document.createElement("li");
    item.textContent = state.sessionActive
      ? "Browsing activity is being recorded..."
      : "Start a session to track website activity.";
    activityList.appendChild(item);
  } else {
    for (const [domain, milliseconds] of entries) {
      const item = document.createElement("li");
      const row = document.createElement("div");
      row.className = "activity-row";

      const name = document.createElement("span");
      name.textContent = domain;

      const duration = document.createElement("span");
      duration.textContent = formatShortTime(milliseconds);

      row.append(name, duration);
      item.appendChild(row);
      activityList.appendChild(item);
    }
  }

  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");
  historyList.replaceChildren();

  const history = state.sessionHistory || [];
  historyEmpty.hidden = history.length > 0;

  for (const session of history) {
    const item = document.createElement("li");

    const title = document.createElement("strong");
    title.textContent = formatDate(session.startedAt);

    const duration = document.createElement("div");
    duration.className = "history-meta";
    duration.textContent =
      `Duration: ${formatShortTime(session.durationMs)}`;

    const siteCount = Object.keys(
      session.stats?.siteTimeMs || {}
    ).length;

    const details = document.createElement("div");
    details.className = "history-meta";
    details.textContent =
      `${siteCount} website(s) visited · ` +
      `${session.stats?.blockedAttempts || 0} blocked attempt(s)`;

    item.append(title, duration, details);
    historyList.appendChild(item);
  }
}

function renderTimer() {
  if (!currentState.sessionActive || !currentState.sessionStartedAt) {
    timer.textContent = "00:00:00";
    return;
  }

  timer.textContent = formatTime(
    Date.now() - currentState.sessionStartedAt
  );
}

function renderSession() {
  const active = currentState.sessionActive;

  statusText.textContent = active ? "Focus session active" : "Ready to focus?";
  statusDot.classList.toggle("active", active);

  sessionButton.textContent = active ? "End session" : "Start focusing";

  sessionMessage.textContent = active
    ? "Stay steady. You've got this!"
    : "Your focus journey starts here.";

  renderTimer();
}

function renderSites() {
  siteList.replaceChildren();

  const sites = currentState.blockedSites || [];
  siteCount.textContent = `${sites.length} ${sites.length === 1 ? "site" : "sites"}`;

  for (const site of sites) {
    const item = document.createElement("li");
    item.className = "site-item";

    const domain = document.createElement("span");
    domain.textContent = site;

    const removeButton = document.createElement("button");
    removeButton.className = "remove-button";
    removeButton.textContent = "Remove";
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${site}`);

    removeButton.addEventListener("click", async () => {
      const updatedSites = currentState.blockedSites.filter(
        existingSite => existingSite !== site
      );

      await saveSites(updatedSites);
    });

    item.append(domain, removeButton);
    siteList.appendChild(item);
  }
}

function renderCamera(on) {
  cameraStatus.textContent = on ? "Camera on" : "Camera off";
  cameraStatus.classList.toggle("on", on);
  cameraButton.textContent = on ? "Pause camera" : "Turn camera on";
  cameraButton.setAttribute("aria-pressed", on);
}

chrome.storage.local.get("cameraOn", ({ cameraOn }) => renderCamera(!!cameraOn));
chrome.storage.onChanged.addListener((changes) => {
  if (changes.cameraOn) renderCamera(!!changes.cameraOn.newValue);
});

cameraButton.addEventListener("click", async () => {
  const { cameraOn } = await chrome.storage.local.get("cameraOn");

  if (cameraOn) {
    let reply = null;
    try { reply = await chrome.runtime.sendMessage({ type: "CAMERA_STOP" }); } catch (e) {}
    if (!reply?.ok) chrome.storage.local.set({ cameraOn: false }); // vision tab is gone, so reset
    return;
  }

  const url = chrome.runtime.getURL("vision.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) chrome.runtime.sendMessage({ type: "CAMERA_START" });
  else chrome.tabs.create({ url });
});

async function refreshState() {
  try {
    const state = await chrome.runtime.sendMessage({
      type: "GET_STATE"
    });

    if (!state || state.ok === false) {
      throw new Error(state?.error || "Could not load FocusFish.");
    }

    currentState = state;
    renderSession();
    renderSites();
    renderReport(currentState);
  } catch (error) {
    statusText.textContent = "Couldn't load session";
    sessionMessage.textContent = error.message;
  }
}

async function saveSites(sites) {
  siteMessage.textContent = "";

  try {
    const result = await chrome.runtime.sendMessage({
      type: "UPDATE_SITES",
      sites
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Couldn't update websites.");
    }

    await refreshState();
  } catch (error) {
    siteMessage.textContent = error.message;
  }
}

sessionButton.addEventListener("click", async () => {
  sessionButton.disabled = true;
  siteMessage.textContent = "";

  try {
    const result = await chrome.runtime.sendMessage({
      type: currentState.sessionActive
        ? "STOP_SESSION"
        : "START_SESSION"
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Couldn't update session.");
    }

    await refreshState();
  } catch (error) {
    siteMessage.textContent = error.message;
  } finally {
    sessionButton.disabled = false;
  }
});

addSiteForm.addEventListener("submit", async event => {
  event.preventDefault();
  siteMessage.textContent = "";

  // Accept a domain only, not a full URL or a path.
  let domain = siteInput.value.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const validDomain =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);

  if (!validDomain || domain.includes("/")) {
    siteMessage.textContent = "Enter a domain like instagram.com";
    return;
  }

  if (currentState.blockedSites.includes(domain)) {
    siteMessage.textContent = "That website is already on your list.";
    return;
  }

  await saveSites([...currentState.blockedSites, domain]);
  siteInput.value = "";
});

refreshState();
setInterval(() => {
  renderTimer();

  if (currentState.sessionActive) {
    renderReport(currentState);
  }
  if (currentState.sessionActive) {
    refreshState();
  }
  
}, 1000);
