import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const apiKeys = process.env.PEXELS_API_KEYS?.split(",") || [];
if (apiKeys.length === 0) {
  console.error("❌ No API keys found in .env (PEXELS_API_KEYS).");
  process.exit(1);
}

const query = process.env.QUERY || ""; // empty = curated
const perPage = parseInt(process.env.PER_PAGE) || 80;
let currentPage = parseInt(process.env.START_PAGE) || 1;

const folders = {
  photos: path.resolve("downloads/photos"),
  videos: path.resolve("downloads/videos"),
  metadata: path.resolve("downloads/metadata"),
};
for (const dir of Object.values(folders)) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Rotate API keys
let apiIndex = 0;
function getApiKey() {
  return apiKeys[apiIndex % apiKeys.length].trim();
}
function switchKey() {
  apiIndex++;
  console.log(`🔑 Switching to API key ${apiIndex + 1}/${apiKeys.length}`);
}

// Download helper
async function downloadFile(url, filepath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`❌ Failed download: ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  fs.writeFileSync(filepath, Buffer.from(buffer));
}

// Fetch photos
async function fetchPhotos(page) {
  const url = query
    ? `https://api.pexels.com/v1/search?query=${query}&per_page=${perPage}&page=${page}`
    : `https://api.pexels.com/v1/curated?per_page=${perPage}&page=${page}`;

  try {
    const res = await fetch(url, { headers: { Authorization: getApiKey() } });
    if (res.status === 429) {
      console.log("⚠️ Photo rate limit hit, switching key...");
      switchKey();
      return fetchPhotos(page);
    }
    if (!res.ok) {
      console.error(`❌ Photo API error: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("❌ Fetch error:", err);
    return null;
  }
}

// Fetch videos
async function fetchVideos(page) {
  const url = `https://api.pexels.com/videos/popular?per_page=${perPage}&page=${page}`;

  try {
    const res = await fetch(url, { headers: { Authorization: getApiKey() } });
    if (res.status === 429) {
      console.log("⚠️ Video rate limit hit, switching key...");
      switchKey();
      return fetchVideos(page);
    }
    if (!res.ok) {
      console.error(`❌ Video API error: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("❌ Fetch error:", err);
    return null;
  }
}

// Save metadata
function saveMetadata(type, items, page) {
  const file = path.join(folders.metadata, `${type}_metadata.json`);
  let existing = { items: [], lastPage: 0 };
  if (fs.existsSync(file)) {
    existing = JSON.parse(fs.readFileSync(file, "utf-8"));
  }
  existing.items.push(...items);
  existing.lastPage = page;
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
}

// Download loop (photos + videos page by page)
async function downloadPageByPage() {
  console.log("🚀 Starting page-by-page download...");

  while (true) {
    console.log(`📄 Fetching PHOTOS page ${currentPage}...`);
    const photoData = await fetchPhotos(currentPage);

    if (!photoData || !photoData.photos || photoData.photos.length === 0) {
      console.log("✅ No more photos found. Stopping...");
      break;
    }

    for (const photo of photoData.photos) {
      const filePath = path.join(folders.photos, `${photo.id}.jpg`);
      if (!fs.existsSync(filePath)) {
        await downloadFile(photo.src.original, filePath);
        console.log(`⬇️ Downloaded photo ${photo.id}`);
      }
    }
    saveMetadata("photos", photoData.photos, currentPage);

    console.log(`📄 Fetching VIDEOS page ${currentPage}...`);
    const videoData = await fetchVideos(currentPage);

    if (videoData && videoData.videos && videoData.videos.length > 0) {
      for (const video of videoData.videos) {
        const best = video.video_files.sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        if (!best) continue;
        const filePath = path.join(folders.videos, `${video.id}.mp4`);
        if (!fs.existsSync(filePath)) {
          await downloadFile(best.link, filePath);
          console.log(`⬇️ Downloaded video ${video.id}`);
        }
      }
      saveMetadata("videos", videoData.videos, currentPage);
    } else {
      console.log("✅ No more videos found.");
    }

    currentPage++;
  }

  console.log("🎉 All downloads completed page by page.");
}

// Run
(async () => {
  await downloadPageByPage();
})();
