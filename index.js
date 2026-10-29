require('dotenv').config();
const app = require('./src/server');

const PORT = process.env.PORT || 7000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🎬 PelisPedia Stremio Addon activo en puerto ${PORT}`);
  console.log(`🌐 Manifiesto local: http://localhost:${PORT}/manifest.json`);
  console.log(`➕ Instalar en Stremio: stremio://localhost:${PORT}/manifest.json`);
  console.log(`🩺 Health check: http://localhost:${PORT}/health`);
  console.log(`====================================================`);
});

