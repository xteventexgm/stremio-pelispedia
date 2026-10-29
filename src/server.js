const express = require('express');
const cors = require('cors');
const manifest = require('./manifest');
const { getMetadata } = require('./utils/cinemeta');
const { getStreamsFromAll, pelismaster } = require('./providers');

const app = express();

// Confiar en proxies inversos (necesario en Render, Railway, etc. para HTTPS)
app.enable('trust proxy');

// Habilitar CORS para todas las peticiones
app.use(cors());

// Servir el manifiesto
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(manifest);
});

// Soporte de ruta individual /pelismaster/manifest.json
app.get('/pelismaster/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(manifest);
});

// Endpoint de streams: /stream/:type/:id.json
app.get('/stream/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const cleanId = id.replace(/\.json$/, '');

  console.log(`[Stream Request] Type: ${type}, ID: ${cleanId}`);

  try {
    // 1. Obtener metadatos desde Cinemeta (nombre, año, temporada, episodio)
    const meta = await getMetadata(type, cleanId);
    if (!meta) {
      console.warn(`[Stream Request] No se pudieron obtener metadatos para ${cleanId}`);
      return res.json({ streams: [] });
    }

    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const hostUrl = `${protocol}://${host}`;

    // 2. Obtener streams de los proveedores activos
    const streams = await getStreamsFromAll(meta, hostUrl);
    console.log(`[Stream Response] Enviando ${streams.length} streams para "${meta.title}"`);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ streams });
  } catch (err) {
    console.error(`[Stream Error]`, err);
    return res.json({ streams: [] });
  }
});

// Endpoint inteligente AUTO: verifica servidores en tiempo real y salta al mejor funcional
app.get('/play', async (req, res) => {
  const { type, id, lang, season, episode } = req.query;
  if (!type || !id) {
    return res.status(400).send('Faltan parámetros requeridos (type, id)');
  }

  try {
    const meta = await getMetadata(type, id);
    if (!meta) {
      return res.status(404).send('No se encontraron metadatos');
    }

    if (!pelismaster || !pelismaster.getWorkingStream) {
      return res.status(503).send('PelisMaster se encuentra desactivado temporalmente');
    }

    const workingUrl = await pelismaster.getWorkingStream({
      type,
      imdbId: meta.imdbId,
      title: meta.title,
      year: meta.year,
      season: season ? parseInt(season, 10) : meta.season,
      episode: episode ? parseInt(episode, 10) : meta.episode,
      targetLang: lang || 'LAT'
    });

    if (!workingUrl) {
      return res.status(404).send('No se encontró ningún servidor funcional para este título');
    }

    // Redirigir al reproductor de Stremio hacia el stream verificado
    return res.redirect(302, workingUrl);
  } catch (err) {
    console.error(`[Play Error]`, err);
    return res.status(500).send('Error interno');
  }
});

// Endpoint de diagnóstico detallado
app.get('/debug/pelispedia', async (req, res) => {
  const id = req.query.id || 'tt10872600';
  const url = `https://pelispedia.mov/vidurl/${id}/`;
  try {
    const fetchCustomDns = require('./providers/pelispedia')._fetchCustomDns;
    // Test basic fetch vs fetchCustomDns
    let basicRes = null;
    let embed69Res = null;
    try {
      const b = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', 'Referer': 'https://pelispedia.mov/' } });
      basicRes = { status: b.status, body: (await b.text()).slice(0, 500) };
    } catch (e) {
      basicRes = { error: e.message };
    }

    try {
      const e69 = await fetch(`https://embed69.org/video/${id}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0', 'Referer': 'https://pelispedia.mov/' } });
      embed69Res = { status: e69.status, body: (await e69.text()).slice(0, 500) };
    } catch (e) {
      embed69Res = { error: e.message };
    }

    const testSites = {
      'embed69': `https://embed69.org/video/${id}/`,
      'pelisplus': `https://pelisplushd.la/search?s=spider-man`,
      'cuevana3': `https://cuevana3.gs/`,
      'lamovie': `https://lamovie.org/`,
      'gnula': `https://ver.gnula.one/`
    };

    const siteResults = {};
    for (const [name, sUrl] of Object.entries(testSites)) {
      try {
        const r = await fetch(sUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' },
          signal: AbortSignal.timeout(4000)
        });
        siteResults[name] = { status: r.status, ok: r.ok };
      } catch (e) {
        siteResults[name] = { error: e.message };
      }
    }

    res.json({
      targetUrl: url,
      fetchResult: basicRes,
      embed69Result: embed69Res,
      siteResults
    });
  } catch (err) {
    res.json({ error: err.message, stack: err.stack });
  }
});

// Endpoint de diagnóstico para verificar conexión de Render con proveedores
app.get('/debug/test', async (req, res) => {
  const id = req.query.id || 'tt10872600';
  const type = req.query.type || 'movie';
  const logs = [];
  const log = (msg) => logs.push(`[${new Date().toISOString()}] ${msg}`);

  try {
    log(`1. Consultando Cinemeta para ${type}/${id}...`);
    const meta = await getMetadata(type, id);
    log(`Cinemeta meta: ${JSON.stringify(meta)}`);

    if (!meta) {
      return res.json({ error: 'Cinemeta falló', logs });
    }

    const host = req.get('host');
    const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const hostUrl = `${protocol}://${host}`;

    log(`2. Consultando PelisPedia (${hostUrl})...`);
    const streams = await getStreamsFromAll(meta, hostUrl);
    log(`Streams obtenidos: ${streams.length}`);

    res.json({ logs, streams });
  } catch (err) {
    log(`ERROR: ${err.message}\n${err.stack}`);
    res.json({ logs, error: err.message });
  }
});

