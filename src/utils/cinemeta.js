const cache = require('./cache');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

/**
 * Resuelve metadatos para IDs provenientes de TMDB (ej: tmdb:1058424 o tmdb:1396:1:1)
 */
async function getTmdbMetadata(type, cleanId) {
  const parts = cleanId.split(':');
  // parts[0] = 'tmdb'
  // parts[1] = tmdbId (ej: '1058424')
  // parts[2] = season (opcional para series)
  // parts[3] = episode (opcional para series)
  const tmdbId = parts[1];
  const tmdbFullId = `tmdb:${tmdbId}`;
  const season = parts[2] ? parseInt(parts[2], 10) : null;
  const episode = parts[3] ? parseInt(parts[3], 10) : null;

  const cacheKey = `tmdb:${type}:${tmdbFullId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, season, episode };
  }

  try {
    const url = `https://tmdb-stable.creepso.com/es-MX/meta/${type}/${tmdbFullId}.json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[TMDB Meta] Falló al obtener metadatos de ${url} (Status: ${res.status})`);
      return null;
    }

    const data = await res.json();
    if (!data || !data.meta || !data.meta.name) {
      return null;
    }

    const imdbId = data.meta.imdb_id || null;
    let year = null;
    if (data.meta.year) {
      year = parseInt(data.meta.year, 10) || null;
    } else if (data.meta.releaseInfo) {
      year = parseInt(data.meta.releaseInfo, 10) || null;
    }

    const meta = {
      imdbId,
      tmdbId: tmdbFullId,
      title: data.meta.name,
      year,
      type
    };

    console.log(`[TMDB Meta] Resuelto ${cleanId} -> IMDb: ${imdbId || 'N/A'}, Título: "${meta.title}" (${year})`);

    // Guardar en caché 2 horas
    cache.set(cacheKey, meta, 2 * 60 * 60 * 1000);

    return { ...meta, season, episode };
  } catch (err) {
    console.error(`[TMDB Meta] Error al consultar metadatos para ${cleanId}:`, err.message);
    return null;
  }
}

/**
 * Resuelve metadatos (nombre, año, temporada, episodio) desde Cinemeta (API oficial de Stremio) o TMDB
 * @param {string} type - 'movie' o 'series'
 * @param {string} id - IMDb ID (ej: 'tt1375666' o 'tt0903747:1:1') o TMDB ID (ej: 'tmdb:1058424')
 */
async function getMetadata(type, id) {
  // Limpiar posibles sufijos como .json
  const cleanId = id.replace(/\.json$/, '');

  // Soporte directo para IDs de TMDB
  if (cleanId.startsWith('tmdb:')) {
    return getTmdbMetadata(type, cleanId);
  }

  const parts = cleanId.split(':');
  const imdbId = parts[0];
  const season = parts[1] ? parseInt(parts[1], 10) : null;
  const episode = parts[2] ? parseInt(parts[2], 10) : null;

  const cacheKey = `cinemeta:${type}:${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, season, episode };
  }

  // 1. Intentar con Cinemeta (API oficial de Stremio)
  try {
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      if (data && data.meta) {
        const meta = {
          imdbId,
          title: data.meta.name,
          year: parseInt(data.meta.year, 10) || null,
          type
        };

        // Guardar en caché 1 hora
        cache.set(cacheKey, meta, 60 * 60 * 1000);
        return { ...meta, season, episode };
      }
    } else {
      console.warn(`[Cinemeta] Falló consulta (${res.status}), intentando fallback TMDB...`);
    }
  } catch (err) {
    console.warn(`[Cinemeta] Error al consultar metadatos (${err.message}), intentando fallback TMDB...`);
  }

  // 2. Fallback con TMDB (por si Cinemeta no tiene el título o está caído)
  try {
    const tmdbUrl = `https://tmdb-stable.creepso.com/es-MX/meta/${type}/${imdbId}.json`;
    const res = await fetch(tmdbUrl, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      if (data && data.meta && data.meta.name) {
        let year = null;
        if (data.meta.year) {
          year = parseInt(data.meta.year, 10) || null;
        } else if (data.meta.releaseInfo) {
          year = parseInt(data.meta.releaseInfo, 10) || null;
        }

        const meta = {
          imdbId: data.meta.imdb_id || imdbId,
          title: data.meta.name,
          year,
          type
        };

        console.log(`[TMDB Fallback] Metadatos resueltos para ${imdbId}: "${meta.title}" (${year})`);
        cache.set(cacheKey, meta, 60 * 60 * 1000);
        return { ...meta, season, episode };
      }
    }
  } catch (err) {
    console.error(`[TMDB Fallback] Error al consultar metadatos para ${imdbId}:`, err.message);
  }

  return null;
}

module.exports = { getMetadata };

