const manifest = {
  id: 'community.pelispedia.addon',
  version: '1.0.1',
  name: 'PelisPedia (Español)',
  description: 'Películas y series en Español Latino, Castellano y Subtitulado en streaming HLS directo de PelisPedia.',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb'],
  catalogs: [],
  background: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=1920&q=80',
  logo: 'https://pelispedia.mov/assets/img/logo.png',
  behaviorHints: {
    configurable: false
  }
};

module.exports = manifest;
