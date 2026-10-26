# QueOnda — AGENTS.md

> **Evolving project guide.** Update this file whenever project structure, conventions, or architecture change significantly.

## Project Overview

Chilean news aggregator + live TV/radio streaming in a single-page, ad-free dashboard.
Stack: **Astro 7** (SSR) + **React 19** + **TypeScript** + **Tailwind CSS 4**.

```bash
pnpm install --frozen-lockfile  # Install exact versions from pnpm-lock.yaml
pnpm dev                        # localhost:4321
pnpm build                      # dist/ + Cloudflare Pages restructure
pnpm preview                    # Preview the production build
pnpm run update-feeds           # Regenerate src/lib/feeds-database.json from remote DB
pnpm run update-stops           # Regenerate src/lib/stops-database.json from DTPM GTFS
pnpm run update-holidays        # Regenerate src/lib/holidays.json from nager.at API
pnpm run sync-credits            # Regenerate AGENTS.md "Data Sources & Fallback Chains" section from src/lib/data-sources.json
```

## Directory Structure

```text
src/
  pages/
    index.astro              # Main one-page layout
    todas-las-fuentes.astro  # /todas-las-fuentes — página de selección de fuentes + resultados (isla AllSourcesPage)
    creditos.astro           # /creditos — fuentes y licencias renderizadas desde data-sources.json
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
      air-quality.ts         # SINCA estaciones calidad del aire + fallback Open-Meteo (server-cached 30 min)
      sports.ts              # Sports RSS (server-cached 10 min)
      futbol.ts              # Chilean football standings + matches + news fallback chain (server-cached 10 min)
      emergency.ts           # Sismos (server-cached 5 min)
      power.ts               # SEC clientes sin suministro (server-cached 15 min)
      cyber.ts               # CSIRT Nacional + CISA KEV (server-cached 15 min; 3 min si algún bloque falló)
      holidays.ts            # Chilean holidays (server-cached 30 min)
      article.ts             # Article proxy via cheerio (server-cached 10 min per URL)
      cron.ts                # Cache pre-warming cron endpoint (sports, youtube, power, trends) — Bearer auth
      radio-stations.ts      # Radio stations from radio-browser.info + json-teles fallback (server-cached 1 hour)
      forecast.ts            # DMC pronóstico 5 días parsing (server-cached 1 hour)
  components/
    layout/
      Header.tsx             # Fixed nav bar with section scroll links (client:load)
      SideIndex.tsx          # Side navigation index (client:load)
      BottomNav.tsx          # Mobile-only floating dock tab bar (<lg) with 4 quick sections + "Más" bottom sheet (all sections grid, focus-trapped dialog, grabber supports tap-to-close + swipe-down/fling to dismiss); auto-hides on scroll-down / reappears on scroll-up with 24px hysteresis (inert + parked invisible while hidden); anchored via a 1px bottom sentinel that measures Fenix's stale fixed-anchor (dynamic toolbar) and rides the real screen bottom; hide transform self-measures after slide-out and pushes any remainder off-screen; opens on pointerup (click suppressed via preventDefault on pointerdown) so eaten/retargeted synthesized clicks can't break it; broadcasts `dock:visibility` for fixed siblings; lifts above sticky radio player; BackToTop lifts above it. Debug overlay behind ?dockdebug=1 (src/lib/dock-debug.ts)
      ShareButton.tsx        # Header share button — native share on touch, clipboard copy on desktop (client:load)
      SectionShareHandler.tsx  # Single delegated client:idle island wiring every [data-section-share] button to share its section anchor (no per-section hydration)
      Footer.tsx             # pb reserves space so the floating dock never covers the footer credits
      Section.tsx            # Reusable section wrapper — renders header + a "Compartir sección" button (data-section-share) per section
      BackToTop.tsx          # Appears after 500px scroll; lifts above dock/sheet/radio miniplayer using the nav sentinel bottom + dock's rendered rect incl. its lift transform (parsed from inline style); reacts to `dock:visibility`
    news/
      ClientNewsFeed.tsx      # Client wrapper — 6-slot orchestrator (client:idle; clustering code-split via dynamic import)
      NewsFeed.tsx            # Slot grid + clusters + trending (presentational). El skeleton de carga pinta exactamente `slotCount` bloques (los del usuario, no un 6 fijo ni los que quepan en pantalla) dentro del mismo contenedor que la grilla real (`slotGridCols`: carrusel snap en móvil, 2/3/4 columnas según slotCount), así no hay salto al llegar los datos. Además reserva la tira de tendencias (una fila de 34 px) y el bloque «Agrupadas por tema» (`h-[420px]` con scroll interno), que son las dos piezas que antes se insertaban a mitad de carga y empujaban media página (CLS ~2,6). Mientras la clustering no ha devuelto temas (`clusteringPending`) el bloque pinta 3 cards de esqueleto dentro de la misma ventana
      NewsClusterCard.tsx     # Single news cluster card
      SlotCard.tsx            # Card with source dropdown selector + articles
      ArticleReader.tsx       # Modal lector de artículos vía /api/article
      FaviconImg.tsx          # Favicon image helper
      ChileMap.tsx            # Chile region map for source filtering
      AllSourcesPage.tsx      # Página /todas-las-fuentes (elegir fuentes → cargar → resultados). Al elegir lista las ~2400 fuentes con los feeds de cada medio agrupados y en A-Z por defecto, con los mismos dos filtros del selector de noticias (claves compartidas `news-main-only` y `news-sort`). En resultados ordena los cards por medio A-Z por defecto: el API ya fusiona los feeds de un mismo medio en un solo card, así que ahí no hay "un feed por sitio" que filtrar
      chile-outline.ts        # Chile SVG outline data for ChileMap
    ChileFlag.tsx             # Root-level static Chile flag SVG (also available as /emoji/1f1e8-1f1f1.svg)
    Emoji.tsx                 # Root-level emoji rendering component
    RetryHint.tsx             # Aviso compartido «Reintento automático en Xs» (cuenta atrás en aria-live="off" + número en caja fija de 2ch) para los bloques en error
    SectionSources.tsx        # Atribución compartida: lee `sections.<id>.sources` de data-sources.json y pinta «Fuente(s): …» con enlaces (`only` filtra nombres, `inline` para versiones en línea). Reemplaza el bloque «Fuente» copiado a mano en cada widget
    tv/
      ClientTV.tsx            # TV orchestrator (state management, single + multiview, client:idle)
      ChannelSelector.tsx     # Category filter bar
      ChannelGrid.tsx         # Channel grid with hover/selected states
      UnifiedPlayer.tsx       # Single player for both inline + PiP modes (hls.js loaded per-play)
      MultiviewGrid.tsx       # Cuadrícula multipantalla (2–9 slots): layouts 1x1…3x3 (`tv-multiview-layout`), slots persistidos en `tv-multiview-slots`, hls.js por celda
      MultiviewCell.tsx       # Celda individual del multiview: su propio <video>/hls.js, selector de señal, mute salvo el slot enfocado, loading/error por celda
    radio/
      ClientRadios.tsx        # Client wrapper (client:idle)
      RadioPlayer.tsx         # Boombox-style radio player (hls.js loaded per-play); sticky miniplayer only mounts when a station is selected/current (empty shell peeked through FF Android's dynamic toolbar). El listado «Todas» (~500 emisoras) se pinta por lotes de 40 (`STATION_BATCH`) al llegar al final del scroller, con botón «Mostrar N radios más» para teclado: renderizar las 500 de una añadía ~5.000 nodos al DOM
    widgets/
      TrendingTags.tsx         # Tag chips en una sola fila con scroll horizontal (`[scrollbar-width:none]`), sin wrap: cada fila extra que aparecía al cargar empujaba toda la página hacia abajo
      FinanceWidget.tsx        # UF, USD, EUR, IPC, UTM (client:idle)
      ThemeSwitcher.tsx        # Theme selector dropdown (client:load)
      YouTubeTrends.tsx        # YouTube Chile trending videos grid (client:idle; IDB cache: youtube-trends 30min). La grilla desktop va dentro de una ventana `max-h-[460px] overflow-y-auto` y renderiza por lotes (`VIEW_BATCH = 15`, +15 al acercarse al fondo); el carrusel móvil crece igual vía `onNearEnd`. Sin botones "Mostrar más/menos/Ocultar todo": el alto del bloque queda fijo (~598px) aunque haya hasta ~200 videos con "10 por canal". El clic normal en una tarjeta abre `VideoModal` (player embebido, sin salir del dashboard); Ctrl/Cmd/Shift/Alt o botón central siguen abriendo YouTube en pestaña nueva
      VideoModal.tsx           # Reproductor YouTube embebido (portal + role=dialog, foco al abrir, trap de Tab, Escape, click en backdrop, foco restaurado). Mismo contrato de modal que ArticleReader; el iframe se monta solo mientras está abierto
      SpotifyChart.tsx         # Spotify Top 50 Chile iframe embed (client:idle)
      GoogleTrendsWidget.tsx   # Google Trends Chile list (client:idle)
      WeatherWidget.tsx        # Multi-city weather cards (client:idle). «Usar mi ubicación» es opt-in (nunca se pide permiso al cargar): coordenadas → ciudad base cercana (≤25 km, para heredar pronóstico DMC y mapa) o geocodificación inversa BigDataCloud (`/data/reverse-geocode-client`; Open-Meteo NO tiene `/v1/reverse`, devuelve 404) o «Mi ubicación» como último recurso; el clima se pide siempre por coordenadas, así que el botón no depende del geocoder. La ciudad elegida persiste en `localStorage['weather-user-city']` (`{name, lat, lon, data}`) y se refresca en segundo plano al cargar. Los fallos de geolocalización se muestran en una caja `role="alert"` (no un texto suelto) con mensaje por código: 1 = permiso bloqueado, 3 = timeout
      TransportWidget.tsx      # Metro grid + estaciones + llegada de buses (client:idle)
      AirQualityWidget.tsx     # Calidad del aire SINCA: peor estación + conteos por banda + filtro región + filas (client:idle; IDB cache: air-quality 30min)
      AirQualityMap.tsx        # Leaflet + OpenFreeMap map de estaciones por estado ICAP (colores oficiales SINCA, filtros región/comuna)
      FootballTable.tsx        # Chilean football standings + matches + news feed (client:idle; IDB cache: football-standings 6h, football-matches 1h, football-articles 30min; progressive per-tab rendering). La pestaña Noticias renderiza las 25 noticias de /api/sports de una en un contenedor `max-h-[440px] overflow-y-auto overscroll-contain` — sin paginación ni "cargar más": el alto del bloque queda fijo y no empuja las secciones de abajo. Si ESPN no responde, Posiciones conserva la reserva de la tabla (684 px) con filas fantasma y un «Reintentar» en vez de un texto de 60 px (antes el bloque caía 583 px y arrastraba la página). La raíz del bloque mantiene su `min-h` entre cargando/cargado
      JobList.tsx              # Job listings placeholder (client:idle)
      ClientJobList.tsx        # Client job listings widget (client:idle)
      EmergencyWidget.tsx      # Sismos recientes widget (client:load). Ante un fallo de /api/emergency los bloques SENAPRED y Sismos muestran el error compartido `LoadErrorBox` (nunca «sin alertas» / «sin sismos»), con reintento automático propio vía `useErrorRetry` (backoff 5 s → 10 s → 20 s → 30 s → 60 s + `RetryHint`) sin desmontar el bloque ni volver al skeleton («Reintentar ahora» reinicia el backoff)
      EmergencyMap.tsx         # Leaflet + OpenFreeMap map of sismos by magnitude (toggle inside EmergencyWidget)
      EmergencyTicker.tsx      # Sticky collapsible alert ticker bar under navbar (client:load)
      EmergencyAlertBar.tsx    # Auto-scrolling alert ticker bar
      PowerOutageWidget.tsx    # SEC clientes sin suministro + mapa Leaflet/OpenFreeMap por comuna + gráfico evolución (client:load). Listado tipo tabla con cabecera («Sin luz · Clientes · %»), filas cebra, columnas numéricas de ancho fijo alineadas a la derecha (la base de clientes de la región va después de «Sin luz», no como subtítulo del nombre; el ancho fijo es lo que mantiene el riel de la barra y los números en la misma x en todas las filas) y pin de mapa siempre visible (nunca oculto tras hover). En móvil el nombre ocupa la primera línea de la fila y los números bajan a la segunda, así no se trunca ningún nombre. La barra mide lo que ordena la lista: «Más afectados» (default) y «Norte → sur» ⇒ clientes contra la región más afectada; «Mayor %» ⇒ afectados ÷ clientes de ESA región (nunca contra otra región). En modo % aparece el grupo «Escala» (`localStorage['power-scale']`): «Zoom» (default, tope redondo ≥ la peor proporción: 0,5 %, 1 %, 2 %… según el día) y «Real» (100 % del track = 100 % de los clientes de la región). Pestaña Comunas: barra por volumen contra la comuna más afectada, porque la SEC no publica base de clientes por comuna. El bloque de pestañas + filtros + listado («desglose») se puede **colapsar** desde un enlace con el mismo patrón de desplegable que el resto de la app («Ver desglose por región y comuna» ↔ «Ocultar desglose», `text-primary` + chevron de 8px que rota 90°), ubicado **arriba** del bloque, nunca al final: colapsado queda sólo el número general del país (arranca expandido, preferencia en `localStorage['power-breakdown']`, y el contenedor pasa a `inert` + `aria-hidden` para que sus controles salgan del orden de tabulación). La ayuda «¿Corte de luz? Reporta: …» va en su **propia superficie** (`bg-base-content/[0.04]` + `border-base-300`) bajo una regla fina, para que la cifra principal mande y la ayuda no compita como si fuera otro dato. Cuando la carga falla, el bloque **no** se queda mudo ni se vacía a skeleton: reintenta solo con backoff (5 s → 10 s → 20 s → 30 s → 60 s, tope) y muestra la cuenta atrás («Reintento automático en Xs») tanto en el bloque de error como en la franja sobre datos ya cargados; «Reintentar ahora» reinicia el backoff sin desmontar el bloque. El error y el «0 clientes sin suministro» **conservan el alto reservado** (1137/864) con un fantasma debajo (o la cifra 0 centrada), porque el primer `/api/power` puede tardar más que el timeout del cliente (SEC en frío) y el bloque colapsaba ~1077 px al fallar y volvía a crecer al reintentar (CLS ~2,6)
      PowerOutageMap.tsx       # Leaflet + OpenFreeMap comuna dot map (theme-aware styles, rank-band circles, filtros región/comuna, foco por región vía pin con flyToBounds)
      PowerEvolutionChart.tsx  # Chart.js evolución horaria de clientes sin suministro (24h/48h/72h/7d)
      HolidaysWidget.tsx       # Chilean holidays calendar (client:idle)
      FiestasCountdown.tsx     # Fiestas Patrias countdown (client:idle). Temporadas en computeSeason(): pre18 (1 ene–17 sep), celebration (18–20 sep), recovery (2 semanas → hasta el 3 oct), halloween (oct), christmas (nov–dic). Mensajes por temporada en SEASON_MESSAGES — Halloween/Navidad se intercalan con los del 18 vía interleave(); la línea de estado sale de SEASON_STATUS. «Lanzar» revela la carta y, **solo si es legendaria**, dispara `burstConfetti` (dos oleadas) + `notification.success`
      EmojiCard.tsx           # Card component for FiestasCountdown (client:idle). Legendaria: aro de cromo líquido (conic-gradient animado con @property --emoji-chrome-angle, recortado con mask) en vez del halo amarillo, más un glow neutro que sigue el tema
      CyberWidget.tsx         # Ciberseguridad (client:idle): dos pestañas — Alertas Chile (CSIRT) y Vulnerabilidades (CISA KEV) — con el conteo dentro del pill activo, buscador accent-insensitive con botón de limpiar, filtros por pestaña «Solo críticas» / «Solo ransomware» en la misma barra de herramientas (cada uno con **estado propio**: activar el de una pestaña no recorta el conteo de la otra), chips de proveedor, lectura de alertas en `ArticleReader` (modal compartido con Noticias; NVD queda como enlace externo), render por lotes en contenedor `max-h-[440px]` e IDB cache 15 min. El «N críticas» del encabezado es un botón que salta a Alertas con «Solo críticas» activo
      CyberRows.tsx           # Filas presentacionales de CyberWidget (alerta, KEV) + formato relativo. Cada fila es un contenedor con dos acciones hermanas: el `<a target="_blank">` que abre el sitio original (clic normal) y el botón de libro que abre el modal — mismo contrato que `SlotCard`
      RouteMap.tsx             # Transit route map component (Leaflet + OpenFreeMap, client:idle)
      openfreemap-layer.ts     # Shared lazy MapLibre/OpenFreeMap basemap + theme switching for Leaflet maps
  types.ts                    # Tipos compartidos Channel / Article / NewsCluster / SourceResult
  env.d.ts                    # Tipos de Astro + declaración del web component <hover-tilt> para JSX
  lib/
    cache.ts                 # Two-tier server cache: L1 in-memory Map + L2 Cloudflare Cache API (caches.default), plus dedupeFetch. Exports edgeCacheHeaders(ttlSeconds) for CDN-level edge caching with stale-while-revalidate, noStoreHeaders() for never-cached error responses, and setLastGood(key, data, ttlMs)/getStaleCached() for the durable "last known good" snapshot used by routes with no fallback chain (power)
    data-sources.json        # @canonical lista de fuentes de datos, cadenas de fallback y licencias. Renderizada en /creditos y en la sección "Data Sources & Fallback Chains" de este archivo (regenerar con `pnpm run sync-credits`)
    channels.ts              # Channel fetch + cache logic
    feeds-database.json      # @generated local fallback of ~2600 feeds (news 895 + regional 1508 + sports 221; regenerate via `pnpm run update-feeds`)
    stops-database.json      # @generated RED bus routes + stops from DTPM GTFS (regenerate via `pnpm run update-stops`)
    holidays.json            # @generated Chilean holidays fallback from nager.at (regenerate via `pnpm run update-holidays`)
    rss.ts                   # RSS parser + feeds DB loader (local-first fallback: feeds-database.json → async GitHub raw → CDN)
    clustering.ts            # Pure functions: extractKeywords, clusterArticles, extractTrendingFromArticles (server + client; code-split via dynamic import in ClientNewsFeed)
    radios.ts                # Radio station data + extraction
    sound.ts                 # Web Audio API sound engine — oscillator + noise synthesis
    air-quality.ts           # Tipos AirStation/AirRow + AIR_STATUS (paleta oficial SINCA) + umbrales ICAP MP2.5 + airSeverity() sort
    transport.ts             # City configs, stop predictions, Metro API, POPULAR_STOPS list
    comunas-coords.ts        # Comuna → [lat, lon] table (monitor-sinluz + supplements) + comunaCoords() matcher
    power.ts                 # Snapshot SEC compartido por /api/power y /api/cron: serie horaria + desglose regional + base de clientes por región (GetClientesRegional, cache 7 días con fallback compilado) → `pct` por región
    cyber.ts                 # Ciberseguridad: CSIRT Nacional + catálogo CISA KEV (recorte a 30/90 días + ventana de ransomware de 180 días + conteo por vendor), severidad CSIRT, bloques independientes y TTL degradado (compartido por /api/cyber y /api/cron)
    dock-debug.ts            # Overlay de depuración del dock móvil, solo con `?dockdebug=1` (lo importa BottomNav)
    ua.ts                    # BROWSER_UA constant (shared by rss.ts + radios.ts, client-safe)
    backgrounds.ts            # Rotación diaria del hero (getTodayBg); las fotos viven en data-sources.json → sections.images
    emoji.ts                  # Emoji-to-SVG-path helper + text splitter
    festivities.ts            # Date-range-based festivity/theming logic
    idb-cache.ts              # IndexedDB client-side caching utility (idbGet/idbSet/cacheGet/cacheSet)
    chile-time.ts             # parseChileLocal() — Chile-local time→epoch (DST-safe), shared by /api/emergency + EmergencyWidget client coord enrichment
    confetti.ts               # burstConfetti(target, opts) — estallido de confeti en canvas sin dependencias (equivalente mínimo de canvas-confetti) usado al revelar la carta de Fiestas Patrias; un solo canvas fijo compartido que se retira al vaciarse y respeta prefers-reduced-motion
    rate-limit.ts             # In-memory sliding window rate limiter
    regions.ts                # Canonical region slugs N→S + labels + SEC name normalizer (SlotCard, AllSourcesPage, PowerOutageWidget)
    auto-refresh.ts           # Module singleton that auto-refreshes the emergency section every 5 min + on tab re-focus (60s throttle; always on, no toggle)
    retry.ts                  # useErrorRetry(hasError, retry): reintento con backoff compartido por los bloques en error (5 s → 10 s → 20 s → 30 s → 60 s, tope), cuenta atrás y guardia de un solo intento en vuelo; retryNow() reinicia el backoff sin desmontar el bloque
    sections.ts               # Section ID/label constants for nav (`navLabel` = etiqueta corta para la barra superior). Ciberseguridad va antes de Finanzas y ocupa el 5º lugar de PRIMARY; Spotify pasa a OVERFLOW («Más»)
    sources.ts                # Feed/outlet helpers: foldAccents, mainFeedTier, isBetterMainFeed, outletKey, groupByOutlet, orderByOutlet, resolveOutlet (SlotCard + ClientNewsFeed)
    storage.ts                # localStorage JSON get/set helpers
    url.ts                    # extractHost() URL helper
    url-validator.ts          # SSRF protection / public HTTP(S) URL validation (IPv4/IPv6, local suffixes, credentials)
    sanitize-html.ts          # Allowlist sanitizer for external article HTML rendered by ArticleReader
    share.ts                  # shareOrCopy (native share on touch, clipboard on desktop), buildEmergencySummary, canShareFiles/downloadBlob
    share-image.ts            # renderEmergencyCard — manual canvas 1080x1350 PNG for sharing the emergency section (no html2canvas)
    jobs/
      index.ts                # Job fetching orchestration
      types.ts                # Job/JobSource type definitions
      sources/
        getonbrd.ts           # Getonboard.cl scraper
        workanywhere.ts       # Workanywhere.com scraper
        remotive.ts           # Remotive.com scraper
  scripts/
    update-feeds-db.mjs      # Fetches awesome-chilean-rss DB and regenerates src/lib/feeds-database.json
    update-stops-db.mjs      # Downloads DTPM GTFS and regenerates src/lib/stops-database.json
    update-holidays-db.mjs   # Fetches nager.at API and regenerates src/lib/holidays.json
    download-emoji-svgs.mjs  # Downloads Twemoji SVGs for FiestasCountdown (card collection + mensajes por temporada). Ojo: reescribe todos los SVG sin width/height, conviene revisar el diff tras correrlo
    sync-data-sources.mjs    # Regenera desde data-sources.json la sección "Data Sources & Fallback Chains" de AGENTS.md y la tabla del README (`pnpm run sync-credits`)
    post-build-pages.mjs     # Reestructura dist/ para Cloudflare Pages (`_worker.js/index.js` + merge de public/ en dist/)
  styles/
    global.css               # Tailwind + DaisyUI base styles + scrollbar
```

