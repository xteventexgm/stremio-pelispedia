const pelispedia = require('./pelispedia');
// const pelismaster = require('./pelismaster'); // Desactivado temporalmente para pruebas de rendimiento

// Lista de proveedores activos
const providers = [
  pelispedia
];

/**
 * Consulta los streams de los proveedores activos en paralelo
 */
async function getStreamsFromAll(meta, hostUrl = '') {
  const promises = providers.map(p => 
    p.getStreams(meta, hostUrl).catch(err => {
      console.error(`[Provider ${p.name}] Error no capturado:`, err.message);
      return [];
    })
  );

  const results = await Promise.allSettled(promises);
  const allStreams = [];

  for (const r of results) {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allStreams.push(...r.value);
    }
  }

  return allStreams;
}

module.exports = {
  providers,
  getStreamsFromAll,
  pelispedia
};
