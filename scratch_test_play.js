const app = require('./src/server');
const server = app.listen(48291, async () => {
  const rawHls4 = 'https://callistanise.com/stream/i_Mf0kZxkoIwUOYak2d0wQ/hjkrhuihghfvu/1793531289/29671786/master.m3u8';
  const proxyUrl = 'http://localhost:48291/hls/master.m3u8?url=' + encodeURIComponent(rawHls4);
  console.log('Testing proxyUrl with ffplay:', proxyUrl);
  const { exec } = require('child_process');
  const start = Date.now();
  const p = exec(`ffplay -nodisp -autoexit -t 2 "${proxyUrl}"`, (err, stdout, stderr) => {
    console.log('Play time elapsed:', Date.now() - start, 'ms');
    console.log('ffplay log:', stderr.slice(-400));
    server.close();
  });
});
