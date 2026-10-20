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

*Fallback secuencial*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [Open-Meteo](https://open-meteo.com) | Primario | api.open-meteo.com/v1/forecast, todas las ciudades en una llamada, timeout 8s |
| [Gael Cloud](https://api.gael.cloud) | Respaldo | api.gael.cloud/general/public/clima/{ICAO}, timeout 8s |
| [Boostr](https://docs.boostr.cl) | Respaldo | api.boostr.cl/weather/{ICAO}.json, timeout 5s |
| [Caché stale](https://github.com/Alplox/QueOnda/blob/main/src/lib/cache.ts) | Final (caché) | datos previos vía KV; si todo falla, { weather: null } |

### Sismos / Emergencias (/api/emergency)

*Fallback secuencial (magnitud mínima 5.0; pasa al siguiente si items.length === 0)*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [Gael Cloud](https://api.gael.cloud) | Primario | api.gael.cloud/general/public/sismos, timeout 10s |
| [Boostr](https://docs.boostr.cl) | Respaldo | api.boostr.cl/earthquakes/recent.json, timeout 10s |
| [USGS](https://earthquake.usgs.gov) | Respaldo | earthquake.usgs.gov/.../2.5_day.geojson, filtrado a Chile/Sudamérica, timeout 10s |

### Alertas SENAPRED (canal independiente)

*Única fuente*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [Telegram SenapredChile](https://t.me/s/SenapredChile) | Único | scraping de t.me/s/SenapredChile (BROWSER_UA); parsea .js-widget_message (data-post, <time datetime>, .js-message_text); severidad por keyword (desborde/aluvión/evacuar→critical, crecida/incendio/SAE/alerta→high, preventivo/monitoreo→moderate, else low) |

### Finanzas (/api/finance)

*Merge: itera todas las fuentes y llena indicadores faltantes; se detiene si ya tiene los 5*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [mindicador.cl](https://mindicador.cl) | Primario | mindicador.cl/api, UF, USD, EUR, IPC, UTM, timeout 8s |
| [Boostr](https://docs.boostr.cl) | Respaldo | api.boostr.cl/economy/indicators.json, timeout 8s |
| [Findic](https://findic.cl) | Respaldo | findic.cl/api/, timeout 8s |
| [SII RSS](https://zeus.sii.cl) | Respaldo | zeus.sii.cl/admin/rss/sii_ind_rss.xml, timeout 8s |
| [DolarAPI](https://cl.dolarapi.com) | Respaldo | cl.dolarapi.com/v1/cotizaciones, timeout 8s |
| [Caché stale](https://github.com/Alplox/QueOnda/blob/main/src/lib/cache.ts) | Final (caché) | → 502 si todo falla |

### Radios (/api/radio-stations)

*Fallback secuencial*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [radio-browser.info](https://api.radio-browser.info) | Primario | de1.api.radio-browser.info, timeout 15s |
| [json-teles](https://github.com/Alplox/json-teles) | Respaldo | raw.githubusercontent.com/Alplox/json-teles/main/countries/cl.json, filtro category=music |
| [FALLBACK_RADIOS](https://github.com/Alplox/QueOnda/blob/main/src/lib/radios.ts) | Final (caché) | hardcoded: Cooperativa, Duna, ADN |
| [cd_dvd_PNG9081](https://pngimg.com/image/9081) | Único | PNGImg CC BY-NC 4.0; elegidos al azar por estación en BoomboxDisplay |
| [cd_dvd_PNG9079](https://pngimg.com/image/9079) | Único | PNGImg CC BY-NC 4.0; elegidos al azar por estación en BoomboxDisplay |
| [cd_dvd_PNG9075](https://pngimg.com/image/9075) | Único | PNGImg CC BY-NC 4.0; elegidos al azar por estación en BoomboxDisplay |
| [cd_dvd_PNG9080](https://pngimg.com/image/9080) | Único | PNGImg CC BY-NC 4.0; elegidos al azar por estación en BoomboxDisplay |
| [cd_dvd_PNG9065](https://pngimg.com/image/9065) | Único | PNGImg CC BY-NC 4.0; elegidos al azar por estación en BoomboxDisplay |

### Calidad del aire (/api/air-quality)

*Fallback secuencial (Boostr y Gael Cloud no exponen calidad del aire)*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [SINCA · MMA](https://sinca.mma.gob.cl) | Primario | sinca.mma.gob.cl/index.php/json/listadomapa2k19/, ~118 estaciones, timeout 12s |
| [Open-Meteo Air Quality](https://open-meteo.com) | Respaldo | air-quality-api.open-meteo.com, modelo CAMS, 18 ciudades, timeout 10s |
| [Caché stale](https://github.com/Alplox/QueOnda/blob/main/src/lib/cache.ts) | Final (caché) | CDN edge 30 min stale-while-revalidate |

### Fútbol (/api/futbol)

*Paths paralelos*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [ESPN Deportes API](https://site.web.api.espn.com) | Primario | standings + scoreboard chi.1, timeout 8s; sin fallback → standings/matches vacíos |
| [Sports RSS](https://github.com/Alplox/awesome-chilean-rss) | Único | siempre se carga, independiente de ESPN |

### Transporte (/api/transport)

*Fuentes individuales*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [Metro.cl](https://www.metro.cl) | Único | scraping estado-red, timeout 8s, sin fallback |
| [RED (red.cl)](https://www.red.cl) | Único | predictorPlus, timeout 5s |
| [DTPM GTFS](https://www.dtpm.cl) | Único | base de paraderos por recorrido (build-time) |

### Feeds RSS

*Local-first*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [feeds-database.json (local)](https://github.com/Alplox/QueOnda/blob/main/src/lib/feeds-database.json) | Primario | build-time, instantáneo, siempre disponible |
| [GitHub raw](https://raw.githubusercontent.com/alplox/awesome-chilean-rss) | Respaldo | fire-and-forget, timeout 15s |
| [jsDelivr CDN](https://cdn.jsdelivr.net) | Respaldo | fire-and-forget, timeout 15s |

### Cortes de luz (/api/power)

*Única fuente + snapshot durable*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [SEC (apps.sec.cl)](https://www.sec.cl) | Único | POST ClientesAfectados/{Get,GetClientesNacional,GetPorFecha,GetClientesRegional}; sin alternativa pública |
| [power:lastgood](https://github.com/Alplox/QueOnda/blob/main/src/lib/cache.ts) | Final (caché) | snapshot durable 6h vía setLastGood; si la SEC cae sirve este con stale:true |

### TV, YouTube, Trends, Spotify, Jobs, Holidays

*Única fuente (sin fallback)*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [json-teles](https://github.com/Alplox/json-teles) | Único | canales de TV chilenos |
| [iptv-org](https://github.com/iptv-org/iptv) | Único | canales CL (m3u) |
| [mi-iptv](https://github.com/fparrav/mi-iptv) | Único | playlist m3u (fallback jsDelivr) |
| [YouTube RSS](https://www.youtube.com) | Único | feeds/videos.xml por channel_id |
| [Google Trends RSS](https://trends.google.com) | Único | trending/rss?geo=CL |
| [Spotify Embed](https://open.spotify.com) | Único | Top 50 Chile (iframe) |
| [Nager.Date](https://date.nager.at) | Único | feriados de Chile (con fallback JSON bundled) |
| [Jobs (Getonbrd, Workanywhere, Remotive)](https://github.com/Alplox/QueOnda/tree/main/src/lib/jobs/sources) | Único |  |

### Mapas y basemaps

*Única fuente*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [OpenFreeMap](https://openfreemap.org) | Único | tiles.openfreemap.org/styles/{positron,dark}, sin API key |
| [MapLibre GL](https://maplibre.org) | Único | render del basemap |

### Otras fuentes (única, sin cadena de respaldo)

*Fuente única*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [Article proxy (cheerio)](https://cheerio.js.org) | Único | scraping del URL enviado por el cliente; validación SSRF + sanitización HTML |
| [RED routes DB](https://www.dtpm.cl) | Único | DTPM GTFS, build-time vía update-stops-db.mjs |
| [Weather widget geolocation](https://open-meteo.com) | Único | Open-Meteo Geocoding (reverse + search) |
| [Weather widget forecast](https://www.meteochile.gob.cl) | Único | DMC pronostico.js, 5 días para ~60 ciudades |
| [Map basemaps](https://openfreemap.org) | Único | OpenFreeMap + MapLibre GL, sin API key |

### Imágenes y assets

*Recursos estáticos*

| Fuente | Rol en la cadena | Detalle / Enlace |
| ------ | ---------------- | ---------------- |
| [Foto de portada del footer](https://unsplash.com/es/fotos/manada-de-caballos-en-arbustos-y-pastos-a-traves-de-la-montana-Zf2mL1gtaVg) | Único | modernwolo en Unsplash — Licencia Unsplash |
| [Thiago Matos](https://www.pexels.com/es-es/foto/impresionante-paisaje-urbano-de-santiago-con-la-cordillera-de-los-andes-30342880/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Luis G](https://www.pexels.com/es-es/foto/ciudad-paisaje-montanas-panorama-urbano-17461141/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Santi Echaire](https://www.pexels.com/es-es/foto/vista-panoramica-de-santiago-frente-a-la-cordillera-de-los-andes-33606801/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Santi Echaire](https://www.pexels.com/es-es/foto/paisaje-urbano-con-la-cordillera-de-los-andes-nevada-al-fondo-33610547/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Santi Echaire](https://www.pexels.com/es-es/foto/majestuoso-volcan-nevado-con-vistas-a-un-pintoresco-lago-37228063/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Cláudio Castro](https://www.pexels.com/es-es/foto/bandera-chilena-sobre-cielo-azul-simbolo-de-orgullo-nacional-36585246/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Willian Justen de Vasconcellos](https://www.pexels.com/es-es/foto/ciudad-punto-de-referencia-edificio-rascacielos-19821196/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Michel Jose](https://www.pexels.com/es-es/foto/naturaleza-cielo-punto-de-referencia-arquitectura-27873926/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Michel Jose](https://www.pexels.com/es-es/foto/27873929/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Eduardo Rivas](https://www.pexels.com/es-es/foto/mar-agua-oceano-barca-4665517/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Matheus Pedrosa](https://www.pexels.com/es-es/foto/ciudad-panorama-urbano-skyline-viaje-27115881/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Cláudio Castro](https://www.pexels.com/es-es/foto/torre-del-reloj-y-rascacielos-modernos-en-santiago-36585242/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Athenea Codjambassis Rossitto](https://www.pexels.com/es-es/foto/nieve-nevar-paisaje-naturaleza-25525995/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Fermin Rodriguez Penelas](https://www.pexels.com/es-es/foto/naturaleza-animal-prado-en-pie-13198296/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Vivi Pascar](https://www.pexels.com/es-es/foto/vista-panoramica-del-volcan-licancabur-en-el-desierto-de-atacama-28602851/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Saif](https://www.pexels.com/es-es/foto/paisaje-arena-nubes-desierto-20853000/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [William Warby](https://www.pexels.com/es-es/foto/paisaje-naturaleza-bosque-colina-21533327/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Belen Capello](https://www.pexels.com/es-es/foto/cielo-azul-al-aire-libre-escenico-pintoresco-7543964/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Chris Flxxx](https://www.pexels.com/es-es/foto/majestuoso-paisaje-montanoso-en-torres-del-paine-31822186/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Xiang Qi](https://www.pexels.com/es-es/foto/35957531/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Alex Quezada](https://www.pexels.com/es-es/foto/34639207/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Getty Images](https://unsplash.com/es/fotos/a-puerto-natales-chile-sur-chile-maravilla-del-mundo-torres-del-paine-AQOBZfOLPXQ) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |
| [Kimberly Alves](https://www.pexels.com/es-es/foto/36721823/) | Único | rotación diaria por día del año (getTodayBg); Pexels + Unsplash, licencia gratuita |

<!-- data-sources:end -->

> Para detalle completo (timeouts, criterios de corte), ver [`AGENTS.md`](./AGENTS.md#data-sources--fallback-chains).

## Licencia

[`AGPL-3.0 license`](./LICENSE). 

Atribución y textos de licencia de dependencias de terceros en [`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md).
