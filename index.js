import fs from "fs";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
import { pipeline } from "stream/promises";
import { setTimeout as sleep } from "timers/promises";

dotenv.config();

// --- Configuration ---
const apiKeys = process.env.PEXELS_API_KEYS?.split(",").map((k) => k.trim()).filter(Boolean) || [];
if (apiKeys.length === 0) {
  console.error("❌ No API keys found in .env (PEXELS_API_KEYS).");
  process.exit(1);
}

const query = process.env.QUERY || ""; // empty = curated
const perPage = Number.parseInt(process.env.PER_PAGE || "80", 10);
const startPageEnv = Number.parseInt(process.env.START_PAGE || "1", 10);
const fetchIntervalMinutes = Number.parseInt(process.env.FETCH_INTERVAL_MINUTES || "60", 10);
const cooldownHours = Number.parseInt(process.env.COOLDOWN_HOURS || "1", 10);
const FETCH_INTERVAL_MS = fetchIntervalMinutes * 60 * 1000;
const COOLDOWN_MS = cooldownHours * 60 * 60 * 1000;

// --- Folders ---
const folders = {
  photos: path.resolve("downloads/photos"),
  videos: path.resolve("downloads/videos"),
  metadata: path.resolve("downloads/metadata"),
};
for (const dir of Object.values(folders)) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// --- Persistent state ---
const stateFile = path.join(folders.metadata, "state.json");
function loadState() {
  try {
    if (fs.existsSync(stateFile)) {
      const raw = fs.readFileSync(stateFile, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn("⚠️ Failed to load state.json, starting fresh.", err);
  }
  return { lastPage: 0 };
}
function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// --- API key manager with 1-hour cooldown on 429 ---
class ApiKeyManager {
  constructor(keys, cooldownMs) {
    this.keys = keys;
    this.cooldownUntil = new Array(keys.length).fill(0);
    this.apiIndex = 0;
    this.cooldownMs = cooldownMs;
  }

  get now() {
    return Date.now();
  }

  getEarliestReadyTimeMs() {
    return Math.min(...this.cooldownUntil);
  }

  selectKeyIndexOrWait = async () => {
    // Try to find a non-cooled-down key starting from current index
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.apiIndex + i) % this.keys.length;
      if (this.now >= this.cooldownUntil[idx]) {
        this.apiIndex = idx;
        return idx;
      }
    }
    // All keys cooling down, wait until earliest
    const earliest = this.getEarliestReadyTimeMs();
    const toWait = Math.max(earliest - this.now, 1000);
    const minutes = Math.ceil(toWait / 60000);
    console.log(`⏳ All API keys cooling down. Waiting ~${minutes} minute(s)...`);
    await sleep(toWait);
    // After wait, try again
    return this.selectKeyIndexOrWait();
  };

  markRateLimited(index) {
    this.cooldownUntil[index] = this.now + this.cooldownMs;
    const until = new Date(this.cooldownUntil[index]).toLocaleString();
    console.log(`🚫 API key #${index + 1} hit rate limit. Cooling down until ${until}.`);
    // Move pointer forward for subsequent selections
    this.apiIndex = (index + 1) % this.keys.length;
  }
}

const keyManager = new ApiKeyManager(apiKeys, COOLDOWN_MS);

async function axiosWithKeyRotation(url, config = {}) {
  while (true) {
    const idx = await keyManager.selectKeyIndexOrWait();
    const key = apiKeys[idx];
    const headers = { ...(config.headers || {}), Authorization: key };
    try {
      const res = await axios({ url, method: "GET", ...config, headers });
      return { res, idx };
    } catch (err) {
      if (err.response && err.response.status === 429) {
        console.log("⚠️ Rate limit 429 encountered. Rotating key...");
        keyManager.markRateLimited(idx);
        continue; // retry with next available key
      }
      throw err;
    }
  }
}

