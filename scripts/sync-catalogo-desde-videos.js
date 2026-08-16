const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const catalogFile = path.join(root, 'canciones.js');
const videosDir = path.join(root, 'videos_locales');

function sinAcentosUpper(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCatalog() {
  const code = fs.readFileSync(catalogFile, 'utf8');
  const m = code.match(/cancionesREAL\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('No se pudo leer cancionesREAL en canciones.js');
  return eval(m[1]);
}

function parseNombreArchivo(base) {
  const nombre = String(base || '').replace(/\.mp4$/i, '').trim();
  const sep = ' - ';
  const i = nombre.indexOf(sep);
  if (i <= 0 || i === nombre.length - sep.length) {
    return { artista: 'VARIOS', titulo: nombre.toUpperCase() };
  }
  return {
    artista: nombre.slice(0, i).trim().toUpperCase(),
    titulo: nombre.slice(i + sep.length).trim().toUpperCase()
  };
}

function pareceIngles(texto) {
  const t = sinAcentosUpper(texto);
  const palabras = t.split(/[^A-Z]+/).filter(Boolean);
  const en = new Set([
    'THE', 'YOU', 'YOUR', 'MY', 'ME', 'I', 'WE', 'IT', 'IS', 'ARE', 'WAS',
    'LOVE', 'BABY', 'GIRL', 'BOY', 'NIGHT', 'DAY', 'LIFE', 'HEART', 'WANT',
    'DONT', "DON'T", 'CANT', "CAN'T", 'WONT', 'LET', 'GET', 'GOT', 'LIKE',
    'FROM', 'THIS', 'THAT', 'WITH', 'WHEN', 'WHERE', 'WHAT', 'WHY', 'HOW',
    'HELLO', 'GOODBYE', 'TONIGHT', 'ALONE', 'CRAZY', 'DREAM', 'DREAMS',
    'WORLD', 'TIME', 'NEVER', 'ALWAYS', 'AGAIN', 'AWAY', 'DOWN', 'UP',
    'ON', 'IN', 'OF', 'TO', 'AND', 'FOR', 'ALL', 'ONE', 'TWO', 'LITTLE',
    'SONG', 'DANCE', 'ROCK', 'ROLL', 'FIRE', 'RAIN', 'SUN', 'MOON',
    'HAPPY', 'BEAUTIFUL', 'NATION', 'SIGN', 'FADED', 'SKYFALL', 'HIGHWAY',
    'HELL', 'WANTS', 'LUCKY', 'KNOW', 'OUGHTA', 'CRYIN', 'FLY', 'HERE'
  ]);
  const es = new Set([
    'EL', 'LA', 'LOS', 'LAS', 'UN', 'UNA', 'DE', 'DEL', 'QUE', 'NO', 'TE',
    'ME', 'MI', 'TU', 'SU', 'POR', 'CON', 'PARA', 'EN', 'Y', 'O', 'SI',
    'AMOR', 'CORAZON', 'VIDA', 'NOCHE', 'DIA', 'SIN', 'MAS', 'COMO',
    'QUIERO', 'QUIERES', 'BESO', 'BESOS', 'LLORAR', 'OLVIDE', 'AMIGOS'
  ]);
  let nEn = 0;
  let nEs = 0;
  for (const p of palabras) {
    if (en.has(p)) nEn++;
    if (es.has(p)) nEs++;
  }
  if (nEn > nEs && nEn >= 1) return true;
  return false;
}

function modo(valores) {
  const counts = new Map();
  for (const v of valores) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  let n = 0;
  for (const [k, c] of counts) {
    if (c > n) {
      best = k;
      n = c;
    }
  }
  return best;
}

function inferirMeta(artista, titulo, porArtista) {
  const key = sinAcentosUpper(artista);
  const conocidos = porArtista.get(key);
  if (conocidos) {
    return {
      genero: modo(conocidos.map((c) => c.genero)) || 'POP',
      idioma: modo(conocidos.map((c) => c.idioma)) || 'ESPAÑOL'
    };
  }
  return {
    genero: 'POP',
    idioma: pareceIngles(artista + ' ' + titulo) ? 'INGLES' : 'ESPAÑOL'
  };
}

function quote(s) {
  return JSON.stringify(String(s));
}

function lineaCancion(song) {
  return `{ id: ${song.id}, artista: ${quote(song.artista)}, titulo: ${quote(song.titulo)}, genero: ${quote(song.genero)}, idioma: ${quote(song.idioma)} },`;
}

if (!fs.existsSync(videosDir)) {
  console.error('No existe videos_locales/');
  process.exit(1);
}

const songs = parseCatalog();
const porNorm = new Set(
  songs.map((s) => sinAcentosUpper(`${s.artista} - ${s.titulo}`))
);
const porArtista = new Map();
for (const s of songs) {
  const k = sinAcentosUpper(s.artista);
  if (!porArtista.has(k)) porArtista.set(k, []);
  porArtista.get(k).push(s);
}

const files = fs.readdirSync(videosDir).filter((f) => /\.mp4$/i.test(f));
const nuevas = [];
const vistos = new Set();

for (const file of files) {
  const parsed = parseNombreArchivo(file);
  const clave = sinAcentosUpper(`${parsed.artista} - ${parsed.titulo}`);
  if (vistos.has(clave) || porNorm.has(clave)) continue;
  vistos.add(clave);
  const meta = inferirMeta(parsed.artista, parsed.titulo, porArtista);
  nuevas.push({
    artista: parsed.artista,
    titulo: parsed.titulo,
    genero: meta.genero,
    idioma: meta.idioma
  });
}

nuevas.sort((a, b) => {
  const aa = sinAcentosUpper(a.artista);
  const ba = sinAcentosUpper(b.artista);
  if (aa !== ba) return aa.localeCompare(ba, 'es');
  return sinAcentosUpper(a.titulo).localeCompare(sinAcentosUpper(b.titulo), 'es');
});

let nextId = songs.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0) + 1;
const agregadas = nuevas.map((s) => ({ ...s, id: nextId++ }));
const finalSongs = songs.concat(agregadas);

const header = [
  '// Contenido de canciones.js',
  'const cancionesREAL = ['
];
const body = finalSongs.map((s) => lineaCancion(s));
const footer = ['];', ''];

fs.writeFileSync(catalogFile, header.concat(body, footer).join('\n'), 'utf8');

console.log(`Catálogo actualizado: ${songs.length} existentes + ${agregadas.length} nuevas = ${finalSongs.length}`);
console.log(`Videos en carpeta: ${files.length}`);
