## Pexels Media Fetcher (Photos, Videos, and Metadata)

This Node.js app downloads photos and videos from Pexels to your local storage, along with their metadata, and runs continuously so you don't need to restart it. It supports multiple API keys with automatic rotation and a 1-hour cooldown when a key hits the rate limit (HTTP 429).

### What this tool does
- **Downloads photos and videos** to `downloads/photos` and `downloads/videos`.
- **Saves metadata** incrementally to `downloads/metadata/photos_metadata.json` and `downloads/metadata/videos_metadata.json`.
- **Maintains a resume state** in `downloads/metadata/state.json` so it continues from the last page after restarts.
- **Rotates API keys with cooldown**: on 429, the current key is cooled down for 1 hour and the next available key is used. If all keys are cooling down, it waits automatically until one becomes available.
- **Runs continuously**: if a page has no new items, it sleeps for `FETCH_INTERVAL_MINUTES` and checks again.

### Tech stack
- **JavaScript (Node.js, ESM)**
- **axios** for HTTP requests and streaming downloads
- **dotenv** for configuration via `.env`
- Node built-ins: `fs`, `path`, `stream/promises`, `timers/promises`

### Why these choices?
- **axios + streaming**: avoids loading entire files into memory, safer for large videos.
- **Key rotation with cooldown**: respects Pexels limits and keeps the job running unattended.
- **Persistent state**: lets you stop and start without re-downloading or losing your place.
- **Simple scheduler**: stays in one process, minimal dependencies, and predictable behavior.

---

## Quick start (Click-and-run)

1) Ensure you have Node.js 18+ installed.

2) Add your Pexels API keys:
   - Copy `.env.example` to `.env` (or run the script once, it will create it).
   - Edit `.env` and set `PEXELS_API_KEYS` to a comma-separated list (e.g., `key1,key2`).

3) Run the script:
```bash
bash run.sh
```
The script installs dependencies and starts the continuous downloader. Stop with Ctrl+C.

Optional: You can also run directly:
```bash
npm install
npm start
```

### Configuration (.env)
- **PEXELS_API_KEYS**: Comma-separated Pexels API keys. The app rotates keys and cools down for `COOLDOWN_HOURS` after 429.
- **QUERY**: Photo search query. Leave blank to use curated photos.
- **PER_PAGE**: Results per page (default 80, max per Pexels limits).
- **START_PAGE**: First page to start from on a fresh run.
- **FETCH_INTERVAL_MINUTES**: How long to sleep when a page yields no items.
- **COOLDOWN_HOURS**: Cooldown duration for a rate-limited key (default 1 hour).

### Output
- Media files: `downloads/photos/*.jpg`, `downloads/videos/*.mp4`.
- Metadata: `downloads/metadata/photos_metadata.json`, `downloads/metadata/videos_metadata.json`.
- Resume state: `downloads/metadata/state.json` (tracks `lastPage`).

### How it works (high-level)
1. The app computes the next page to fetch using `state.json` or `START_PAGE`.
2. It requests Pexels Photo and Video endpoints using the current API key.
3. On HTTP 429, it marks the key as cooling down for `COOLDOWN_HOURS` and tries the next key. If all keys are cooling down, it waits until the soonest key is restored.
4. Photo/video file URLs are downloaded using streaming I/O to minimize memory usage.
5. Metadata is appended and the page number is saved. The loop continues to the next page.
6. If a page has no new items, it sleeps for `FETCH_INTERVAL_MINUTES` and checks again.

### Tips
- Add multiple API keys for higher throughput and fewer pauses.
- You can stop and resume at any time; the app will continue from the last saved page.
- To run in the background across reboots, consider using a process manager like `pm2` or `systemd`.

### Troubleshooting
- If you see messages about cooling down keys, the app is respecting Pexels rate limits. It will resume automatically.
- Ensure network connectivity and that your API keys are valid.
- For large downloads, the app retries with backoff. Persistent failures may indicate connectivity or remote issues.

