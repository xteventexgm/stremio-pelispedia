const pelispedia = require('./src/providers/pelispedia');
async function run() {
  const meta = { imdbId: 'tt1131746', title: 'Big Time Rush', year: 2009, type: 'series', season: 1, episode: 1 };
  const streams = await pelispedia.getStreams(meta, 'https://stremio-pelispedia.onrender.com');
  console.log('Streams count:', streams.length);
  for (const s of streams) {
    console.log('Name:', s.name);
    console.log('Title:', s.title);
    console.log('URL:', s.url);
  }
}
run();
