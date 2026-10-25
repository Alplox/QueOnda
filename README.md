# ¿Qué Onda? - Chile en una sola página

Agregador de noticias chileno + TV/radio en vivo en un dashboard de una sola página, sin anuncios ni distracciones.

🔗 **[https://queonda.pages.dev/](https://queonda.pages.dev/)**

![Dashboard QueOnda con noticias, TV, radio, clima y transporte de Chile](public/screenshot.webp)

## Stack

- **Astro 7** (SSR) + **React 19** + **TypeScript**
- **pnpm 11** como package manager
- **Tailwind CSS 4** + **DaisyUI 5** (35 temas)
- **Cloudflare Pages** (despliegue SSR)
- **Cache API** (caché server-side, dos tier: in-memory + edge)

## Scripts

```bash
pnpm install --frozen-lockfile # instala exactamente pnpm-lock.yaml
pnpm dev                      # localhost:4321
pnpm build                    # dist/ + restructure para Cloudflare Pages
pnpm preview                  # previsualiza el build
pnpm run update-feeds         # regenera src/lib/feeds-database.json
pnpm run update-stops         # regenera src/lib/stops-database.json (RED)
pnpm run update-holidays      # regenera src/lib/holidays.json (feriados)
pnpm run sync-credits         # regenera fuentes en AGENTS.md + tabla en README.md
```

## Secciones

- **Emergencia**: sismos vía Gael Cloud → Boostr → USGS + alertas SAE de SENAPRED (Telegram) + cortes de luz por región/comuna vía SEC (apps.sec.cl), con mapa y evolución horaria
- **Noticias**: RSS feeds de fuentes chilenas, clustering client-side por palabras clave, IDB cache (10 min)
- **TV en vivo**: canales chilenos con HLS/iframe, modo PiP automático, fetch client-side con CDN fallbacks + IDB cache (24h)
- **Radio**: streaming de radios chilenas vía HLS, fetch client-side con IDB cache (24h)
- **Finanzas**: UF, USD, EUR, IPC, UTM vía mindicador.cl + dolarapi.com client-side, server fallback, IDB cache (30 min)
- **YouTube**: últimos videos de canales chilenos vía RSS (reintento automático por canal)
- **Spotify**: Top 50 Chile vía proxy server-side
- **Google Trends**: tendencias Chile
- **Clima**: Open-Meteo directo client-side + Gael Cloud/Boostr server fallback, IDB cache (10 min)
- **Aire**: estaciones SINCA (MP2.5/PM10 + estado ICAP) con mapas Leaflet/OpenFreeMap, fallback Open-Meteo CAMS, IDB cache (30 min)
- **Transporte**: Metro de Santiago + RED (buses) con predicciones
- **Deportes**: RSS deportivo + tabla de posiciones fútbol chileno (ESPN API client-side), IDB cache (1h)
- **Trabajos**: ofertas laborales desde múltiples fuentes
- **Feriados**: calendario de feriados chilenos vía nager.at client-side, bundled fallback, IDB cache (1 año)
- **Fiestas Patrias**: cuenta regresiva para el 18 de septiembre

## Fuentes de datos

<!-- data-sources:start -->
> Generado automáticamente desde `src/lib/data-sources.json` — no editar a mano. Regenerar con `pnpm run sync-credits`.

### Clima (/api/weather)

*Fallback secuencial: Open-Meteo → Gael Cloud → Boostr*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [Open-Meteo](https://open-meteo.com/) | Primario | CC BY 4.0 | api.open-meteo.com/v1/forecast, todas las ciudades en una llamada, timeout 8s |
| [Gael Cloud](https://api.gael.cloud/#todos-los-climas) | Respaldo | API pública — sin licencia explícita | api.gael.cloud/general/public/clima/{ICAO}, timeout 8s |
| [Boostr](https://docs.boostr.cl/reference/weather-code) | Respaldo | API pública — sin licencia explícita | api.boostr.cl/weather/{ICAO}.json, timeout 5s |
| [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | Único | CC BY 4.0 (datos GeoNames) | búsqueda y geolocalización inversa en el widget de clima |
| [DMC](https://www.meteochile.gob.cl/) | Único | Datos públicos del Estado — sin licencia explícita | pronostico.js (5 días, ~60 ciudades) vía /api/forecast |
| [Windy](https://www.windy.com/) | Único | Embed gratuito con atribución | mapa de radar y precipitación embebido |

### Sismos / Emergencias (/api/emergency)

*Fallback secuencial (magnitud mínima 5.0; pasa al siguiente si items.length === 0)*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [Gael Cloud](https://api.gael.cloud) | Primario | API pública — sin licencia explícita | api.gael.cloud/general/public/sismos, timeout 10s; los datos provienen del CSN |
| [Boostr](https://docs.boostr.cl) | Respaldo | API pública — sin licencia explícita | api.boostr.cl/earthquakes/recent.json, timeout 10s; añade coordenadas |
| [USGS](https://earthquake.usgs.gov) | Respaldo | Dominio público (USGS) | earthquake.usgs.gov/.../2.5_day.geojson, filtrado a Chile/Sudamérica, timeout 10s |
| [CSN (U. de Chile)](https://www.csn.uchile.cl/) | Único | Datos públicos — sin licencia explícita | origen de los datos sísmicos; enlace de cada sismo (no se consulta directamente) |

### Alertas SENAPRED (canal independiente)

*Única fuente*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [Telegram SenapredChile](https://t.me/s/SenapredChile) | Único | Canal oficial público — sin licencia explícita | scraping de t.me/s/SenapredChile (BROWSER_UA); parsea .js-widget_message (data-post, <time datetime>, .js-message_text); severidad por keyword (desborde/aluvión/evacuar→critical, crecida/incendio/SAE/alerta→high, preventivo/monitoreo→moderate, else low) |

### Finanzas (/api/finance)

*Merge: itera todas las fuentes y llena indicadores faltantes; se detiene si ya tiene los 5*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [mindicador.cl](https://mindicador.cl) | Primario | Uso libre — sin licencia explícita | mindicador.cl/api, UF, USD, EUR, IPC, UTM, timeout 8s |
| [Boostr](https://docs.boostr.cl) | Respaldo | API pública — sin licencia explícita | api.boostr.cl/economy/indicators.json, timeout 8s |
| [findic.cl](https://findic.cl) | Respaldo | Uso libre — sin licencia explícita | findic.cl/api/, timeout 8s |
| [SII](https://zeus.sii.cl) | Respaldo | Datos públicos del Estado — sin licencia explícita | zeus.sii.cl/admin/rss/sii_ind_rss.xml, timeout 8s |
| [DolarApi](https://cl.dolarapi.com) | Respaldo | MIT | cl.dolarapi.com/v1/cotizaciones, timeout 8s |

### Calidad del aire (/api/air-quality)

*Fallback secuencial (Boostr y Gael Cloud no exponen calidad del aire)*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [SINCA · MMA](https://sinca.mma.gob.cl) | Primario | Datos públicos del Estado — sin licencia explícita | sinca.mma.gob.cl/index.php/json/listadomapa2k19/, ~118 estaciones, timeout 12s |
| [Open-Meteo (CAMS)](https://open-meteo.com/en/docs/air-quality-api) | Respaldo | CC BY 4.0 | air-quality-api.open-meteo.com, modelo CAMS, 18 ciudades, timeout 10s |

### Radios (/api/radio-stations)

*Fallback secuencial; si ambos fallan usa la lista local del código*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [radio-browser.info](https://api.radio-browser.info) | Primario | API pública — datos comunitarios (código AGPL-3.0) | de1.api.radio-browser.info, timeout 15s |
| [json-teles](https://github.com/Alplox/json-teles) | Respaldo | Unlicense (dominio público) | raw.githubusercontent.com/Alplox/json-teles/main/countries/cl.json, filtro category=music |

### Fútbol (/api/futbol)

*Paths paralelos: ESPN para tabla y partidos, RSS para noticias*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [ESPN (API pública)](https://site.web.api.espn.com) | Único | Términos de ESPN — sin licencia explícita | standings + scoreboard chi.1, timeout 8s; sin fallback → tabla/partidos vacíos |
| [Sports RSS (awesome-chilean-rss)](https://github.com/Alplox/awesome-chilean-rss) | Único | CC0 1.0 | noticias vía /api/futbol; siempre se cargan, independiente de ESPN |

### Transporte (/api/transport)

*Fuentes individuales*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [Metro.cl](https://www.metro.cl/el-viaje/estado-red) | Único | Datos públicos del operador — sin licencia explícita | scraping de estado-red, timeout 8s, sin fallback |
| [Red.cl](https://www.red.cl/predictorPlus/prediccion) | Único | Datos públicos del operador — sin licencia explícita | predictorPlus, timeout 5s |
| [DTPM GTFS](https://www.dtpm.cl/) | Único | Datos abiertos DTPM — sin licencia explícita | base de paraderos y recorridos RED (build-time vía update-stops-db.mjs) |

### Feeds RSS (/api/news)

*Local-first: base incluida en el build → GitHub raw → jsDelivr*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [awesome-chilean-rss](https://github.com/Alplox/awesome-chilean-rss) | Primario | CC0 1.0 | catálogo de medios chilenos; la base se incluye en el build como feeds-database.json, instantánea y siempre disponible |
| [GitHub raw](https://raw.githubusercontent.com/alplox/awesome-chilean-rss/main/feeds-database.json) | Respaldo | CC0 1.0 | actualización fire-and-forget, timeout 15s |
| [jsDelivr](https://cdn.jsdelivr.net/gh/Alplox/awesome-chilean-rss@main/feeds-database.json) | Respaldo | CC0 1.0 | actualización fire-and-forget, timeout 15s |

### Cortes de luz (/api/power)

*Única fuente + snapshot durable*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [SEC](https://apps.sec.cl/INTONLINEv1/index.aspx) | Único | Datos públicos del Estado — sin licencia explícita | POST ClientesAfectados/{Get,GetClientesNacional,GetPorFecha,GetClientesRegional}; sin alternativa pública. Si cae, sirve el snapshot power:lastgood (6 h) con stale:true |

### TV en vivo (/api/channels)

*json-teles → iptv-org → mi-iptv*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [json-teles](https://github.com/Alplox/json-teles) | Primario | Unlicense (dominio público) | canales de TV chilenos |
| [iptv-org](https://github.com/iptv-org/iptv) | Respaldo | Unlicense (dominio público) | canales CL (m3u) |
| [mi-iptv](https://github.com/fparrav/mi-iptv) | Respaldo | Sin licencia explícita | playlist m3u (fallback jsDelivr) |
| [YouTube (señales en vivo)](https://www.youtube.com) | Único | Términos de YouTube | embeds YT Live/VOD de los canales que los exponen |
| [Twitch (señales en vivo)](https://www.twitch.tv) | Único | Términos de Twitch | embeds de los canales que transmiten por Twitch |

### YouTube Trends (/api/youtube)

*Única fuente*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [json-teles](https://github.com/Alplox/json-teles/blob/main/countries/cl.json) | Único | Unlicense (dominio público) | lista de canales chilenos (channel_id) |
| [YouTube RSS](https://www.youtube.com) | Único | Términos de YouTube | feeds/videos.xml por channel_id |

### Google Trends (/api/trends)

*Única fuente*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [Google Trends RSS](https://trends.google.com/trending?geo=CL) | Único | Contenido de Google — sin licencia explícita | trending/rss?geo=CL + trendingsearches/daily (fallback) |

### Spotify Chile (/api/spotify)

*Única fuente*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [Spotify "Top 50 Chile" playlist](https://open.spotify.com/playlist/37i9dQZEVXbL0GavIqMTeb) | Único | Spotify — embed oficial | reproductor embebido; /api/spotify solo resuelve el oEmbed |

### Ciberseguridad (/api/cyber)

*Bloques independientes en paralelo; TTL 15 min (3 min si algún bloque falló)*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [CSIRT Nacional](https://www.csirt.gob.cl/alertas/) | Merge | Sitio oficial público — sin licencia explícita | RSS de alertas + severidad |
| [CISA KEV](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) | Merge | Dominio público (obra del Gobierno de EE. UU.) | catálogo JSON recortado a 30/90 días |

### Feriados (/api/holidays)

*Boostr → Nager.Date*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [Boostr](https://docs.boostr.cl/reference/holidays) | Primario | API pública — sin licencia explícita | api.boostr.cl/holidays.json |
| [Nager.Date](https://date.nager.at) | Respaldo | MIT | api/v3/publicholidays/{year}/CL; el widget también consulta directo |

### Empleos (/api/jobs)

*Agregación en paralelo*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [GetOnBrd](https://www.getonbrd.com) | Único | Contenido del sitio — sin licencia explícita | API pública v0 |
| [WorkAnywhere](https://workanywhere.pro) | Único | Contenido del sitio — sin licencia explícita | RSS |
| [Remotive](https://remotive.com) | Único | Contenido del sitio — API pública | remote-jobs API |

### Mapas y basemaps

*Tiles vectoriales sin API key; atribución obligatoria en el mapa*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [OpenFreeMap](https://openfreemap.org) | Primario | MIT (código) · datos ODbL | tiles.openfreemap.org/styles/{positron,dark}, sin API key |
| [OpenMapTiles](https://www.openmaptiles.org/) | Único | BSD-3-Clause (código) · datos ODbL | esquema de teselas del basemap |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Único | ODbL 1.0 | datos base; también teselas raster en el mapa de cortes de luz |

### Imágenes y assets

*Recursos estáticos versionados*

| Fuente | Rol en la cadena | Licencia | Detalle / Enlace |
| ------ | ---------------- | -------- | ---------------- |
| [Foto de portada del footer](https://unsplash.com/es/fotos/manada-de-caballos-en-arbustos-y-pastos-a-traves-de-la-montana-Zf2mL1gtaVg) | Único | Unsplash License | modernwolo en Unsplash |
| [Imágenes de portada (hero)](https://www.pexels.com/) | Único | Pexels License | rotación diaria por día del año (getTodayBg) |
| [cd_dvd_PNG9081](https://pngimg.com/image/9081) | Único | CC BY-NC 4.0 | decorativos en el reproductor de radio; elegidos al azar por estación |
| [cd_dvd_PNG9079](https://pngimg.com/image/9079) | Único | CC BY-NC 4.0 | decorativos en el reproductor de radio; elegidos al azar por estación |
| [cd_dvd_PNG9075](https://pngimg.com/image/9075) | Único | CC BY-NC 4.0 | decorativos en el reproductor de radio; elegidos al azar por estación |
| [cd_dvd_PNG9080](https://pngimg.com/image/9080) | Único | CC BY-NC 4.0 | decorativos en el reproductor de radio; elegidos al azar por estación |
| [cd_dvd_PNG9065](https://pngimg.com/image/9065) | Único | CC BY-NC 4.0 | decorativos en el reproductor de radio; elegidos al azar por estación |
| [Radio Cooperativa](https://upload.wikimedia.org/wikipedia/commons/e/ed/Radio_Cooperativa_Logo.svg) | Único | Marcas de cada emisora; archivos vía Wikimedia Commons | solo cuando el listado remoto de radios falla |
| [Radio Duna](https://upload.wikimedia.org/wikipedia/commons/3/38/Radio_Duna_Logo.png) | Único | Marcas de cada emisora; archivos vía Wikimedia Commons | solo cuando el listado remoto de radios falla |
| [ADN Radio](https://upload.wikimedia.org/wikipedia/commons/5/55/Logo_ADN_Radio.svg) | Único | Marcas de cada emisora; archivos vía Wikimedia Commons | solo cuando el listado remoto de radios falla |
| [Google](https://www.google.com/s2/favicons) | Único | Servicios públicos — sin licencia explícita | favicon de cada medio en las tarjetas de noticias, con respaldo en cascada |
| [DuckDuckGo](https://icons.duckduckgo.com) | Único | Servicios públicos — sin licencia explícita | favicon de cada medio en las tarjetas de noticias, con respaldo en cascada |
| [Icon Horse](https://icon.horse) | Único | Servicios públicos — sin licencia explícita | favicon de cada medio en las tarjetas de noticias, con respaldo en cascada |

<!-- data-sources:end -->

## Licencia

[`AGPL-3.0 license`](./LICENSE). 

Atribución y textos de licencia de dependencias de terceros en [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md).
