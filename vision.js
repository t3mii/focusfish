const video = document.getElementById("cam");
const toggle = document.getElementById("toggle");
const errorEl = document.getElementById("error");
const statusEl = document.getElementById("status");

// Demo mode = short timers so judges see every state quickly
const DEMO = true;
const DISTRACTED_MS = DEMO ? 3000 : 5000;
const AWAY_MS = DEMO ? 4000 : 8000;
const BACK_MS = 1500;
const NUDGE_COOLDOWN_MS = DEMO ? 15000 : 120000;
const MAX_YAW = 30; // degrees; tune by testing

let stream = null, landmarker = null, timer = null;
let lastVideoTime = -1;
let state = "focused", badSince = null, goodSince = null, lastNudge = 0;
let events = [];

async function loadModel() {
  if (landmarker) return;
  const { FaceLandmarker, FilesetResolver } = await import("./mediapipe/vision_bundle.mjs");
  const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("mediapipe/wasm"));
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { 
    modelAssetPath: chrome.runtime.getURL("mediapipe/face_landmarker.task"), delegate: "CPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
  });
}

function setState(next) {
  const now = Date.now();
  if (events.length) events[events.length - 1].end = now;
  events.push({ state: next, start: now, end: null });
  state = next;
  chrome.storage.local.set({ focusState: next, stateSince: now, events });
  statusEl.textContent = {
    focused: "Focused 🐟",
    distracted: "Distracted",
    away: "Away",
    paused: "Paused",
  }[next];

  if ((next === "distracted" || next === "away") && now - lastNudge > NUDGE_COOLDOWN_MS) {
    lastNudge = now;
    if (chrome.notifications) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "FocusFish 🐟",
        message: "Welcome back whenever you're ready. Your session is waiting.",
      });
    }
  }
}

function tick() {
  if (!landmarker || !stream) return;
  if (video.readyState < 2 || video.videoWidth === 0 || video.paused) return;
  if (video.currentTime === lastVideoTime) return; // skip duplicate frames
  lastVideoTime = video.currentTime;

  let res;
  try {
    res = landmarker.detectForVideo(video, performance.now());
  } catch (e) {
    console.warn("Skipped a frame:", e.message);
    return;
  }

  const present = res.faceLandmarks.length > 0;
  let yaw = 0;
  if (present) {
    const m = res.facialTransformationMatrixes[0].data;
    const scale = Math.hypot(m[0], m[1], m[2]);
    yaw = Math.abs(Math.asin(Math.max(-1, Math.min(1, m[2] / scale))) * 180 / Math.PI);
  }
  const signal = !present ? "away" : yaw > MAX_YAW ? "distracted" : "focused";
  console.log({ present, yaw: yaw.toFixed(0), signal, state });

  const now = Date.now();
  if (signal === "focused") {
    badSince = null;
    goodSince ??= now;
    if (state !== "focused" && now - goodSince >= BACK_MS) setState("focused");
  } else {
    goodSince = null;
    badSince ??= now;
    const limit = signal === "away" ? AWAY_MS : DISTRACTED_MS;
    if (state !== signal && now - badSince >= limit) setState(signal);
  }
}

let starting = false;

async function start() {
  if (stream || starting) return;   // never start twice
  starting = true;
  try {
    statusEl.textContent = "Starting camera...";
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = stream;
    await video.play();
    document.body.dataset.state = "loading";
    toggle.textContent = "Pause camera";
    errorEl.textContent = "";
    chrome.storage.local.set({ cameraOn: true });
  } catch (e) {
    document.body.dataset.state = "paused";
    console.error(e);
    errorEl.textContent = e.name === "NotAllowedError"
      ? "Camera blocked. Click the camera icon in the address bar to allow it."
      : "Camera problem: " + e.message;
    statusEl.textContent = "Camera off";
    chrome.storage.local.set({ cameraOn: false });
    starting = false;
    return;
  }

  try {
    statusEl.textContent = "Loading model...";
    await loadModel();
    if (!stream) { starting = false; return; }  // user paused while loading
    events = []; badSince = goodSince = null; lastVideoTime = -1;
    setState("focused");
    clearInterval(timer);
    timer = setInterval(tick, 200);
  } catch (e) {
    console.error(e);
    errorEl.textContent = "Detection model failed to load: " + e.message;
    statusEl.textContent = "Camera on, detection off";
  }
  starting = false;
}

function stop() {
  clearInterval(timer);
  timer = null;
  lastVideoTime = -1;
  stream?.getTracks().forEach((t) => t.stop()); // turns the camera light off
  stream = null;
  video.srcObject = null;
  toggle.textContent = "Turn camera on";
  if (events.length) setState("paused");
  chrome.storage.local.set({ cameraOn: false });
  document.body.dataset.state = "paused";
}

toggle.addEventListener("click", () => (stream ? stop() : start()));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CAMERA_STOP") { stop(); sendResponse({ ok: true }); }
  if (msg.type === "CAMERA_START") { start(); sendResponse({ ok: true }); }
});
window.addEventListener("pagehide", stop);

start();