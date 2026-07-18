# ¿Qué Onda? - Chile en una sola página

Agregador de noticias chileno + TV/radio en vivo en un dashboard de una sola página, sin anuncios ni distracciones.

🔗 **[https://queonda.pages.dev/](https://queonda.pages.dev/)**

![Captura completa del sitio](public/screenshot.jpeg)

## Stack

- **Astro 7** (SSR) + **React 19** + **TypeScript**
- **Tailwind CSS 4** + **DaisyUI 5** (35 temas)
- **Cloudflare Pages** (despliegue SSR)
- **Cache API** (caché server-side, dos tier: in-memory + edge)

## Scripts

```bash
npm run dev             # localhost:4321
npm run build           # dist/
npm run preview         # npx astro preview
npm run update-feeds    # regenera src/lib/feeds-database.json
npm run update-stops    # regenera src/lib/stops-database.json (RED)
npm run update-holidays # regenera src/lib/holidays.json (feriados)
```

## Secciones

- **Noticias**: RSS feeds de fuentes chilenas, clustering client-side por palabras clave, IDB cache (10 min)
- **TV en vivo**: canales chilenos con HLS/iframe, modo PiP automático, fetch client-side con CDN fallbacks + IDB cache (24h)
- **Radio**: streaming de radios chilenas vía HLS, fetch client-side con IDB cache (24h)
- **Clima**: Open-Meteo directo client-side + Gael Cloud/Boostr server fallback, IDB cache (10 min)
- **Transporte**: Metro de Santiago + RED (buses) con predicciones
- **Finanzas**: UF, USD, EUR, IPC, UTM vía mindicador.cl + dolarapi.com client-side, server fallback, IDB cache (30 min)
- **YouTube**: últimos videos de canales chilenos vía RSS (reintento automático por canal)
- **Google Trends**: tendencias Chile
- **Spotify**: Top 50 Chile vía proxy server-side
- **Deportes**: RSS deportivo + tabla de posiciones fútbol chileno (ESPN API client-side), IDB cache (1h)
- **Trabajos**: ofertas laborales desde múltiples fuentes
- **Sismos**: emergencias sísmicas vía Gael Cloud → USGS
- **Feríados**: calendario de feriados chilenos vía nager.at client-side, bundled fallback, IDB cache (1 año)

## Fuentes de datos

| Fuente | URL | Sección | Orden en fallback |
| ------ | ---- | ------- | ----------------- |
| [Open-Meteo](https://open-meteo.com) | `api.open-meteo.com/v1/forecast` | Clima (1°), geolocalización | Primario |
| [Gael Cloud](https://api.gael.cloud) | `api.gael.cloud/general/public/clima/{ICAO}` + `/sismos` | Clima (2°), Sismos (1°) | Secundario / Primario |
| [Boostr](https://docs.boostr.cl) | `api.boostr.cl/weather/` + `/earthquakes/` + `/economy/` + `/holidays.json` | Clima (3°), Sismos (2°), Finanzas (2°), Feriados | Terciario / Secundario |
| [mindicador.cl](https://mindicador.cl) | `mindicador.cl/api` | Finanzas (1°) | Primario |
| [Findic](https://findic.cl) | `findic.cl/api/` | Finanzas (3°) | Terciario |
| [SII RSS](https://zeus.sii.cl) | `zeus.sii.cl/admin/rss/sii_ind_rss.xml` | Finanzas (4°) | Cuaternario |
| [DolarAPI](https://cl.dolarapi.com) | `cl.dolarapi.com/v1/cotizaciones` | Finanzas (5°) | Quinario |
| [radio-browser.info](https://api.radio-browser.info) | `de1.api.radio-browser.info/json/stations/search` | Radios (1°) | Primario |
| [json-teles](https://github.com/Alplox/json-teles) | `raw.githubusercontent.com/Alplox/json-teles/main/countries/cl.json` | TV, Radios (2°), YouTube | Secundario (radios) / Único (TV, YouTube) |
| [awesome-chilean-rss](https://github.com/Alplox/awesome-chilean-rss) | `feeds-database.json` (local → GitHub raw → CDN) — categoría `sports` | Noticias, Deportes | Primario (local) |
| [ESPN Deportes API](https://github.com/pseudo-r/Public-ESPN-API) | `site.web.api.espn.com` + `site.api.espn.com` | Fútbol (standings + matches) | Único |
| [awesome-chilean-rss](https://github.com/Alplox/awesome-chilean-rss) (categoría `sports`) | múltiples feeds RSS deportivos chilenos | Deportes (RSS) | Primario |
| [Google Trends RSS](https://trends.google.com) | `trends.google.com/trending/rss?geo=CL` | Tendencias | Único |
| [USGS](https://earthquake.usgs.gov) | `earthquake.usgs.gov/.../2.5_day.geojson` | Sismos (3°) | Terciario |
| [Metro.cl](https://www.metro.cl) | `metro.cl/el-viaje/estado-red` (scraping) | Transporte | Único |
| [red.cl](https://www.red.cl) | `red.cl/planifica-tu-viaje/cuando-llega/` → `predictorPlus/prediccion` | Transporte (buses) | Único |
| [DTPM GTFS](https://www.dtpm.cl) | `dtpm.cl/descargas/gtfs/` | Transporte (rutas RED, build-time) | Único |
| [Spotify](https://open.spotify.com) | `open.spotify.com/embed/playlist/37i9dQZEVXbL0GRJmY7SUz` | Spotify Top 50 Chile | Único |
| [YouTube RSS](https://www.youtube.com/) | `youtube.com/feeds/videos.xml?channel_id={id}` (canales desde json-teles) | YouTube | Único |
| [GetOnBoard](https://www.getonbrd.com) + [Remotive](https://remotive.com) + [WorkAnywhere](https://workanywhere.com) | múltiples APIs | Trabajos | Agregado vía proxy |
| [Open-Meteo Geocoding](https://open-meteo.com) | `geocoding-api.open-meteo.com/v1/reverse` + `v1/search` | Geolocalización clima | Único |
| [cheerio](https://cheerio.js.org) | scraping vía `/api/article?url=` | Lector de artículos | Único |

> Para detalle completo de cadenas de fallback (timeouts, criterios de corte), ver [`AGENTS.md`](./AGENTS.md#data-sources--fallback-chains).

## Licencia

AGPL-3.0 license
