const crypto = require('crypto');
const https = require('https');
const dns = require('dns').promises;
const cache = require('../utils/cache');

// Servidores DNS públicos fiables
dns.setServers(['1.1.1.1', '8.8.8.8']);

const BASE_URL = 'https://pelispedia.mov';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

const LANG_MAP = {
  'LAT': 'Español Latino',
  'ESP': 'Castellano',
  'SUB': 'Subtitulado',
  'ENG': 'Inglés'
};

const VIDHIDE_MIRRORS = [
  'callistanise.com',
  'vidhideplus.com',
  'vidhidepre.com'
];

/**
 * Petición HTTPS con DNS forzado a Cloudflare/Google (bypassea filtros de ISP)
 */
function fetchCustomDns(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      lookup: async (hostname, opts, callback) => {
        const cb = typeof opts === 'function' ? opts : callback;
        const o = typeof opts === 'object' ? opts : {};
        try {
          const ips = await dns.resolve4(hostname);
          if (o.all) {
            cb(null, [{ address: ips[0], family: 4 }]);
          } else {
            cb(null, ips[0], 4);
          }
        } catch (err) {
          // En entornos cloud como Render donde UDP:53 puede estar restringido, usar DNS nativo
          require('dns').lookup(hostname, opts, callback);
        }
      },
      headers: { ...HEADERS, ...(options.headers || {}) },
      timeout: options.timeout || 8000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: data,
        ok: res.statusCode >= 200 && res.statusCode < 300
      }));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de conexión'));
    });
  });
}

/**
 * Resuelve el Proof of Work (PoW) exigido por el reproductor Embed69 (~15ms)
 */
function solvePoW(challenge, difficulty, salt) {
  const prefix = '0'.repeat(difficulty);
  let nonce = 0;
  while (true) {
    const hash = crypto.createHash('sha256').update(challenge + nonce).digest('hex');
    if (hash.startsWith(prefix)) {
      const keyHash = crypto.createHash('sha256').update(challenge + nonce + salt).digest();
      return { nonce, aesKey: keyHash };
    }
    nonce++;
  }
}

/**
 * Descifra enlaces cifrados con AES-256-CBC
 */
function decryptAES(encryptedBase64, aesKey) {
  try {
    const raw = Buffer.from(encryptedBase64, 'base64');
    const iv = raw.subarray(0, 16);
    const ciphertext = raw.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey.subarray(0, 32), iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
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
 * Extrae el enlace HLS (.m3u8) directo desde Vidhide probando mirrors ultra-rápidos
 */
async function extractVidhideM3U8(embedUrl, hostUrl = '') {
  const codeMatch = embedUrl.match(/\/(?:embed|v|d)\/([a-zA-Z0-9]+)/);
  if (!codeMatch) return null;
  const code = codeMatch[1];

  for (const mirror of VIDHIDE_MIRRORS) {
    try {
      const mirrorUrl = `https://${mirror}/embed/${code}`;
      const res = await fetch(mirrorUrl, {
        headers: {
          'User-Agent': HEADERS['User-Agent'],
          'Referer': BASE_URL + '/'
        },
        signal: AbortSignal.timeout(4000)
      });
      if (!res.ok) continue;

      const html = await res.text();
      const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)\)\)/);
      if (!packedMatch) continue;

      const unpacked = unpackDeanEdwards(packedMatch[0]);
      if (!unpacked) continue;

      const linksMatch = unpacked.match(/var links\s*=\s*(\{[\s\S]*?\});/);
      if (linksMatch) {
        try {
          const links = JSON.parse(linksMatch[1]);

          // 1. Preferir hls4 a través de nuestro proxy limpiador (CDN TikTok de alta velocidad, sin buffering)
          if (links.hls4 && hostUrl) {
            const rawHls4 = links.hls4.startsWith('http') ? links.hls4 : `https://${mirror}${links.hls4}`;
            console.log(`[PelisPedia Vidhide] Usando HLS4 (CDN ultra-rápido) a través del proxy limpiador`);
            return `${hostUrl}/hls/master.m3u8?url=${encodeURIComponent(rawHls4)}`;
          }

          // 2. Si hls4 no está disponible, usar hls2 limpio directo
          if (links.hls2) {
            try {
              const testRes = await fetch(links.hls2, {
                method: 'HEAD',
                signal: AbortSignal.timeout(1500)
              });
              if (testRes.ok) {
                console.log(`[PelisPedia Vidhide] Usando HLS2 limpio directo`);
                return links.hls2;
              }
            } catch {}
          }

          if (links.hls4) {
            return links.hls4.startsWith('http') ? links.hls4 : `https://${mirror}${links.hls4}`;
          }
          if (links.hls) return links.hls;
        } catch {}
      }

      const m3u8Match = unpacked.match(/https?:\/\/[^\s"'`]+\.m3u8[^\s"'`]*/);
      if (m3u8Match) return m3u8Match[0];
    } catch (err) {
      // Probar siguiente mirror
      continue;
    }
  }

  return null;
}

/**
 * Busca una serie por título y obtiene la URL real del reproductor vidurl si el IMDb ID no coincide
 */
