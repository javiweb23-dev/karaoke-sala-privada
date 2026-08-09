const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const videosDir = path.join(root, 'videos_locales');
const outFile = path.join(root, 'videos_disponibles.js');

function sinAcentosUpper(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

if (!fs.existsSync(videosDir)) {
  if (fs.existsSync(outFile)) {
    console.log('videos_locales/ no existe; se conserva videos_disponibles.js actual.');
    process.exit(0);
  }
  console.error('No hay videos_locales/ ni videos_disponibles.js.');
  process.exit(1);
}

const files = fs.readdirSync(videosDir).filter((f) => /\.mp4$/i.test(f));
if (files.length === 0) {
  if (fs.existsSync(outFile)) {
    console.log('videos_locales/ vacío; se conserva videos_disponibles.js actual.');
    process.exit(0);
  }
  console.error('No hay MP4 en videos_locales/ ni videos_disponibles.js.');
  process.exit(1);
}

const byName = {};
const byNorm = {};

for (const file of files) {
  const base = file.replace(/\.mp4$/i, '');
  byName[base] = file;
  byNorm[sinAcentosUpper(base)] = file;
}

const header = [
  '// Generado por scripts/generate-videos-disponibles.js — no editar a mano',
  `// Archivos: ${files.length} — ${new Date().toISOString()}`,
  'window.VIDEOS_DISPONIBLES = ' + JSON.stringify(byName, null, 2) + ';',
  'window.VIDEOS_DISPONIBLES_NORM = ' + JSON.stringify(byNorm, null, 2) + ';',
  ''
].join('\n');

fs.writeFileSync(outFile, header, 'utf8');
console.log(`videos_disponibles.js OK (${files.length} videos)`);
