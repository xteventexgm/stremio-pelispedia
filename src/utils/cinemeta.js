const cache = require('./cache');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json'
};

/**
 * Resuelve metadatos (nombre, año, temporada, episodio) desde Cinemeta (API oficial de Stremio)
 * @param {string} type - 'movie' o 'series'
 * @param {string} id - IMDb ID (ej: 'tt1375666' o 'tt0903747:1:1')
 */
async function getMetadata(type, id) {
  // Limpiar posibles sufijos como .json
  const cleanId = id.replace(/\.json$/, '');
  const parts = cleanId.split(':');
  const imdbId = parts[0];
  const season = parts[1] ? parseInt(parts[1], 10) : null;
  const episode = parts[2] ? parseInt(parts[2], 10) : null;

  const cacheKey = `cinemeta:${type}:${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return { ...cached, season, episode };
  }

  try {
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
    const res = await fetch(url, { headers: HEADERS, timeout: 8000 });
    if (!res.ok) {
      console.warn(`[Cinemeta] Falló al obtener metadatos de ${url} (Status: ${res.status})`);
      return null;
    }

    const data = await res.json();
    if (!data || !data.meta) {
      return null;
    }

    const meta = {
      imdbId,
      title: data.meta.name,
      year: parseInt(data.meta.year, 10) || null,
      type
    };

    // Guardar en caché 1 hora
    cache.set(cacheKey, meta, 60 * 60 * 1000);

    return { ...meta, season, episode };
  } catch (err) {
    console.error(`[Cinemeta] Error al consultar metadatos:`, err.message);
    return null;
  }
}

module.exports = { getMetadata };