// Health check para UptimeRobot / Render (evita que se duerma en el plan gratuito)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// --- PROXY HLS INTELIGENTE (Repara segmentos ofuscados de TikTok CDN/Vidhide) ---
app.get('/hls/master.m3u8', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Falta parámetro url');

  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const host = `${protocol}://${req.get('host')}`;
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!upstream.ok) return res.status(upstream.status).send('Error upstream');

    const text = await upstream.text();
    const lines = text.split('\n');
    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const fullUrl = new URL(trimmed, url).href;
      return `${host}/hls/sub.m3u8?url=${encodeURIComponent(fullUrl)}`;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewritten);
  } catch (err) {
    console.error('[HLS Master Proxy Error]:', err.message);
    res.status(500).send('Error procesando master HLS');
  }
});

app.get('/hls/sub.m3u8', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Falta parámetro url');

  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const host = `${protocol}://${req.get('host')}`;
  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!upstream.ok) return res.status(upstream.status).send('Error upstream');

    const text = await upstream.text();
    const lines = text.split('\n');
    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const fullUrl = new URL(trimmed, url).href;
      return `${host}/hls/seg.ts?url=${encodeURIComponent(fullUrl)}`;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(rewritten);
  } catch (err) {
    console.error('[HLS Sub Proxy Error]:', err.message);
    res.status(500).send('Error procesando sub HLS');
  }
});

app.get('/hls/seg.ts', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('Falta parámetro url');

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!upstream.ok) return res.status(upstream.status).send('Error upstream segment');

    const arrayBuf = await upstream.arrayBuffer();
    let buf = Buffer.from(arrayBuf);

    // Si tiene la firma PNG falsa (\x89PNG), recortar los 70 bytes de cabecera
    if (buf.length > 70 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      buf = buf.subarray(70);
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  } catch (err) {
    console.error('[HLS Segment Proxy Error]:', err.message);
    res.status(500).send('Error procesando segmento');
  }
});

// Página de inicio interactiva para instalar fácilmente el addon
app.get('/', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const manifestUrl = `${protocol}://${host}/manifest.json`;
  const stremioInstallUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');

  res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${manifest.name} - Stremio Addon</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0f1015;
      color: #e4e7eb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #181920;
      border: 1px solid #282a36;
      border-radius: 16px;
      max-width: 520px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      text-align: center;
    }
    .logo {
      width: 80px;
      height: 80px;
      border-radius: 16px;
      margin-bottom: 20px;
      box-shadow: 0 4px 14px rgba(225, 29, 72, 0.4);
    }
    h1 {
      font-size: 26px;
      color: #fff;
      margin-bottom: 8px;
    }
    .badges {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-bottom: 16px;
    }
    .badge {
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 20px;
      background: #232530;
      color: #9aa0a6;
    }
    .badge.green {
      background: rgba(34, 197, 94, 0.15);
      color: #4ade80;
      border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .badge.red {
      background: rgba(225, 29, 72, 0.15);
      color: #f43f5e;
      border: 1px solid rgba(225, 29, 72, 0.3);
    }
    p {
      color: #9aa0a6;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    .btn {
      display: inline-block;
      width: 100%;
      padding: 14px 20px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-bottom: 12px;
      border: none;
    }
    .btn-primary {
      background: #e11d48;
      color: #fff;
      box-shadow: 0 4px 14px rgba(225, 29, 72, 0.35);
    }
    .btn-primary:hover {
      background: #be123c;
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #232530;
      color: #e4e7eb;
      border: 1px solid #333644;
    }
    .btn-secondary:hover {
      background: #2d303e;
    }
    .url-box {
      background: #111217;
      border: 1px dashed #333644;
      padding: 12px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      color: #9aa0a6;
      word-break: break-all;
      margin-top: 20px;
      user-select: all;
    }
  </style>
</head>
<body>
  <div class="card">
    <img src="${manifest.logo}" alt="Logo" class="logo">
    <h1>${manifest.name}</h1>
    <div class="badges">
      <span class="badge green">● Online</span>
      <span class="badge red">HLS CDN Directo</span>
      <span class="badge">v${manifest.version}</span>
    </div>
    <p>${manifest.description}</p>
    
    <a href="${stremioInstallUrl}" class="btn btn-primary">➕ Instalar en Stremio</a>
    <button onclick="copyManifest()" class="btn btn-secondary" id="copyBtn">📋 Copiar Enlace del Manifiesto</button>
    
    <div class="url-box">${manifestUrl}</div>
  </div>

  <script>
    function copyManifest() {
      const url = "${manifestUrl}";
      navigator.clipboard.writeText(url).then(() => {
        const btn = document.getElementById('copyBtn');
        btn.innerText = "✓ Enlace Copiado";
        setTimeout(() => { btn.innerText = "📋 Copiar Enlace del Manifiesto"; }, 2500);
      });
    }
  </script>
</body>
</html>`);
});

module.exports = app;