## API Routes

All routes return JSON. CORS is not needed (same-origin).

| Route                                 | Cache  | Response                                                                                                                |
| ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /api/news?mode=inventory`        | 15 min | `{ allSources }` — OPML source list                                                                                     |
| `POST /api/news/batch`                | per-source 15 min | `{ articles, sourceResults }` — per-source caching (`rss:{url}`), only fetches uncached sources              |
| `GET /api/channels?source=`         | 1 hour | `{ channels, categories }` — **used by ClientTV** (server endpoint avoids CORS + subrequest limits). `source`: `json-teles` (default), `iptv-org`, `mi-iptv` (fparrav/mi-iptv M3U con fallback jsDelivr) |
| `GET /api/finance`                    | 30 min | `{ uf, dolar, euro, ipc, utm }` — **fallback only** (FinanceWidget fetches mindicador/dolarapi directly)               |
| `GET /api/youtube`                    | 60 min | `{ videos, channelStatuses }` — YouTube Chile trending via RSS                                                          |
| `GET /api/youtube/source?channelId=&name=` | 5 min | `{ videos, status }` — retry single channel                                                                        |
| `GET /api/trends`                     | 30 min | `{ trends }` — Google Trends Chile RSS                                                                                  |
| `GET /api/weather?q=<ciudad>` o `?cities=a,b` (sin parámetros = ciudades por defecto; `q` y `cities` son excluyentes) | 10 min | `{ weather }` — **fallback only** (WeatherWidget fetches Open-Meteo directly; servidor: Open-Meteo → Gael Cloud → Boostr, y `weather: null` con `no-store` si todo falla) |
| `GET /api/transport?city=&stop=`      | 5 min  | `{ city, metro, stations, stopInfo }` — Metro lines + estaciones + llegada de buses RED                                 |
| `GET /api/transport?city=&route=`     | 5 min  | `{ routeStops }` — Paraderos de un recorrido (ej: route=506)                                                            |
| `GET /api/transport?mode=route-names` | 1 hour | `{ routes }` — Lista de todos los números de recorrido RED                              |
| `GET /api/air-quality`               | 30 min | `{ source, stations }` — SINCA estaciones (PM2.5/PM10 + estado ICAP) o fallback Open-Meteo ciudades |
| `GET /api/sports`                     | 30 min | `{ articles, sourceResults, totalSources, displayedSources }` — Sports RSS from OPML ⚽ Deportes category + keyword-matched feeds across all categories |
| `GET /api/futbol`                     | 10 min | `{ articles, sourceResults, totalSources, displayedSources }` — **RSS articles only** (FootballTable fetches ESPN standings/matches directly; ESPN no tiene fallback) |
| `GET /api/emergency`                  | 5 min  | `{ items, senapred }` — items: Gael Cloud → Boostr → USGS fallback chain (coords attached from Boostr); senapred: 🚨 SAE alerts via Telegram (rendered separately from the sismos chain — Telegram is the official live SAE feed; the CREF events page requires AWS AppSync Cognito/SigV4, fragile to reimplement). If Boostr is unreachable from the Worker, EmergencyWidget re-enriches `lat/lon` client-side from Boostr (API is CORS-open) so sismo pins always render |
| `GET /api/power` (+ `?fresh=1` bypass con rate-limit 1/2min por IP) | 15 min interno / 5 min edge (60 s con `?fresh=1`) | `{ affected, total, pct, updatedAt, regions, comunas, series }` — SEC clientes sin suministro (POST proxy, edge-cached; comunas con lat/lon vía `comunas-coords.ts`, series horaria). Cada región trae `{ region, affected, total, pct }`: `total` = clientes de esa región (`GetClientesRegional`, cacheado 7 días + tabla compilada de respaldo) y `pct` = % de su base sin suministro. Payload construido por `src/lib/power.ts`, compartido con `/api/cron`. **Única fuente, sin cadena de fallback**: si la SEC falla sirve el snapshot durable `power:lastgood` (6 h) con `stale: true`; solo si tampoco existe devuelve 502 `SEC no disponible`, y ese error va con `no-store` (nunca se cachea en el edge) |
| `GET /api/cyber` | 15 min (3 min si un bloque falló) | `{ alerts, kev, blocks, updatedAt }` — CSIRT Nacional (alertas + severidad) y CISA KEV recortado a 30/90 días + ventana de ransomware de 180 días y conteo por vendor. Bloques independientes: si uno falla viaja con `blocks.*.ok=false` y el otro se sirve igual; snapshot durable `cyber:lastgood` (6 h) con `stale:true` si todo falla |
| `GET /api/holidays`                   | 24 hours | `{ holidays }` — **fallback only** (HolidaysWidget fetches nager.at directly, bundled fallback). Cadena Boostr → Nager → `holidays.json`                        |
| `GET /api/article?url=`               | 60 min | `{ title, body, bodyHtml, author, ... }` — Article content proxy via cheerio                                            |
| `GET /api/radio-stations`             | 1 hour | `{ stations, tags, states, stateCounts, total }` — **used by ClientRadios** (server endpoint avoids CORS + subrequest limits) |
| `GET /api/jobs?source=getonbrd\|workanywhere\|remotive` | 1 hour | `{ jobs, sources, sourcesMeta }` — Job listings from multiple sources (sin `source` = todas en paralelo) |
| `GET /api/spotify`                    | 1 hour | `{ title, thumbnailUrl }` — oEmbed de la playlist «Top 50 Chile» (metadatos de la card; el chart es un iframe embed)     |
| `GET /api/forecast`                   | 1 hour | `{ forecasts }` — DMC pronóstico 5 días from pronostico.js (parsed client-side by WeatherWidget)                          |
| `GET /api/cron`                       | —      | Cache pre-warming (sports, youtube, power, trends, cyber) — Bearer auth via `CRON_SECRET`                                |

## Architecture & Conventions

### Hydration strategy

- Components use Astro `client:*` directives for partial hydration
- **Above-fold** (load eagerly): `Header`, `SideIndex`, `BottomNav`, `EmergencyTicker`, `EmergencyWidget` (que monta `PowerOutageWidget`) y `BackToTop` — `client:load`
- **Mid/below-fold** (load at idle): `ClientNewsFeed`, `ClientTV`, `ClientRadios`, `CyberWidget`, `FinanceWidget`, `YouTubeTrends`, `SpotifyChart`, `GoogleTrendsWidget`, `WeatherWidget`, `AirQualityWidget`, `TransportWidget`, `FootballTable`, `JobList`, `HolidaysWidget`, `FiestasCountdown`, `Footer` y `SectionShareHandler` — all `client:idle` (hydrate via `requestIdleCallback` when browser is free, regardless of scroll). This preloads content in the background so sections are rendered before the user scrolls to them; on reload the IDB Phase-0 render makes skeletons invisible
- **hls.js** is loaded lazily via `import('hls.js')` only when a user plays an m3u8 stream, not at hydration time
- **clustering.ts** is code-split via dynamic `import()` in ClientNewsFeed (not in main bundle)

### Data flow

1. Astro SSR serves the main page shell (no SSR data — all fetching is client-driven)
2. On page load, an inline script fires `fetch()` to all API endpoints via `requestIdleCallback` — critical (emergency) + deferred (news, channels, radios, youtube, trends, transport, sports, futbol, jobs, spotify). Server cache is hot before widgets hydrate
3. React components mount and either fetch directly from external APIs (CORS-enabled) or from `/api/...` server endpoints (channels, radios, emergency use server endpoints to avoid CORS/subrequest limits)
4. **IDB caching (IndexedDB)**: All major widgets cache results in IDB for instant reload. Pattern: render from IDB first, fetch in background, update IDB
5. API routes serve for: CORS-blocked sources (RSS feeds, YouTube), fallback chains (emergency, weather), or client-side CORS avoidance (channels, radios)

### Input and proxy security

- APIs that expose user-controlled query parameters validate allowed keys, accepted values, request size, and cache cardinality before reading or writing cache entries.
- `POST /api/news/batch` accepts at most 40 URLs and canonicalizes them against the current RSS inventory; it never fetches arbitrary client-supplied hosts.
- `/api/article` validates the initial URL and every redirect with `validateFetchUrl`, follows at most five redirects, rejects credential-bearing/private targets, and sanitizes extracted HTML through `sanitizeArticleHtml` before returning it.
- External data rendered as Leaflet popup/tooltip HTML must use DOM nodes + `textContent`; do not interpolate API values into HTML strings.
- `/api/cron` fails closed with 503 when `CRON_SECRET` is unset and otherwise requires `Authorization: Bearer <CRON_SECRET>`.

### Component patterns

- **Client components** (`Client*.tsx`): Fetch data, manage loading/error states, render presentational components
- **Presentational components**: Receive data as props, no data fetching
- All React components use **named exports** (not default exports)
- Components use `.tsx` extension and Tailwind for styling

### TV system

- `ClientTV` orchestrates state via single `player: { channel, signalIndex, mode } | null`
- Mode is `'inline'` (full-size in document) or `'pip'` (fixed bottom-right overlay)
- El wrapper del video lleva `z-30` a propósito: en los layouts laterales es `lg:sticky`, y `position: sticky` crea stacking context. Sin ese `z-30` el miniplayer (`fixed z-50`, pero anidado) se pinta **por debajo** de las tarjetas de canales; con él el miniplayer queda sobre la grilla y bajo el navbar fijo (`z-50`). El `<video>` no se mueve de sitio: sólo cambia el orden de pintado
- `UnifiedPlayer` handles both modes with a single `<video>` element and hls.js instance — no destroy/recreate on mode switch
- FLIP animation on mode switch: captures `getBoundingClientRect()`, sets `position: fixed` at same rect (no visual jump), animates to target position/size via CSS `transition: all 0.35s cubic-bezier(0.22, 1, 0.36, 1)`
- Auto-PiP: `IntersectionObserver` detects section scroll-out-of-view, switches mode directly (no animation)
- Search input + favorites toggle (localStorage-persisted, heart icon per channel)
- Channel grid: logo, name, category filter, horizontal scroll with arrow buttons
- Channel grid density: 1–5 rows (persisted in `localStorage['tv-grid-rows']`); >1 row renders a `grid-auto-flow: column` grid so cards fill down then wrap right while still scrolling horizontally. Sort order A-Z / Z-A toggles (`localStorage['tv-sort']`, `Intl.Collator('es')`), both applied in `ClientTV`'s `filtered` memo and passed down as `rows`/`channels`
- Layout: **una sola card** (`rounded-xl border border-base-300 bg-base-100 p-1.5`) agrupa **filtros + canales**: búsqueda → categorías → `Filas`/`Orden` → grilla, con una regla fina entre filtros y botones para que la grilla se lea como su resultado y no como un bloque aparte. Las **playlists** ya no viven ahí: subieron a la barra fija (fila superior). El conteo de canales va como badge dentro del chip de la **playlist activa** (`json-teles 194`), no como badge suelto
- `Filas` (1–5) y `Orden` (A-Z/Z-A) no son filtros: viven en una fila delgada alineada a la derecha **justo encima de los botones de canales** (`gridControls`, dentro de `gridNode`, ya dentro de la card de filtros), con el conteo filtrado en un `sr-only role="status"`. `Filas` se oculta en los layouts laterales (ahí la grilla es vertical y el número de filas no aplica)
- La fila de categorías (`ChannelSelector`) sigue siendo un scroller horizontal, pero **"Todos" es un pill partido**: la etiqueta filtra por todas y el chevron abre un desplegable (portal a body, `role="dialog"` + `aria-modal`, `aria-haspopup`/`aria-expanded` en el trigger) con el **listado completo A-Z + conteos y buscador accent-insensitive** (`foldAccents`), así se llega a cualquier categoría sin sumar alto al body. Escape y click-fuera cierran (Escape devuelve el foco al trigger), Tab queda atrapado en el panel y el chip de la categoría elegida se auto-desplaza a la vista (`data-cat-chip`)
- Los controles que cambian **la vista del reproductor** no viven en la card de filtros ni viajan con el bloque de video: `mediaBar` es una **barra fija arriba de la sección** (siempre en el mismo sitio) de **dos filas**: arriba las **playlists** (fuente de los canales, con el conteo en la activa) y abajo `Cuadrícula` + su disposición junto a la derecha el toggle de placeholder compacto + `PlacementPicker`. Reposicionar no mueve los controles
- `Cuadrícula` es un **control segmentado**: el toggle (antes `Multi`) y las opciones de disposición (`1x1`…`3x3`) comparten superficie `bg-primary/15` cuando está activo, con la opción elegida en `bg-primary text-primary-content`; desactivado sólo queda el toggle. Las opciones llevan `aria-pressed` y el grupo `aria-label="Disposición de la cuadrícula"`
- **Multiview** (`MultiviewGrid` + `MultiviewCell`): 1–9 streams a la vez, cada celda con su propio `<video>`/hls.js, selector de señal, mute salvo el slot enfocado y botón de quitar. Estado en `localStorage`: `tv-view-mode` (`single`/`multiview`), `tv-multiview-layout` (`1x1`, `1x2`, `1x3`, `2x2`, `2x3`, `3x3`) y `tv-multiview-slots`; al encoger el layout se truncan los slots sobrantes
- Ubicación del reproductor (`localStorage['tv-player-placement']`): `below` (default), `above`, `left` y `right` (los laterales solo `≥lg`: dos columnas con el reproductor `lg:sticky lg:top-[88px]` en el lado elegido y el toolbar + grilla en el otro; en móvil caen a `below`). El valor antiguo `side` se migra a `left`. En los laterales el `ChannelGrid` cambia a `variant="wrap"` (grilla vertical de 3 columnas con scroll propio)
- El bloque de video y el bloque filtros+grilla **nunca se desmontan al reposicionar**: ambos quedan montados en el mismo contenedor (media primero, filtros+grilla después) y sólo cambian de `order` (`mediaOrder`); el contenedor pasa de `flex flex-col` a `lg:grid` en los laterales. Así el `<video>` conserva el stream al cambiar de ubicación. Tras cada cambio, `.tv-media-land` (global.css) pinta un anillo `outline` que se desvanece en ~480 ms — no anima ni toca el contenido del player, y respeta `prefers-reduced-motion`
- El placeholder sin canal es **completo por defecto** (`aspect-video` con ícono y texto); el usuario puede pasarlo a barra compacta con el toggle de la media bar (`localStorage['tv-placeholder-compact']`, `false` por defecto)
- `useIsDesktop()` (matchMedia `min-width: 1024px`) decide si `left`/`right` están disponibles y si el grid usa `strip` o `wrap`
- Signal selector in both modes (HD/WEB/YT/Twitch toggles)
- Inline mode: custom UI controls (play/pause, progress bar, volume, fullscreen, PiP trigger, auto-hide on idle)
- PiP mode: compact controls (play/pause, mute, expand, close), draggable via title bar (pointer events with `setPointerCapture`), centered signal selector
- m3u8 playback uses `hls.js` (dynamically imported via `import('hls.js')`); iframe/YT/Twitch channels use `<iframe>` directly
- Video starts unmuted (assumes user-initiated play); `error` state clears on `canplay`/`play` events
- Channels fetched via `/api/channels` server endpoint (avoids CORS + subrequest limits), with IDB cache (24h TTL)

### Radio system

- Uses a curated set of radio station IDs from the channels JSON
- Falls back to hardcoded `FALLBACK_RADIOS` if API fails
- Boombox layout: player panel (left) + station list (right) on desktop, stacked on mobile
- HLS audio uses hidden `<video>` + hls.js; direct audio streams use `<audio>` element
- Stations fetched via `/api/radio-stations` server endpoint (avoids CORS + subrequest limits), with IDB cache (24h TTL)
- CD disc images (radio player animation): `public/cd-disc-1.webp`–`cd-disc-5.webp`. Randomly picked per station in `BoomboxDisplay`.

### News system — 6 slots with dropdown

- **Phase 0 (instant):** `GET /api/news?mode=inventory` returns just the OPML source list (`allSources[]`) — no RSS fetch, fast
- **Phase 2 (on mount):** `POST /api/news/batch` fetches all 6 selected sources in parallel (uses defaults from localStorage or fallback list)
- **No Phase 3** — clustering and trending are computed **client-side** from the 6 active slots' articles
- Each slot has a dropdown to change its source (from the full inventory). Sources already in use are disabled in other slots' dropdowns
- The dropdown has a **"Solo principales por sitio"** toggle (`localStorage['news-main-only']`, shared across slots and with `/todas-las-fuentes`) that keeps only one feed per outlet, collapsing section feeds (`<Medio> - Deportes`, `- San Felipe`, …) into the flagship feed. Best pick per outlet (grouped by the `source` base name) is ranked by `mainFeedTier` (bare outlet name → generic name like "Noticias"/"Últimas"/"Portada" → anything else), then by fewest URL path segments, then shortest URL. The currently selected source is always kept in the list. The dropdown portal cap is 384px so the extra row doesn't squeeze the list/footer
- The dropdown lists one **outlet per group** (`orderByOutlet` in `src/lib/sources.ts`): the inventory is a concatenation of `news` then `regional` blocks and a few feeds carry a per-feed category differing from their outlet's, which used to scatter an outlet's feeds ~1400 rows apart (132 of 403 outlets were split). Every feed of an outlet stays together, flagship feed first, then A-Z
- The dropdown has an **A-Z / Z-A** order (`localStorage['news-sort']`, default `az`, shared across slots). Z-A is the exact reverse of A-Z. Fijados stay in slot order above the sorted list
- Dropdown search is accent-insensitive (`foldAccents`), so "discusion" matches "La Discusión"
- Slots persist to `localStorage['news-slots']` (array of 6 sourceKeys). Pinned sources persist to `localStorage['news-pins']` (`Record<number, string>` — slot index → sourceKey)
- Pinning a source to a slot (⭐ pin icon in header or dropdown) ensures it always loads in that slot on page reload, overriding `news-slots`. Sources can only be pinned to one slot at a time. On reload: pinned sources take priority → saved keys → inventory defaults.
- Default 6 sources (`DEFAULT_SLOTS` in ClientNewsFeed): fixed outlets **Ciper Chile · Contrapoder Chile · ADN Radio · BioBioChile · La Tercera - Nacional · FastCheckCL**, matched by exact `sourceKey` with an alias fallback via `resolveOutlet()` if a key is renamed upstream. A default that fails to load is replaced by the auto-skip system
- Trending tags are computed reactively from the 6 active sources' articles whenever a slot changes
- Tags in trending section are clickable — clicking a tag sets `?tag=` on the URL and scrolls to news section, filtering both source cards and clusters by that keyword
- Clicking "Limpiar" clears the filter

### News caching (client-side + server-side)

- **Client IDB**: Batch results cached in IDB (`news-batch:{sourceKeys}`) with 10 min TTL — page reloads render articles instantly from cache
- **Client IDB per-source**: Individual slot fetches cached (`news-source:{sourceKey}`) — switching slots is instant on revisit
- **Server per-source**: `batch.ts` caches each source individually (`rss:{url}`) with 15 min TTL — changing 1 slot doesn't invalidate the other 5

### News clustering (client-side)

1. Fetches RSS feeds only from the 6 selected sources (not all ~2400 in the inventory)
2. Extracts keywords from titles (removes stopwords, produces unigrams + bigrams + trigrams) — shared `src/lib/clustering.ts`
3. Calculates similarity between article keyword sets (Jaccard index > 0.25 = same cluster)
4. Returns clusters sorted by score (article count × source diversity)
5. Clustering runs automatically in the browser whenever slot articles change

### Ciberseguridad system

- **Dos bloques independientes** (`src/lib/cyber.ts`): alertas CSIRT Nacional y vulnerabilidades CISA KEV. Cada bloque se resuelve en paralelo y expone `blocks.*.ok` + `sources[]` con el estado por fuente: si el CSIRT cae, KEV se sirve igual (nunca se muestra «sin alertas» por un fallo de red)
- **Severidad CSIRT**: `Vulnerabilidad Crítica` → `critical`, `Campaña Fraudulenta`/phishing/ransomware → `high`, resto → `info`. El vendor sale de la primera categoría no genérica del feed
- **KEV recortado en el servidor**: el JSON de CISA pesa ~1,8 MB; se recorta a 30 días (90 si hay <10 entradas) y se cachea 6 h. El flag `knownRansomwareCampaignUse` es raro (0–3 al mes), así que el filtro «Solo ransomware» usa una ventana aparte de 180 días (`kev.ransomwareRecent`) en vez de filtrar la lista de 30 días
- **TTL degradado**: `/api/cyber` cachea 15 min; si algún bloque falló, 3 min para que se recupere solo. Si ambos fallan se sirve el snapshot durable `cyber:lastgood` (6 h) con `stale: true`
- **Cliente**: `CyberWidget` pinta desde IDB (`cyber`, 15 min) antes del fetch, se refresca con `subscribeAutoRefresh` (5 min + foco de pestaña), reintenta con `useErrorRetry` y pagina de a 20 filas dentro de un contenedor `max-h-[440px]` (con botón «Cargar más» para teclado)
- **Lectura en modal**: el clic normal en una fila abre el sitio original en otra pestaña (como Noticias); el botón de libro del extremo derecho abre `ArticleReader` (el mismo lector de Noticias) para quien prefiere no salir. Funciona con las alertas CSIRT porque son HTML normal y `/api/article` las extrae. KEV no pasa por el lector: NVD es una ficha, no un artículo
- **Estilo de fila**: tarjetas neutras (`bg-base-100` + `border-base-300`), sin barra de color lateral; la severidad vive sólo en el chip. No hay banner de alerta crítica: repetía la primera alerta de la lista, así que el conteo «N críticas» del encabezado es un botón que salta a Alertas con «Solo críticas» activo. La barra de herramientas pone primero las pestañas (con su conteo) y debajo buscador + filtro de la pestaña activa

### Accessibility conventions

Accessibility is treated as part of the component craft, not a compliance pass. These are the project-wide rules:

- **Native elements first.** Actions are `<button>`, navigation is `<a href>`, never `<div onClick>`. If a clickable card also needs nested controls, render a real `<button>` as the card's selection element (or an `absolute inset-0` button) with the nested controls as siblings — never `role="button"` with focusable children.
- **Visible focus rings.** Use `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary` on interactive elements that need a custom ring; otherwise keep the native ring. Never `outline:none` without a visible replacement.
- **Keyboard operability.** Every interactive control is reachable and operable by keyboard (Enter/Space activate buttons, arrow keys where a composite widget expects them, Escape closes overlays). No positive `tabindex`.
- **Overlays / modals.** Any portal/drawer/modal gets `role="dialog"` + `aria-modal="true"` + an `aria-label`, moves focus in on open, **traps Tab**, and **restores focus** on close. Hidden-but-visual states must also be removed from the tab order via `inert`/`aria-hidden` (never rely on `opacity-0`/`pointer-events-none` alone).
- **ARIA state on toggles/selection.** Every toggle, disclosure, filter chip, signal selector, and checkbox announces its state: `aria-pressed`, `aria-expanded`, `aria-checked`, `aria-selected`, or `aria-live`. State is never conveyed by color/background alone.
- **Accessible names.** Icon-only controls get `aria-label` (changing with state) and their decorative SVG gets `aria-hidden="true"`.
- **Skip link.** `index.astro` has a visually-hidden "Ir al contenido" link (`href="#main"`) shown on focus; `<main>` carries `id="main"`.
- **Auto-updating content.** Regions that update in the background (emergency) share new items via `aria-live="polite"` and explicitly silence per-second timers/countdowns (`aria-live="off"`).
- **Hit areas.** Icon/touch targets are ≥ 24px (ideally 28–32px); interactive cards expose clear `focus-visible` affordances.
- **No controls behind hover.** Every button is visible at rest and reachable without a pointer: hover may change color/background/scale, never `opacity: 0`, `visibility`, `display` or `pointer-events`. Revealing a button on hover hides it from mobile and first-time users, who never learn it exists.
- **Content visibility.** No content is initially `opacity: 0` gated on JS to become visible — headings render visible by default; animations are additive, never the only reveal mechanism.
- **Reduced motion.** Center-stage animated surfaces (marquee alert bar, pulsing indicators) respect `prefers-reduced-motion` and pause while hovered/focused.

### Theme system

- **DaisyUI v5** handles all theme colors natively via `daisyui` plugin
- 35 themes configured in `src/styles/global.css` under `@plugin "daisyui" { themes: ... }`; `dark` es el `--default` de CSS, pero la app arranca en **`halloween`** (`data-theme="halloween"` en `index.astro`/`creditos.astro` y `useState('halloween')` en `ThemeSwitcher`) cuando no hay `localStorage.theme`
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
- **`.light-theme` class**: toggled on `<html>` by init script + `ThemeSwitcher` based on `getComputedStyle().colorScheme.includes('light')`. Use `.light-theme` for light-theme-specific CSS — `@media (color-scheme: light)` does NOT work because the browser evaluates it at initial render (dark default) and doesn't re-evaluate when JS changes `data-theme` dynamically.
- DaisyUI generates all `[data-theme="..."]` CSS blocks automatically
- DaisyUI CSS variable names: `--color-base-100/200/300`, `--color-base-content`, `--color-primary`, `--color-primary-content`

### Styling

- Font: Figtree (body) + Lora (headings) via Google Fonts `<link>` in `index.astro` (DM Serif Display replaced by Lora for a more classic editorial tone)
- No animation library — all interactions use CSS transitions + `active:scale` for tactile feedback
- Icons: inline SVG components (no icon library dependency)
- Tailwind v4 configured in `src/styles/global.css` (`@import "tailwindcss"`) — no `tailwind.config.*` file
- DaisyUI v5 configured via `@plugin "daisyui"` with inline theme list in global.css
- Custom CSS (scrollbar, keyframes) in global.css uses `var(--color-*)` DaisyUI variables

### Loading skeletons

Cada skeleton reserva el alto real de su bloque para que la sección no salte al llegar los datos. Convención:

- El contenedor de carga lleva `min-h-[<móvil>px] sm:min-h-[<desktop>px]` con el alto **del bloque real** (sin contar el header de `Section`, que aporta 60 px + `mb-5`).
- Las listas/tarjetas internas usan `flex-1` para llenar la reserva (`flex flex-col` en el contenedor) en vez de dejar un hueco vacío al final.
- Se mantiene el chrome real: barras de pestañas/buscador y ventanas fijas (`max-h-[460px]`, `[440px]`, `[480px]`) se pintan con el mismo alto, y el bloque expone un `sr-only role="status"` para anunciar la carga.
- Valores medidos en producción (móvil/desktop): YouTube 300/524, TV 579/1031, Ciber 633/613, Trabajos 812/716 (lista 480 + fila de chips que solo existía con datos), Deportes 843/826 (tabla 16×41 px), Emergencia 1632/1339 (SENAPRED + sismos con fila "Ver mapa" + cortes de luz 1137/864), Aire 624, Feriados 881/853, Tendencias 1001/881, Clima 687/518, Transporte 456/366. Finanzas, Radios, Spotify y Fiestas ya coincidían.
- Noticias es el caso especial: el skeleton pinta la grilla de `slotCount` slots **y** las dos piezas que llegan después de los artículos —la tira de tendencias (34 px) y el bloque «Agrupadas por tema» (`h-[420px]`)—, porque insertarlas a mitad de carga movía todo el resto de la página (CLS ~2,6 en móvil y escritorio). Los clusters viven en una ventana de alto fijo con scroll interno, así que añadir temas o «Cargar más» no cambia el alto del bloque. Ver `NewsFeed.tsx` y `TrendingTags.tsx`.
- **La raíz del widget conserva su `min-h` al pasar de cargando a cargado.** Si el `div` raíz cambia de `className` (pierde `flex min-h-[…]`, o cambia de `grid` a `flex`) justo cuando llegan los datos, Chrome registra un layout shift de 0,77–0,92 aunque el alto final sea el mismo: el estado intermedio deja la raíz sin caja. Medido en Lighthouse móvil: Tendencias, Clima y Feriados sumaban 2,6 de CLS solo por eso. El contenido va **dentro** de una raíz que mantiene `min-h` (y el mismo `display`) en ambos estados; el `animate-pulse` sí se puede quitar. Ver `GoogleTrendsWidget.tsx`, `WeatherWidget.tsx` y `HolidaysWidget.tsx`.
- **Los estados «sin datos» también reservan.** Un error o un vacío no puede devolver una cajita corta: mantiene el mismo `min-h` del esqueleto con un fantasma (`aria-hidden`, `opacity-20`, `animate-pulse`) y el mensaje/botón encima. Cortes de luz (`PowerOutageWidget`, 1137/864) y Deportes (`FootballTable`, tabla 684 px) colapsaban 583–1077 px y arrastraban media página; ahora ambos pintan su reserva con `Reintentar`.

### Hero (portada)

- Fondo rotativo diario desde `src/lib/backgrounds.ts` (`getTodayBg()`, con `focalPoint` por foto) + scrim suave `from-base-100/25 via-base-100/30 to-base-100/70`
- **Ojo con los nombres**: la sección usa `.hero-stage` y el scrim `.hero-scrim` a propósito. `.hero` y `.hero-overlay` son componentes de daisyUI (`display:grid` + `grid-row/column-start` en todos los hijos → re-ancla el `absolute inset-0` de la imagen al content box y le mete un relleno `neutral 50%` detrás del degradado)
- Botón de esquina (`.hero-toggle`, ojo/ojo-tachado) colapsa el card a una **isla compacta abajo-izquierda** para dejar ver la foto completa; el estado persiste en `localStorage['hero-collapsed']`. La isla (`.hero-island`) es un `<button>` que también restaura al hacer click, `inert` mientras está oculta
- El cierre **aterriza sobre la isla**: `measure()` en `index.astro` mide la caja de layout del card y la de la isla y publica `--hero-tx/--hero-ty` (translate hasta la esquina de la isla) + `--hero-isl-w/-h/-r`; el `clip-path` del card termina como `inset(calc(100% - var(--hero-isl-h)) calc(100% - var(--hero-isl-w)) 0 0 round <radio>)` = exactamente la misma píldora, con `border-radius` igual al de la isla
- El estado colapsado oculta el card con `clip-path` (**no** `opacity`) para que el `<h1>` siga en el árbol accesible (el clip vive en `.hero-card`, no en el wrapper, porque su border box es la caja de referencia de la píldora; el inset expandido es negativo, `-4rem`, para no cortar la sombra y para que `clip-path` interpole en vez de saltar); el scrim y el fade inferior bajan de opacidad para mostrar más imagen
- La sección sólo lleva `rounded-t-2xl`: con el card arriba el fade inferior termina en base-100 (igual que el `body`), así que las esquinas de abajo no se ven. El estado colapsado redondea las inferiores a `1rem` (`border-bottom-*-radius`, animadas con `--duration-slow` junto al fade) para que la foto a la vista quede como card completa
- La isla aparece **sólo con opacidad** (nada de `transform`): una transform la haría depender del estado y cualquier override inline arrancaría su propia transición, ensuciando justo la caja que el cierre tiene que igualar. Su fade-in va retrasado (`--duration-fast` de delay) para que el texto se materialice cuando el remanente ya aterrizó, y sin delay al expandir
- `measure()` lee el translate aplicado desde la matriz computada del wrapper (`DOMMatrixReadOnly`, con fallback si `transform: none`) en vez de limpiar el `transform` inline: así medir a mitad de animación (al terminar de cargar las fuentes, o un `resize` durante la transición) sigue siendo exacto y no reinicia ni salta nada. Se re-mide tras `document.fonts.ready` porque la tipografía cambia las cajas
- Las transiciones sólo se activan tras `.hero-ready` (que añade el script inline de `index.astro` tras aplicar el estado inicial), así un estado persistido no anima en la carga
- El toggle es un `<script is:inline>` (sin isla React) con guard `data-bound` y re-inicialización en `astro:page-load`

### Source attribution convention

Every widget/section must include a right-aligned source attribution at the bottom. It is **not** written by hand: use the shared `SectionSources` component (`src/components/SectionSources.tsx`), which reads `sections.<id>.sources` from `src/lib/data-sources.json` — the single source of truth for sources, fallback chains and licenses.

```tsx
<SectionSources section="weather" />
<SectionSources section="emergency" only={['CSN (U. de Chile)', sismosSource === 'usgs' ? 'USGS' : '...']} />
<SectionSources section="news" inline />   {/* span en línea, no bloque inferior */}
```

- Renders `Fuente:` (1 source) or `Fuentes:` (varios), each name hyperlinked to its origin, with extra links after a `·` separator.
- `only` keeps just the sources actually used in this render (p. ej. el sismo muestra USGS sólo si esa fue la fuente servida); `inline` devuelve un `<span>` en vez del bloque inferior.
- Styling lives in the component (`mt-2 text-right text-[11px] text-base-content/70`): all sections aligned `text-right`, never `text-center` or `text-left`.
- Every section must have attribution — no hidden or missing sources, including error/empty states.
- Si una sección nueva necesita fuentes, agrégalas en `data-sources.json` (y corre `pnpm run sync-credits`) en vez de escribir los enlaces a mano. `ClientJobList` mantiene su bloque manual porque cambia de fuentes por pestaña.

## Data Sources & Fallback Chains

> Fuente canónica: `src/lib/data-sources.json` (renderizada en `/creditos`).
> Esta sección es solo una referencia — no duplica el contenido del JSON.
> Para consultar la lista completa de fuentes, cadenas de fallback y licencias, leer directamente `src/lib/data-sources.json` (JSON estructurado por secciones).
> Regenerar `/creditos` y la tabla del `README.md` con `pnpm run sync-credits` si se edita el JSON.


## Sound System (Web Audio API)

Module-level singleton using raw Web Audio API (no library). Exports `play(role)`, `toggleMuted()`, `isMuted()`.

### Implementation

- `src/lib/sound.ts` — Self-contained ~146 lines: oscillator + noise synthesis, no external imports, 20 sound roles (interaction.tap, interaction.subtle, interaction.toggle, interaction.confirm, navigation.forward/backward/tab, notification.info/success/warning/error, overlay.open/close/expand/collapse, hero.complete/milestone, media.volume/play/stop)
- AudioContext created lazily on first `play()` call (browser policy)
- Default volume: 0.5
- Triangle wave + bandpass-filtered noise for crisp, tactile feedback (same character as old crisp pack)
- Footer includes a sound toggle button (`toggleMuted()`) that persists across islands via the singleton module state

### Where sounds fire

| ThemeSwitcher | `interaction.tap` (theme select) |
| EmergencyAlertBar | `notification.warning` (alert link click) |

## Performance

- **Google Fonts** loaded non-blocking via `media="print" onload="this.media='all'"` (`index.astro`)
- **Static asset caching**: `public/_headers` sets immutable cache for `/_astro/*`, `/emoji/*`, `/cd-disc-*.webp`, `/backgrounds/*` e `/img-footer.webp` (1 year) and 86400 for favicons, `/og-image.webp` y `/chile-flag.svg`
- **Pre-warm**: On page load, an inline script fires `fetch()` (fire-and-forget) to every API endpoint in a single batch inside one `requestAnimationFrame` so the server cache is hot before widgets hydrate. No `requestIdleCallback` split: idle scheduling delayed the warming past the point `client:idle` widgets began fetching on fast scroll
  - Endpoints: `/api/emergency`, `/api/power`, `/api/news?mode=inventory`, `/api/channels?source=json-teles`, `/api/channels?source=iptv-org`, `/api/channels?source=mi-iptv`, `/api/radio-stations`, `/api/youtube`, `/api/trends`, `/api/transport`, `/api/air-quality`, `/api/sports`, `/api/futbol`, `/api/jobs`, `/api/spotify`, `/api/cyber`
  - Scheduled: `/api/cron` (external cron job for persistent cache warming: sports, youtube, power, trends, cyber)
- **Code-splitting**: `clustering.ts` is dynamically imported in `ClientNewsFeed` (separate 2.8 KB chunk, not in main bundle)
- **Map rendering**: Leaflet stays lazy; MapLibre GL/OpenFreeMap and its worker load only when a map is first opened, then are shared across map widgets
- **ClientNewsFeed** hydrates at idle (`client:idle`) instead of eagerly (`client:load`)
- All 35 DaisyUI themes are bundled (no reduction — user preference)

## Deployment

- **Plataforma**: Cloudflare Pages Functions (SSR), deploy automático via Git integration
- **Build command**: `pnpm run build` (the script already runs `scripts/post-build-pages.mjs`)
- **Adapter**: `@astrojs/cloudflare` v14+, `mode: 'directory'`, `output: 'server'`
- **`nodejs_compat`** flag activado en dashboard de Pages

### Post-build (`scripts/post-build-pages.mjs`)

El build de Astro genera `dist/server/` + `dist/client/`. El script reestructura para Pages:

1. `dist/server/` → `dist/_worker.js/`
2. `entry.mjs` → `index.js` (Pages expects `_worker.js/index.js`)
3. `client/*` → `dist/` (merge de assets estáticos, including `_headers`) — **lista explícita `entries`**: cualquier archivo nuevo en `public/` debe agregarse ahí o no llega a `dist/`
4. Elimina `dist/_worker.js/wrangler.json` (conflicto con ASSETS binding de Pages)
5. Elimina `.wrangler/` (apunta al `server/` eliminado)

### Notas

- `wrangler.jsonc` fue eliminado del repo — el CI de Pages lo detectaba y causaba conflictos con el build command personalizado.

### SEO & descubrimiento por IA

- `public/robots.txt` — permite todo y autoriza explícitamente los crawlers de IA (GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Google-Extended) + línea `Sitemap:`. Revisar que el setting "Block AI bots" del dashboard de Cloudflare no lo pise.
- `public/sitemap.xml` — estático (2 URLs). Al añadir rutas nuevas, actualizarlo o migrar a `@astrojs/sitemap`.
- `public/llm.txt` — contexto orientado a LLMs (antes en la raíz del repo, donde Astro **no** lo servía). `public/_redirects` expone el alias `/llms.txt` → `/llm.txt`.
- `astro.config.mjs` tiene `site: 'https://queonda.pages.dev'`.
- JSON-LD en `index.astro` (`WebSite` + `Organization` + `WebApplication`) y `todas-las-fuentes.astro` (`WebSite` + `Organization` + `CollectionPage`).

---

> **Keep updated.** When you add a new route, component, or data source, update the corresponding section above. If the architecture changes significantly, rewrite the relevant section. When you add/change a data source or fallback chain, edit `src/lib/data-sources.json` (single source of truth) and run `pnpm run sync-credits` to regenerate the "Data Sources & Fallback Chains" section and keep `/creditos` in sync. Do not edit that section by hand.
