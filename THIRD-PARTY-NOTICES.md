# Third-Party Notices

QueOnda se apoya en software de terceros y otros recursos. Este documento
lista las licencias y la atribución requerida por cada uno. Los textos
completos de licencia viven en `node_modules/<paquete>/LICENSE*`.

## Bibliotecas distribuidas al navegador (bundled)

Estas se incluyen en el bundle JS/CSS que el sitio entrega al cliente, por lo
que sus términos de redistribución aplican.

### Leaflet — BSD 2-Clause License

```
BSD 2-Clause License

Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

- **Uso**: mapas interactivos (PowerOutageMap, EmergencyMap), vía `import('leaflet')`.
- **Fuente**: https://github.com/Leaflet/Leaflet

### hls.js — Apache License 2.0

```
Copyright (c) 2017 Dailymotion (http://www.dailymotion.com)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

src/remux/mp4-generator.js and src/demux/exp-golomb.ts implementation in this project
are derived from the HLS library for video.js (https://github.com/videojs/videojs-contrib-hls)

That work is also covered by the Apache 2 License, following copyright:
Copyright (c) 2013-2015 Brightcove
```

- **Uso**: playback de streams m3u8 (TV y radio), vía `import('hls.js')`.
- **Fuente**: https://github.com/video-dev/hls.js

### React / React DOM — MIT License

```
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Chart.js — MIT License

Copyright (c) 2014-2024 Chart.js Contributors. Ver texto MIT completo en
`node_modules/chart.js/LICENSE.md`.

### DaisyUI — MIT License

Copyright (c) 2020 Pouya Saadeghi. Ver texto MIT completo en
`node_modules/daisyui/LICENSE`.

### hover-tilt — Mozilla Public License 2.0

Copyright (c) Simon Goellner. Distribuido sin modificaciones.
MPL-2.0: https://www.mozilla.org/en-US/MPL/2.0/

## Bibliotecas de servidor (no se envían al navegador)

Se ejecutan en el Worker de Cloudflare o en build-time:

| Paquete | Licencia | Copyright |
| --- | --- | --- |
| `@mozilla/readability` | Apache-2.0 | Copyright (c) 2010 Arc90 Inc |
| `cheerio` | MIT | Cheerio contributors |
| `linkedom` | ISC | WebReflection |
| `fast-xml-parser` | MIT | Amit Gupta |
| `astro` / `@astrojs/*` | MIT | Astro contributors |
| `tailwindcss` / `@tailwindcss/vite` | MIT | Tailwind Labs |

## Otros recursos (no npm)

### Google Fonts — SIL Open Font License 1.1

- **Figtree** — https://github.com/erikdkennedy/figtree
- **DM Serif Display** — https://fonts.google.com/specimen/DM+Serif+Display

Servidas desde Google Fonts CDN (no redistribuidas). OFL-1.1:
https://openfontlicense.org/

### Imágenes de CD de radio — PNGImg (CC BY-NC 4.0)

- `public/cd-disc-1.webp` – `cd-disc-5.webp`, PNGImg (CC BY-NC 4.0):
  - [cd_dvd_PNG9081](https://pngimg.com/image/9081)
  - [cd_dvd_PNG9079](https://pngimg.com/image/9079)
  - [cd_dvd_PNG9075](https://pngimg.com/image/9075)
  - [cd_dvd_PNG9080](https://pngimg.com/image/9080)
  - [cd_dvd_PNG9065](https://pngimg.com/image/9065)

### Teselas de mapa — OpenStreetMap & CARTO

Los mapas Leaflet usan teselas de CARTO con atribución a OSM y CARTO
(visible en el control de atribución de cada mapa):
`&copy; OpenStreetMap contributors &copy; CARTO`.

### Datos generados

- `src/lib/feeds-database.json` — [awesome-chilean-rss](https://github.com/Alplox/awesome-chilean-rss)
- `src/lib/stops-database.json` — DTPM GTFS ([dtpm.cl](https://www.dtpm.cl))
- `src/lib/holidays.json` — [Nager.Date](https://date.nager.at)

---

> Los textos de licencia completos de cada paquete se distribuyen dentro del
> propio `node_modules/` y son reproducibles con `npm` / `npm ci`.
