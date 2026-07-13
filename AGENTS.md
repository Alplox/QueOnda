# QueOnda — AGENTS.md

> **Evolving project guide.** Update this file whenever project structure, conventions, or architecture change significantly.

## Project Overview

Chilean news aggregator + live TV/radio streaming in a single-page, ad-free dashboard.
Stack: **Astro 7** (SSR) + **React 19** + **TypeScript** + **Tailwind CSS 4**.

```bash
npm run dev       # localhost:4321
npm run build     # dist/
npm run preview   # npx astro preview
npm run update-feeds  # Regenerate src/lib/feeds-database.json from remote DB
npm run update-stops  # Regenerate src/lib/stops-database.json from DTPM GTFS
```

## Directory Structure

```text
src/
  pages/
    index.astro              # Main one-page layout
    api/
      news/
        index.ts             # GET /api/news?mode=inventory — OPML source list (server-cached 15 min)
        batch.ts             # POST /api/news/batch — fetch specific sources (server-cached 15 min)
      youtube/
        source.ts            # GET /api/youtube/source?channelId=&name= — retry single channel (server-cached 5 min)
      jobs/
        index.ts             # GET /api/jobs — job listings proxy
      channels.ts            # Proxy for channels JSON with cache
      finance.ts             # mindicador.cl proxy (server-cached 30 min)
      spotify.ts             # Spotify Chile top tracks proxy (server-cached 30 min)
      youtube.ts             # YouTube Chile trending (server-cached 30 min)
      trends.ts              # Google Trends Chile (server-cached 30 min)
      weather.ts             # Open-Meteo fallback chain (server-cached 10 min)
      transport.ts           # Metro + buses (server-cached 5 min)
      sports.ts              # Sports RSS (server-cached 10 min)
      futbol.ts              # Chilean football standings + matches + news fallback chain (server-cached 10 min)
      emergency.ts           # Sismos (server-cached 5 min)
      holidays.ts            # Chilean holidays (server-cached 30 min)
      article.ts             # Article proxy via cheerio (server-cached 10 min per URL)
      radio-stations.ts      # Radio stations from radio-browser.info + json-teles fallback (server-cached 1 hour)
  components/
    layout/
      Header.tsx             # Fixed nav bar with section scroll links (client:load)
      SideIndex.tsx          # Side navigation index (client:load)
      Footer.tsx
      Section.tsx            # Reusable section wrapper
    news/
      ClientNewsFeed.tsx      # Client wrapper — 6-slot orchestrator (client:idle; clustering code-split via dynamic import)
      NewsFeed.tsx            # Slot grid + clusters + trending (presentational)
      NewsClusterCard.tsx     # Single news cluster card
      SlotCard.tsx            # Card with source dropdown selector + articles
      ArticleReader.tsx       # Modal lector de artículos vía /api/article
      FaviconImg.tsx          # Favicon image helper
      ChileMap.tsx            # Chile region map for source filtering
      AllSourcesPage.tsx      # Full sources list page
    tv/
      ClientTV.tsx            # TV orchestrator (state management, client:load)
      ChannelSelector.tsx     # Category filter bar
      ChannelGrid.tsx         # Channel grid with hover/selected states
      UnifiedPlayer.tsx       # Single player for both inline + PiP modes (hls.js loaded per-play)
    radio/
      ClientRadios.tsx        # Client wrapper (client:load)
      RadioPlayer.tsx         # Boombox-style radio player (hls.js loaded per-play)
    widgets/
      ClientTrending.tsx       # Trending tags client wrapper (client:load)
      TrendingTags.tsx         # Tag chips
      FinanceWidget.tsx        # UF, USD, EUR, IPC, UTM (client:visible)
      ThemeSwitcher.tsx        # Theme selector dropdown (client:visible)
      YouTubeTrends.tsx        # YouTube Chile trending videos grid (client:visible)
      SpotifyChart.tsx         # Spotify Top 50 Chile iframe embed (client:visible)
      GoogleTrendsWidget.tsx   # Google Trends Chile list (client:visible)
      WeatherWidget.tsx        # Multi-city weather cards (client:visible)
      TransportWidget.tsx      # Metro grid + estaciones + llegada de buses (client:visible)
      FootballTable.tsx        # Chilean football standings + matches + news feed (client:visible)
      JobList.tsx              # Job listings placeholder (client:visible)
      ClientJobList.tsx        # Client job listings widget (client:visible)
      EmergencyWidget.tsx      # Sismos recientes widget (client:load)
      EmergencyAlertBar.tsx    # Auto-scrolling alert ticker bar
      HolidaysWidget.tsx       # Chilean holidays calendar (client:visible)
      FiestasCountdown.tsx     # Fiestas Patrias countdown (client:visible)
      RouteMap.tsx             # Transit route map component (client:visible)
      ChileFlag.tsx            # Static Chile flag SVG
  lib/
    cache.ts                 # Shared server-side in-memory cache utility
    channels.ts              # Channel fetch + cache logic
    feeds-database.json      # @generated local fallback of ~2056 active/verified RSS feeds (regenerate via `npm run update-feeds`)
    stops-database.json      # @generated RED bus routes + stops from DTPM GTFS (regenerate via `npm run update-stops`)
    rss.ts                   # RSS parser + feeds DB loader (local-first fallback: feeds-database.json → async GitHub raw → CDN)
    clustering.ts            # Pure functions: extractKeywords, clusterArticles, extractTrendingFromArticles (server + client; code-split via dynamic import in ClientNewsFeed)
    radios.ts                # Radio station data + extraction
    transport.ts             # City configs, stop predictions, Metro API, POPULAR_STOPS list
    ua.ts                    # BROWSER_UA constant (shared by rss.ts + radios.ts, client-safe)
  scripts/
    update-feeds-db.mjs      # Fetches awesome-chilean-rss DB and regenerates src/lib/feeds-database.json
    update-stops-db.mjs      # Downloads DTPM GTFS and regenerates src/lib/stops-database.json
  styles/
    global.css               # Tailwind + DaisyUI base styles + scrollbar
```