// --- Download helpers (streaming with retries) ---
async function downloadFileStream(url, filepath, maxRetries = 3) {
  if (fs.existsSync(filepath)) return; // Skip existing
  const tmpPath = `${filepath}.part`;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, { responseType: "stream", timeout: 60_000 });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status} while downloading`);
      }
      await pipeline(response.data, fs.createWriteStream(tmpPath));
      fs.renameSync(tmpPath, filepath);
      return;
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      const isLast = attempt === maxRetries;
      const waitMs = Math.min(30_000, 1000 * 2 ** attempt);
      console.warn(`⚠️ Download failed (${attempt + 1}/${maxRetries + 1}): ${err.message || err}. ${isLast ? "Giving up." : `Retrying in ${Math.round(waitMs/1000)}s...`}`);
      if (isLast) throw err;
      await sleep(waitMs);
    }
  }
}

// --- API fetchers ---
async function fetchPhotos(page) {
  const url = query
    ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`
    : `https://api.pexels.com/v1/curated?per_page=${perPage}&page=${page}`;
  try {
    const { res } = await axiosWithKeyRotation(url, { responseType: "json", timeout: 30_000 });
    return res.data;
  } catch (err) {
    console.error("❌ Photo API error:", err.response ? `${err.response.status} ${err.response.statusText}` : err.message);
    return null;
  }
}

async function fetchVideos(page) {
  const url = `https://api.pexels.com/videos/popular?per_page=${perPage}&page=${page}`;
  try {
    const { res } = await axiosWithKeyRotation(url, { responseType: "json", timeout: 30_000 });
    return res.data;
  } catch (err) {
    console.error("❌ Video API error:", err.response ? `${err.response.status} ${err.response.statusText}` : err.message);
    return null;
  }
}

// --- Metadata writers ---
function saveMetadata(type, items, page) {
  const file = path.join(folders.metadata, `${type}_metadata.json`);
  let existing = { items: [], lastPage: 0 };
  try {
    if (fs.existsSync(file)) {
      existing = JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch (err) {
    console.warn(`⚠️ Failed to read existing ${type} metadata. Recreating file.`, err);
  }
  existing.items.push(...items);
  existing.lastPage = page;
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
}

// --- Main loop ---
async function runContinuously() {
  console.log("🚀 Starting continuous fetcher (photos + videos)...");
  const state = loadState();
  let currentPage = state.lastPage > 0 ? state.lastPage + 1 : startPageEnv;

  while (true) {
    console.log(`\n📄 Processing page ${currentPage}...`);

    let anyData = false;

    // Photos
    console.log(`🖼️ Fetching PHOTOS page ${currentPage}...`);
    const photoData = await fetchPhotos(currentPage);
    if (photoData && Array.isArray(photoData.photos) && photoData.photos.length > 0) {
      for (const photo of photoData.photos) {
        try {
          const filePath = path.join(folders.photos, `${photo.id}.jpg`);
          if (!fs.existsSync(filePath)) {
            await downloadFileStream(photo.src.original, filePath);
            console.log(`⬇️ Photo ${photo.id} saved.`);
          }
        } catch (err) {
          console.error(`❌ Failed to save photo ${photo?.id}:`, err.message || err);
        }
      }
      saveMetadata("photos", photoData.photos, currentPage);
      anyData = true;
    } else {
      console.log("ℹ️ No photos on this page.");
    }

    // Videos
    console.log(`🎬 Fetching VIDEOS page ${currentPage}...`);
    const videoData = await fetchVideos(currentPage);
    if (videoData && Array.isArray(videoData.videos) && videoData.videos.length > 0) {
      for (const video of videoData.videos) {
        try {
          const best = [...video.video_files].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
          if (!best) continue;
          const filePath = path.join(folders.videos, `${video.id}.mp4`);
          if (!fs.existsSync(filePath)) {
            await downloadFileStream(best.link, filePath);
            console.log(`⬇️ Video ${video.id} saved.`);
          }
        } catch (err) {
          console.error(`❌ Failed to save video ${video?.id}:`, err.message || err);
        }
      }
      saveMetadata("videos", videoData.videos, currentPage);
      anyData = true;
    } else {
      console.log("ℹ️ No videos on this page.");
    }

    // Persist state
    saveState({ lastPage: currentPage });

    // Decide next step
    currentPage++;

    if (!anyData) {
      console.log(`🛌 No new data at page ${currentPage - 1}. Sleeping for ${fetchIntervalMinutes} minute(s)...`);
      await sleep(FETCH_INTERVAL_MS);
    }
  }
}

// Run
(async () => {
  try {
    await runContinuously();
  } catch (err) {
    console.error("💥 Fatal error:", err);
    process.exit(1);
  }
})();