async function resolveSeriesVidUrlFallback(title, season, episode) {
  try {
    const cleanTitle = title.replace(/[^\w\s]/gi, '').trim();
    const searchUrl = `${BASE_URL}/search?s=${encodeURIComponent(cleanTitle)}`;
    const searchRes = await fetchCustomDns(searchUrl);
    if (!searchRes.ok) return null;

    const matchSerie = searchRes.body.match(/href="(https:\/\/pelispedia\.mov\/serie\/[^"]+)"/);
    if (!matchSerie) return null;

    const serieUrl = matchSerie[1];
    const epUrl = `${serieUrl}/temporada/${season}/capitulo/${episode}`;
    const epRes = await fetchCustomDns(epUrl);
    if (!epRes.ok) return null;

    const vidMatch = epRes.body.match(/src="(\/vidurl\/[^"]+|https?:\/\/[^"]*(?:embed69\.org|vidurl)[^"]*)"/);
    if (vidMatch) {
      let rawUrl = vidMatch[1];
      if (rawUrl.startsWith('/')) rawUrl = `${BASE_URL}${rawUrl}`;
      return rawUrl;
    }
    return null;
  } catch (err) {
    console.warn(`[PelisPedia] Error en fallback de serie:`, err.message);
    return null;
  }
}

/**
 * Proveedor principal de PelisPedia
 */
async function getStreams({ type, imdbId, title, year, season, episode }, hostUrl = '') {
  const cacheKey = `streams:pelispedia:${type}:${imdbId}:${season || 0}:${episode || 0}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[PelisPedia] Obtenido de caché: ${title} (${year})`);
    return cached;
  }

  console.log(`[PelisPedia] Buscando: "${title}" (${year}) - Tipo: ${type}`);

  try {
    let vidUrl = `${BASE_URL}/vidurl/${imdbId}/`;
    if (type === 'series') {
      const epStr = String(episode).padStart(2, '0');
      vidUrl = `${BASE_URL}/vidurl/${imdbId}-${season}x${epStr}/`;
    }

    console.log(`[PelisPedia] Consultando: ${vidUrl}`);
    const res = await fetchCustomDns(vidUrl);
    if (!res.ok) {
      console.warn(`[PelisPedia] Error ${res.status} al consultar vidurl`);
      return [];
    }

    let html = res.body;

    let challengeMatch = html.match(/const POW_CHALLENGE = '([^']+)';/);
    let diffMatch = html.match(/const POW_DIFFICULTY = (\d+);/);
    let saltMatch = html.match(/const POW_SALT = '([^']+)';/);

    // Si no se encuentra el reproductor y es serie, intentar resolución por búsqueda y capítulo
    if ((!challengeMatch || !diffMatch || !saltMatch) && type === 'series') {
      console.log(`[PelisPedia] ID directo sin resultados, intentando búsqueda de "${title}" S${season}E${episode}...`);
      const fallbackUrl = await resolveSeriesVidUrlFallback(title, season, episode);
      if (fallbackUrl) {
        console.log(`[PelisPedia] Fallback encontrado: ${fallbackUrl}`);
        const fallbackRes = await fetchCustomDns(fallbackUrl);
        if (fallbackRes.ok) {
          html = fallbackRes.body;
          challengeMatch = html.match(/const POW_CHALLENGE = '([^']+)';/);
          diffMatch = html.match(/const POW_DIFFICULTY = (\d+);/);
          saltMatch = html.match(/const POW_SALT = '([^']+)';/);

          // Si es un reproductor embed69 directo sin PoW (ej. Victorious)
          if (!challengeMatch && html.includes('playServerVast')) {
            console.log(`[PelisPedia] Reproductor embed69 directo detectado sin PoW`);
            const serverMatches = [...html.matchAll(/playServerVast\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
            const vidhideUrl = serverMatches.find(u => u.includes('vidhide') || u.includes('streamhide') || u.includes('morencius') || u.includes('callistanise'));
            if (vidhideUrl) {
              console.log(`[PelisPedia] Enlace Vidhide extraído de embed69: ${vidhideUrl}`);
              const m3u8 = await extractVidhideM3U8(vidhideUrl, hostUrl);
              if (m3u8) {
                const streams = [{
                  name: 'PelisPedia',
                  title: `[PelisPedia] Español Latino\nVidhide • ⚡ HLS CDN Directo`,
                  url: m3u8,
                  behaviorHints: { notWebReady: false }
                }];
                cache.set(cacheKey, streams, 15 * 60 * 1000);
                return streams;
              }
            }
          }
        }
      }
    }

    if (!challengeMatch || !diffMatch || !saltMatch) {
      console.warn(`[PelisPedia] No se encontraron parámetros PoW`);
      return [];
    }

    const { aesKey } = solvePoW(challengeMatch[1], parseInt(diffMatch[1], 10), saltMatch[1]);

    const dataLinkMatch = html.match(/dataLink\s*=\s*(\[[\s\S]*?\]);/);
    if (!dataLinkMatch) {
      console.warn(`[PelisPedia] No se encontró el objeto dataLink`);
      return [];
    }

    const dataLink = JSON.parse(dataLinkMatch[1]);
    const streamPromises = [];

    for (const group of dataLink) {
      const langText = LANG_MAP[group.video_language] || group.video_language || 'Español';
      const embeds = group.sortedEmbeds || [];

      // Buscar Vidhide
      const vidhideEmbed = embeds.find(e => e.servername === 'vidhide');
      if (vidhideEmbed) {
        const vidhideUrl = decryptAES(vidhideEmbed.link, aesKey);
        if (vidhideUrl) {
          streamPromises.push(
            extractVidhideM3U8(vidhideUrl, hostUrl).then(m3u8 => {
              if (!m3u8) return null;
              return {
                name: 'PelisPedia',
                title: `[PelisPedia] ${langText}\nVidhide • ⚡ HLS CDN Directo`,
                url: m3u8,
                behaviorHints: {
                  notWebReady: false
                }
              };
            }).catch(() => null)
          );
        }
      }
    }

    const results = await Promise.allSettled(streamPromises);
    const streams = [];

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        streams.push(r.value);
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