## API Routes

All routes return JSON. CORS is not needed (same-origin).

| Route                                 | Cache  | Response                                                                                                                |
| ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /api/news?mode=inventory`        | 15 min | `{ allSources }` — OPML source list                                                                                     |
| `POST /api/news/batch`                | per-source 15 min | `{ articles, sourceResults }` — per-source caching (`rss:{url}`), only fetches uncached sources              |
| `GET /api/channels?category=`         | 1 hour | `{ channels, categories }` — **no longer used by ClientTV** (fetched client-side with IDB cache)                        |
| `GET /api/finance`                    | 30 min | `{ uf, dolar, euro, ipc, utm }` — **fallback only** (FinanceWidget fetches mindicador/dolarapi directly)               |
| `GET /api/youtube`                    | 60 min | `{ videos, channelStatuses }` — YouTube Chile trending via RSS                                                          |
| `GET /api/youtube/source?channelId=&name=` | 5 min | `{ videos, status }` — retry single channel                                                                        |
| `GET /api/trends`                     | 30 min | `{ trends }` — Google Trends Chile RSS                                                                                  |
| `GET /api/weather?city=`              | 10 min | `{ weather }` — **fallback only** (WeatherWidget fetches Open-Meteo directly, server for Gael/Boostr)                  |
| `GET /api/transport?city=&stop=`      | 5 min  | `{ city, metro, stations, stopInfo }` — Metro lines + estaciones + llegada de buses RED                                 |
| `GET /api/transport?city=&route=`     | 5 min  | `{ routeStops }` — Paraderos de un recorrido (ej: route=506)                                                            |
| `GET /api/transport?mode=route-names` | 1 hour | `{ routes }` — Lista de todos los números de recorrido RED                                                              |
| `GET /api/sports`                     | 30 min | `{ articles, sourceResults }` — Sports RSS from OPML ⚽ Deportes category + keyword-matched feeds across all categories |
| `GET /api/futbol`                     | 10 min | `{ standings, matches, articles, source }` — **RSS articles only** (FootballTable fetches ESPN standings/matches directly) |
| `GET /api/emergency`                  | 5 min  | `{ items }` — Gael Cloud → Boostr → USGS fallback chain                                                                 |
| `GET /api/holidays`                   | 30 min | `{ holidays }` — **fallback only** (HolidaysWidget fetches nager.at directly, bundled fallback)                         |
| `GET /api/article?url=`               | 60 min | `{ title, body, bodyHtml, author, ... }` — Article content proxy via cheerio                                            |
| `GET /api/radio-stations`             | 1 hour | `{ stations }` — **fallback only** (ClientRadios fetches radio-browser.info directly)                                   |
| `GET /api/jobs`                       | 1 hour | `{ jobs }` — Job listings from multiple sources                                                                         |
| `GET /api/spotify`                    | 30 min | `{ tracks }` — Spotify Chile top tracks                                                                                 |

## Architecture & Conventions

### Hydration strategy

- Components use Astro `client:*` directives for partial hydration
- **Above-fold** (load eagerly): `Header`, `SideIndex`, `EmergencyWidget` — `client:load`
- **Mid-fold** (load at idle): `ClientNewsFeed`, `ClientTV`, `ClientRadios` — all `client:idle` (hydrate via `requestIdleCallback` when browser is free)
- **Below-fold** widgets: `FinanceWidget`, `YouTubeTrends`, `SpotifyChart`, `GoogleTrendsWidget`, `WeatherWidget`, `TransportWidget`, `FootballTable`, `JobList`, `HolidaysWidget`, `FiestasCountdown` — all `client:visible` (hydrate when scrolled into view)
- **hls.js** is loaded lazily via `import('hls.js')` only when a user plays an m3u8 stream, not at hydration time
- **clustering.ts** is code-split via dynamic `import()` in ClientNewsFeed (not in main bundle)

### Data flow

1. Astro SSR serves the main page shell (no SSR data — all fetching is client-driven)
2. On page load, an inline script fires minimal `fetch()` calls via `requestIdleCallback` — only critical endpoints (emergency) + deferred (trends, transport). Most widgets fetch directly from client-side APIs
3. React components mount and either fetch directly from external APIs (CORS-enabled) or from `/api/...` server endpoints
4. **IDB caching (IndexedDB)**: All major widgets cache results in IDB for instant reload. Pattern: render from IDB first, fetch in background, update IDB
5. API routes remain for sources without CORS (RSS feeds, YouTube) or as fallback chains

### Component patterns

- **Client components** (`Client*.tsx`): Fetch data, manage loading/error states, render presentational components
- **Presentational components**: Receive data as props, no data fetching
- All React components use **named exports** (not default exports)
- Components use `.tsx` extension and Tailwind for styling

### TV system

- `ClientTV` orchestrates state via single `player: { channel, signalIndex, mode } | null`
- Mode is `'inline'` (full-size in document) or `'pip'` (fixed bottom-right overlay)
- `UnifiedPlayer` handles both modes with a single `<video>` element and hls.js instance — no destroy/recreate on mode switch
- FLIP animation on mode switch: captures `getBoundingClientRect()`, sets `position: fixed` at same rect (no visual jump), animates to target position/size via CSS `transition: all 0.35s cubic-bezier(0.22, 1, 0.36, 1)`
- Auto-PiP: `IntersectionObserver` detects section scroll-out-of-view, switches mode directly (no animation)
- Search input + favorites toggle (localStorage-persisted, heart icon per channel)
- Channel grid: logo, name, category filter, horizontal scroll with arrow buttons
- Signal selector in both modes (HD/WEB/YT/Twitch toggles)
- Inline mode: custom UI controls (play/pause, progress bar, volume, fullscreen, PiP trigger, auto-hide on idle)
- PiP mode: compact controls (play/pause, mute, expand, close), draggable via title bar (pointer events with `setPointerCapture`), centered signal selector
- m3u8 playback uses `hls.js` (dynamically imported via `import('hls.js')`); iframe/YT/Twitch channels use `<iframe>` directly
- Video starts unmuted (assumes user-initiated play); `error` state clears on `canplay`/`play` events
- Channels fetched client-side with jsDelivr CDN fallbacks + IDB cache (24h TTL)

### Radio system

- Uses a curated set of radio station IDs from the channels JSON
- Falls back to hardcoded `FALLBACK_RADIOS` if API fails
- Boombox layout: player panel (left) + station list (right) on desktop, stacked on mobile
- HLS audio uses hidden `<video>` + hls.js; direct audio streams use `<audio>` element
- Stations fetched client-side from radio-browser.info directly (CORS-enabled), with IDB cache (24h TTL)

### News system — 6 slots with dropdown

- **Phase 0 (instant):** `GET /api/news?mode=inventory` returns just the OPML source list (`allSources[]`) — no RSS fetch, fast
- **Phase 2 (on mount):** `POST /api/news/batch` fetches all 6 selected sources in parallel (uses defaults from localStorage or fallback list)
- **No Phase 3** — clustering and trending are computed **client-side** from the 6 active slots' articles
- Each slot has a dropdown to change its source (from the full inventory). Sources already in use are disabled in other slots' dropdowns
- Slots persist to `localStorage['news-slots']` (array of 6 sourceKeys). Pinned sources persist to `localStorage['news-pins']` (`Record<number, string>` — slot index → sourceKey)
- Pinning a source to a slot (⭐ pin icon in header or dropdown) ensures it always loads in that slot on page reload, overriding `news-slots`. Sources can only be pinned to one slot at a time. On reload: pinned sources take priority → saved keys → inventory defaults.
- Default 6 sources: first 6 from inventory (from news/regional categories of awesome-chilean-rss database)
- Trending tags are computed reactively from the 6 active sources' articles whenever a slot changes
- Tags in trending section are clickable — clicking a tag sets `?tag=` on the URL and scrolls to news section, filtering both source cards and clusters by that keyword
- Clicking "Limpiar" clears the filter

### News caching (client-side + server-side)

- **Client IDB**: Batch results cached in IDB (`news-batch:{sourceKeys}`) with 10 min TTL — page reloads render articles instantly from cache
- **Client IDB per-source**: Individual slot fetches cached (`news-source:{sourceKey}`) — switching slots is instant on revisit
- **Server per-source**: `batch.ts` caches each source individually (`rss:{url}`) with 15 min TTL — changing 1 slot doesn't invalidate the other 5

### News clustering (client-side)

1. Fetches RSS feeds only from the 6 selected sources (not all ~200)
2. Extracts keywords from titles (removes stopwords, produces unigrams + bigrams + trigrams) — shared `src/lib/clustering.ts`
3. Calculates similarity between article keyword sets (Jaccard index > 0.25 = same cluster)
4. Returns clusters sorted by score (article count × source diversity)
5. Clustering runs automatically in the browser whenever slot articles change

### Theme system

- **DaisyUI v5** handles all theme colors natively via `daisyui` plugin
- 35 themes configured in `src/styles/global.css` under `@plugin "daisyui" { themes: ... }`; `dark --default` is default
- Components use DaisyUI's semantic classes: `bg-base-100`, `bg-base-200`, `bg-base-300`, `text-base-content`, `text-base-content/70`, `border-base-300`, `bg-primary`, `text-primary`, `border-primary`
- Text contrast hierarchy: `text-base-content` (primary), `text-base-content/70` (secondary), `text-base-content/50` or lower **never used** for readable text (fails WCAG AA at small sizes on many themes)
- **`accent` is never used** — only `primary` for UI emphasis (guaranteed high contrast on all 35 themes)
- **Color pairing rules (zero accent):**
  - `bg-primary text-primary-content` = solid primary bg with contrast-safe text (buttons, primary actions)
  - `bg-primary/* text-primary` = translucent primary bg + same-hue primary text (filters, badges, active states)
  - `text-primary` alone = primary-colored text on base backgrounds
  - `hover:text-base-content` / `hover:bg-primary/*` / `hover:border-primary/*` = transient interactive states (links use `hover:text-base-content`, not `secondary`)
  - `focus:border-primary` / `focus:ring-primary` = focus indicators
  - Body text uses `text-base-content` and its opacity modifiers (`/70`, `/50`) for universal readability
  - Emergency low severity uses `bg-warning` / `border-t-warning` instead of `accent`
- Theme switching via `data-theme` attribute on `<html>` (set by `index.astro` init script + `ThemeSwitcher`), persisted in `localStorage.theme`
- DaisyUI generates all `[data-theme="..."]` CSS blocks automatically
- DaisyUI CSS variable names: `--color-base-100/200/300`, `--color-base-content`, `--color-primary`, `--color-primary-content`

### Styling

- Font: Figtree (headings + body) + DM Serif Display (hero) via Google Fonts `<link>` in `index.astro`
- No animation library — all interactions use CSS transitions + `active:scale` for tactile feedback
- Icons: inline SVG components (no icon library dependency)
- Tailwind v4 configured in `src/styles/global.css` (`@import "tailwindcss"`) — no `tailwind.config.*` file
- DaisyUI v5 configured via `@plugin "daisyui"` with inline theme list in global.css
- Custom CSS (scrollbar, keyframes) in global.css uses `var(--color-*)` DaisyUI variables

### Source attribution convention

Every widget/section must include a right-aligned source attribution at the bottom using the pattern:

```html
<div className="mt-2 text-right text-[10px] text-base-content/50">
  Fuente:{' '}
  <a
    href="..."
    target="_blank"
    rel="noopener noreferrer"
    className="hover:text-base-content underline underline-offset-2 transition-colors"
    >Name</a
  >
</div>
```

- Use `Fuente:` (singular) or `Fuentes:` (plural) prefix
- Always include actual hyperlinks to data origins (prefer primary source, list fallbacks with `{' · '}` separator)
- Every section must have attribution — no hidden or missing sources
- All sections aligned `text-right`, never `text-center` or `text-left`

## Data Sources & Fallback Chains

Cada endpoint tiene una estrategia de respaldo. A continuación se detalla el orden exacto de cada cadena.

### Weather (`/api/weather`) — fallback secuencial
1. **[Open-Meteo](https://open-meteo.com)** (primario) — `api.open-meteo.com/v1/forecast` — timeout 8s, todas las ciudades en una llamada
2. **[Gael Cloud](https://api.gael.cloud)** (secundario) — `api.gael.cloud/general/public/clima/{ICAO}` — timeout 8s, una ciudad por llamada
3. **[Boostr](https://docs.boostr.cl)** (terciario) — `api.boostr.cl/weather/{ICAO}.json` — timeout 5s, una ciudad por llamada
4. **Stale cache** (final) — datos previos vía KV → si todo falla, `{ weather: null }`

### Emergency / Sismos (`/api/emergency`) — fallback secuencial
1. **[Gael Cloud](https://api.gael.cloud)** (primario) — `api.gael.cloud/general/public/sismos` — timeout 10s
2. **[Boostr](https://docs.boostr.cl)** (secundario) — `api.boostr.cl/earthquakes/recent.json` — timeout 10s
3. **[USGS](https://earthquake.usgs.gov)** (terciario) — `earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson` — timeout 10s, filtrado a Chile/South America
4. Criterio: pasa al siguiente si `items.length === 0`, magnitud mínima 5.0

### Finance (`/api/finance`) — merge (no reemplaza)
Itera todas las fuentes y llena indicadores faltantes. Se detiene temprano si ya tiene los 5.
1. **[mindicador.cl](https://mindicador.cl)** — `mindicador.cl/api` — timeout 8s — UF, USD, EUR, IPC, UTM
2. **[Boostr](https://docs.boostr.cl)** — `api.boostr.cl/economy/indicators.json` — timeout 8s
3. **[Findic](https://findic.cl)** — `findic.cl/api/` — timeout 8s
4. **[SII RSS](https://zeus.sii.cl)** — `zeus.sii.cl/admin/rss/sii_ind_rss.xml` — timeout 8s
5. **[DolarAPI](https://cl.dolarapi.com)** — `cl.dolarapi.com/v1/cotizaciones` — timeout 8s
→ Stale cache → 502 error

### Radio stations (`/api/radio-stations`) — fallback secuencial
1. **[radio-browser.info](https://api.radio-browser.info)** (primario) — `de1.api.radio-browser.info/json/stations/search?limit=500&countrycode=CL&lastcheckok=1&hidebroken=true&order=clickcount&reverse=true` — timeout 15s
2. **[json-teles](https://github.com/Alplox/json-teles)** (secundario) — `raw.githubusercontent.com/Alplox/json-teles/main/countries/cl.json` → filtrado a `category === 'music'`
3. **`FALLBACK_RADIOS`** (terciario, hardcoded) — Cooperativa, Duna, ADN

#### CD disc images (radio player animation)
- `public/cd-disc-1.png`–`cd-disc-5.png` — PNGImg (CC BY-NC 4.0)
  - [cd_dvd_PNG9081](https://pngimg.com/image/9081), [cd_dvd_PNG9079](https://pngimg.com/image/9079), [cd_dvd_PNG9075](https://pngimg.com/image/9075), [cd_dvd_PNG9080](https://pngimg.com/image/9080), [cd_dvd_PNG9065](https://pngimg.com/image/9065)
- Randomly picked per station in `BoomboxDisplay` component

### Football / Fútbol (`/api/futbol`) — paths paralelos
- **Standings + Matches**: [ESPN Deportes API](https://github.com/pseudo-r/Public-ESPN-API) — `site.web.api.espn.com/apis/v2/sports/soccer/chi.1/standings` + `site.api.espn.com/apis/site/v2/sports/soccer/chi.1/scoreboard` — timeout 8s. Sin fallback: si ESPN falla → `standings: [], matches: [], source: 'rss'`
- **Artículos**: RSS sports feeds (desde `awesome-chilean-rss` DB, categoría sports) — siempre se carga, independiente de ESPN

### Transport (`/api/transport`) — fuentes individuales
- **Metro status**: [Metro.cl](https://www.metro.cl) (scraping) — `metro.cl/el-viaje/estado-red` — timeout 8s — sin fallback
- **RED bus predictions**: [red.cl](https://www.red.cl) — `red.cl/planifica-tu-viaje/cuando-llega/` (token) → `red.cl/predictorPlus/prediccion` — timeout 5s cada una
- **Metro stations**: [xor.cl](https://api.xor.cl) — `api.xor.cl/red/metro-network` — usada en `src/lib/transport.ts`, no llamada por API route actualmente

### Feeds DB (RSS, `src/lib/rss.ts`) — local-first
1. **Local JSON** (`feeds-database.json`, build-time) — instantáneo, siempre disponible
2. **[GitHub raw](https://raw.githubusercontent.com/alplox/awesome-chilean-rss)** (fire-and-forget) — timeout 15s
3. **[jsDelivr CDN](https://cdn.jsdelivr.net)** (fire-and-forget fallback) — timeout 15s
4. El fetch remoto es asíncrono: `loadFeedsDatabase()` devuelve el JSON local inmediatamente, luego actualiza cache en background

### Other sources (single source, sin fallback)
| Sección | Fuente | URL |
|---------|--------|-----|
| TV | [json-teles](https://github.com/Alplox/json-teles) | `raw.githubusercontent.com/Alplox/json-teles/main/countries/cl.json` → jsDelivr CDN fallback |
| YouTube | YouTube RSS (canales chilenos) | `www.youtube.com/feeds/videos.xml?channel_id={id}` (canales desde json-teles) |
| Google Trends | [Google Trends RSS](https://trends.google.com) | `trends.google.com/trending/rss?geo=CL` |
| Spotify | [Spotify Embed](https://open.spotify.com) | `open.spotify.com/embed/playlist/37i9dQZEVXbL0GRJmY7SUz` (Top 50 Chile) |
| Sports RSS | awesome-chilean-rss DB (categoría `sports`) | múltiples fuentes RSS deportivas chilenas |
| Holidays | [Nager.Date](https://date.nager.at) | `date.nager.at/api/v3/publicholidays/{year}/CL` — bundled fallback JSON |
| Article proxy | [cheerio](https://cheerio.js.org) scraping | URL enviada por el cliente |
| RED routes DB | [DTPM GTFS](https://www.dtpm.cl) | `dtpm.cl/descargas/gtfs/` (build-time via `update-stops-db.mjs`) |
| Weather widget geolocation | [Open-Meteo Geocoding](https://open-meteo.com) | `geocoding-api.open-meteo.com/v1/reverse` + `v1/search` |

## Sound System (Web Audio API)

Module-level singleton using raw Web Audio API (no library). Exports `play(role)`, `setMuted()`, `setVolume()`, `getConfig()`, `toggleMuted()`, `cleanup()`.

### Implementation

- `src/lib/sound.ts` — Self-contained ~140 lines: oscillator + noise synthesis, no external imports, 17 sound roles (tap, toggle, confirm, overlay open/close, navigation, notifications, hero effects, etc.)
- AudioContext created lazily on first `play()` call (browser policy)
- Default volume: 0.5
- Triangle wave + bandpass-filtered noise for crisp, tactile feedback (same character as old crisp pack)
- Footer includes a sound toggle button (`toggleMuted()`) that persists across islands via the singleton module state

### Where sounds fire

| ThemeSwitcher | `interaction.tap` (theme select) |
| EmergencyAlertBar | `notification.warning` (alert link click) |

## Performance

- **`@playform/compress`** minifies HTML and JS in the build pipeline (`astro.config.mjs`; CSS compression disabled — was stripping responsive `@media` rules)
- **Google Fonts** loaded non-blocking via `media="print" onload="this.media='all'"` (`index.astro`)
- **Pre-warm**: On page load, an inline script fires `fetch()` to all API endpoints via `requestIdleCallback` so server cache is hot before widgets hydrate
- **Code-splitting**: `clustering.ts` is dynamically imported in `ClientNewsFeed` (separate 2.8 KB chunk, not in main bundle)
- **ClientNewsFeed** hydrates at idle (`client:idle`) instead of eagerly (`client:load`)
- All 35 DaisyUI themes are bundled (no reduction — user preference)

## Deployment

- **Plataforma**: Cloudflare Pages Functions (SSR), deploy automático via Git integration
- **Build command**: `npm run build && node scripts/post-build-pages.mjs`
- **Adapter**: `@astrojs/cloudflare` v14+, `mode: 'directory'`, `output: 'server'`
- **`nodejs_compat`** flag activado en dashboard de Pages (requerido para KV)

### Post-build (`scripts/post-build-pages.mjs`)

El build de Astro genera `dist/server/` + `dist/client/`. El script reestructura para Pages:

1. `dist/server/` → `dist/_worker.js/`
2. `entry.mjs` → `index.js` (Pages espera `_worker.js/index.js`)
3. `client/*` → `dist/` (merge de assets estáticos)
4. Elimina `dist/_worker.js/wrangler.json` (conflicto con ASSETS binding de Pages)
5. Elimina `.wrangler/` (apunta al `server/` eliminado)

### KV Bindings (dashboard de Pages)

| Binding | Nombre KV |
|---------|-----------|
| `KV_CACHE` | Cache de API routes |
| `SESSION` | `queonda-session` |

### Notas

- `wrangler.jsonc` fue eliminado del repo — el CI de Pages lo detectaba y causaba conflictos con el build command personalizado.

---

> **Keep updated.** When you add a new route, component, or data source, update the corresponding section above. If the architecture changes significantly, rewrite the relevant section.
