const cache = require('../utils/cache');

const BASE_URL = 'https://pelispedia.is';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

/**
 * Realiza peticiones HTTP usando el Worker de Cloudflare si está disponible (evita bloqueos de IP y CORS)
 */
async function fetchHttp(url, options = {}) {
  const workerUrl = process.env.CLOUDFLARE_WORKER_URL;
  const targetUrl = workerUrl 
    ? `${workerUrl.replace(/\/$/, '')}/?url=${encodeURIComponent(url)}`
    : url;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(targetUrl, {
        method: options.method || 'GET',
        headers: {
          ...HEADERS,
          ...(options.headers || {})
        },
        body: options.body,
        signal: AbortSignal.timeout(options.timeout || 10000)
      });
      const text = await res.text();
      return {
        status: res.status,
        ok: res.ok,
        body: text
      };
    } catch (err) {
      console.warn(`[PelisPedia Fetch Error - Intento ${attempt}]:`, err.message);
      if (attempt === 2) {
        return { status: 500, ok: false, body: '' };
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

/**
 * Desempaqueta JavaScript ofuscado con Dean Edwards Packer
 */
function unpackDeanEdwards(packed) {
  const match = packed.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\}\('([\s\S]*?)',(\d+),(\d+),'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) return null;

  let [, p, a, c, k] = match;
  a = parseInt(a, 10);
  c = parseInt(c, 10);
  const words = k.split('|');

  const baseUnpack = (val, radix) => {
    let res = '';
    while (val > 0) {
      res = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'[val % radix] + res;
      val = Math.floor(val / radix);
    }
    return res || '0';
  };

  const map = {};
  for (let i = 0; i < c; i++) {
    const key = i < a ? baseUnpack(i, a) : (i).toString(a);
    map[key] = words[i] || key;
  }

  return p.replace(/\b\w+\b/g, (w) => map[w] !== undefined ? map[w] : w);
}

/**
 * Extrae el enlace HLS (.m3u8) directo desde Fastream
 */
async function extractFastreamM3U8(embedUrl) {
  try {
    const res = await fetchHttp(embedUrl, {
      headers: { 'Referer': BASE_URL + '/' }
    });
    if (!res.ok) return null;

    const packedMatch = res.body.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
    if (!packedMatch) return null;

    const unpacked = unpackDeanEdwards(packedMatch[0]);
    if (!unpacked) return null;

    const m3u8Match = unpacked.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i);
    return m3u8Match ? m3u8Match[0] : null;
  } catch (err) {
    console.warn('[Fastream Extractor Error]:', err.message);
    return null;
  }
}

/**
 * Proveedor principal de PelisPedia (.is)
 */
async function getStreams({ type, imdbId, title, year, season, episode, spanishTitle }, hostUrl = '') {
  const cacheKey = `streams:pelispedia_is:${type}:${imdbId}:${season || 0}:${episode || 0}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[PelisPedia] Obtenido de caché: ${title} (${year})`);
    return cached;
  }

  console.log(`[PelisPedia] Buscando: "${title}" (${year}) - Tipo: ${type}`);

  try {
    // 1. Lista de consultas de búsqueda (Título principal y título en español si difieren)
    const searchQueries = [title];
    if (spanishTitle && spanishTitle.toLowerCase() !== title.toLowerCase()) {
      searchQueries.push(spanishTitle);
    }

    let matchedLink = null;
    let matchedPostId = null;
    const targetTypePath = type === 'series' ? '/serie/' : '/pelicula/';

    for (const q of searchQueries) {
      const cleanQ = q.replace(/[^\w\s]/gi, ' ').replace(/\s+/g, ' ').trim();
      const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(cleanQ)}`;
      console.log(`[PelisPedia] Buscando en: ${searchUrl}`);
      const searchRes = await fetchHttp(searchUrl);
      if (!searchRes.ok) continue;

      const articles = [...searchRes.body.matchAll(/<article[^>]*class="[^"]*movies[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)];
      console.log(`[PelisPedia] Artículos encontrados para "${cleanQ}": ${articles.length}`);

      for (const art of articles) {
        const linkMatch = art[1].match(/href="([^"]+)"/i);
        const titleMatch = art[1].match(/<h2 class="entry-title">([^<]+)<\/h2>/i) || art[1].match(/alt="([^"]+)"/i);
        const postMatch = art[0].match(/id="post-(\d+)"/i) || art[1].match(/post-(\d+)/i);

        if (linkMatch && linkMatch[1].includes(targetTypePath)) {
          matchedLink = linkMatch[1];
          matchedPostId = postMatch ? postMatch[1] : null;
          console.log(`[PelisPedia] Coincidencia encontrada: "${titleMatch ? titleMatch[1] : ''}" -> ${matchedLink}`);
          break;
        }
      }
      if (matchedLink) break;
    }

    if (!matchedLink) {
      console.warn(`[PelisPedia] No se encontró el contenido "${title}" en pelispedia.is`);
      return [];
    }

    // 2. Si es serie, resolver la URL del episodio
    let targetPageUrl = matchedLink;

    if (type === 'series') {
      console.log(`[PelisPedia] Resolviendo Temporada ${season}, Episodio ${episode}...`);
      const serieRes = await fetchHttp(matchedLink);
      if (!serieRes.ok) return [];

      const serieHtml = serieRes.body;
      const epRegex = new RegExp(`temporada-${season}-capitulo-${episode}/?$`, 'i');

      const epLinks = [...serieHtml.matchAll(/href="([^"]*capitulo[^"]*)"/gi)].map(m => m[1]);
      let epUrl = epLinks.find(l => epRegex.test(l));

      // Si no aparece directamente en la página (ej: temporadas posteriores), consultar vía AJAX
      if (!epUrl) {
        const postMatch = matchedPostId || (serieHtml.match(/data-post="(\d+)"/) || [])[1];
        if (postMatch) {
          console.log(`[PelisPedia] Consultando temporada ${season} via AJAX (post: ${postMatch})...`);
          const ajaxParams = new URLSearchParams();
          ajaxParams.append('action', 'action_select_season');
          ajaxParams.append('season', String(season));
          ajaxParams.append('post', postMatch);

          const ajaxRes = await fetchHttp(`${BASE_URL}/wp-admin/admin-ajax.php`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'Referer': matchedLink
            },
            body: ajaxParams.toString()
          });

          if (ajaxRes.ok) {
            const ajaxEpLinks = [...ajaxRes.body.matchAll(/href="([^"]*capitulo[^"]*)"/gi)].map(m => m[1]);
            epUrl = ajaxEpLinks.find(l => epRegex.test(l));
          }
        }
      }

      // Fallback: URL canónica por convención ToroFilm
      if (!epUrl) {
        const slugMatch = matchedLink.match(/\/serie\/([^/]+)\/?/);
        if (slugMatch) {
          epUrl = `${BASE_URL}/capitulo/${slugMatch[1]}-temporada-${season}-capitulo-${episode}/`;
          console.log(`[PelisPedia] Intentando URL canónica de episodio: ${epUrl}`);
        }
      }

      if (!epUrl) {
        console.warn(`[PelisPedia] No se pudo encontrar el episodio S${season}E${episode}`);
        return [];
      }

      targetPageUrl = epUrl;
    }

    // 3. Obtener página del reproductor
    console.log(`[PelisPedia] Consultando reproductor: ${targetPageUrl}`);
    const pageRes = await fetchHttp(targetPageUrl);
    if (!pageRes.ok) return [];

    const pageHtml = pageRes.body;

    // 4. Mapear idiomas de las pestañas de opciones
    const langMap = {};
    const optMatches = [...pageHtml.matchAll(/href="#options-(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    for (const opt of optMatches) {
      const optIdx = opt[1];
      const optText = opt[2];
      let lang = 'Español';
      if (/latino/i.test(optText)) lang = 'Español Latino';
      else if (/castellano/i.test(optText)) lang = 'Castellano';
      else if (/vose|sub/i.test(optText)) lang = 'Subtitulado';
      else if (/ingl[eé]s/i.test(optText)) lang = 'Inglés';
      langMap[optIdx] = lang;
    }

    // 5. Extraer enlaces de embebidos (trembed)
    const iframes = [...pageHtml.matchAll(/<iframe[^>]*src="([^"]*trembed[^"]*)"/gi)].map(m => m[1].replace(/&#038;/g, '&'));
    console.log(`[PelisPedia] Iframes trembed encontrados: ${iframes.length}`);

    const streams = [];

    for (const ifrUrl of iframes) {
      const trembedMatch = ifrUrl.match(/\?trembed=(\d+)/);
      const optIdx = trembedMatch ? trembedMatch[1] : '0';
      const lang = langMap[optIdx] || `Opción ${parseInt(optIdx, 10) + 1}`;

      console.log(`[PelisPedia] Procesando opción ${optIdx} (${lang})...`);
      const trembedRes = await fetchHttp(ifrUrl, { headers: { 'Referer': targetPageUrl } });
      if (!trembedRes.ok) continue;

      const innerIframeMatch = trembedRes.body.match(/<iframe[^>]*src="([^"]+)"/i);
      if (!innerIframeMatch) continue;

      const embedUrl = innerIframeMatch[1];
      console.log(`[PelisPedia] Reproductor encontrado: ${embedUrl}`);

      if (embedUrl.includes('fastream')) {
        const rawM3u8 = await extractFastreamM3U8(embedUrl);
        if (rawM3u8) {
          console.log(`[PelisPedia] Stream M3U8 extraído para ${lang}`);
          const streamUrl = hostUrl 
            ? `${hostUrl}/hls/master.m3u8?url=${encodeURIComponent(rawM3u8)}` 
            : rawM3u8;

          streams.push({
            name: 'PelisPedia',
            title: `[PelisPedia] ${lang}\nFastream • ⚡ HLS CDN Directo`,
            url: streamUrl,
            behaviorHints: {
              notWebReady: false
            }
          });
        }
      }
    }

    if (streams.length > 0) {
      cache.set(cacheKey, streams, 15 * 60 * 1000);
    }

    console.log(`[PelisPedia] Streams extraídos exitosamente: ${streams.length}`);
    return streams;
  } catch (err) {
    console.error(`[PelisPedia] Error general:`, err.message);
    return [];
  }
}

module.exports = {
  name: 'PelisPedia',
  getStreams
};
