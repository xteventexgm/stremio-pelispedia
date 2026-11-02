const app = require('./src/server');
process.env.CLOUDFLARE_WORKER_URL = 'https://pelispedia-relay.xteventex777.workers.dev';
const server = app.listen(0, async () => {
  const port = server.address().port;
  const masterUrl = `http://localhost:${port}/hls/master.m3u8?url=` + encodeURIComponent('https://callistanise.com/stream/NUkZWoYO5Z0fC-EVAN9Uyg/hjkrhuihghfvu/1793700175/29671786/master.m3u8');
  console.log('Testing full stream with ffplay on masterUrl:', masterUrl);
  const { exec } = require('child_process');
  const start = Date.now();
  exec(`ffplay -nodisp -autoexit -t 2 "${masterUrl}"`, (err, stdout, stderr) => {
    console.log('Finished in:', Date.now() - start, 'ms');
    console.log('ffplay log:', stderr.slice(-400));
    server.close();
    try { require('fs').unlinkSync('scratch_hybrid_test.js'); } catch {}
  });
});
