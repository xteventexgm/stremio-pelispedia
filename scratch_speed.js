const pelispedia = require('./src/providers/pelispedia');
const fs = require('fs');

async function run() {
  const code = fs.readFileSync('src/providers/pelispedia.js', 'utf8');
  // let's grab links from extractVidhideM3U8
  const testCode = code.replace(
    'if (links.hls2) {',
    'console.log("ALL LINKS:", links); if (links.hls2) {'
  );
  fs.writeFileSync('src/providers/temp_speed.js', testCode);
  const p = require('./src/providers/temp_speed');
  await p.getStreams({ imdbId: 'tt1131746', title: 'Big Time Rush', year: 2009, type: 'series', season: 1, episode: 1 }, 'http://localhost');
  fs.unlinkSync('src/providers/temp_speed.js');
}
run();
