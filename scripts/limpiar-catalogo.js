// Quita del catalogo las canciones que ya no tienen archivo de video.
//
// POR QUE HACEN FALTA:
// sync-catalogo-desde-videos.js solo AGREGA, nunca quita. Si renombras un MP4,
// crea una entrada nueva para el nombre nuevo y deja la vieja huerfana para
// siempre. Con el tiempo el catalogo acumula fantasmas: canciones que figuran
// en canciones.js pero cuyo archivo ya no existe o se llama de otra forma.
//
// No se ven en el celular del cliente (index.html las filtra con
// cancionTieneVideo), pero descuadran la cuenta y ensucian las estadisticas.
//
//   node scripts/limpiar-catalogo.js            <- solo muestra que sobra
//   node scripts/limpiar-catalogo.js --aplicar  <- lo borra de verdad
//
// Por defecto NO toca nada: hay que pedirlo con --aplicar.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const catalogFile = path.join(root, 'canciones.js');
const videosFile = path.join(root, 'videos_disponibles.js');
const videosDir = path.join(root, 'videos_locales');

const aplicar = process.argv.includes('--aplicar');

function norm(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function leerCatalogo() {
    const code = fs.readFileSync(catalogFile, 'utf8');
    const m = code.match(/cancionesREAL\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) throw new Error('No se pudo leer cancionesREAL en canciones.js');
    return eval(m[1]);
}

// Se prefiere leer la carpeta directamente; videos_disponibles.js es el
// respaldo para cuando se corre sin los videos a mano.
function leerVideos() {
    if (fs.existsSync(videosDir)) {
        const archivos = fs.readdirSync(videosDir).filter((f) => /\.mp4$/i.test(f));
        if (archivos.length > 0) {
            const set = new Set();
            for (const f of archivos) set.add(norm(f.replace(/\.mp4$/i, '')));
            return { claves: set, origen: `videos_locales/ (${archivos.length} archivos)` };
        }
    }

    const vd = fs.readFileSync(videosFile, 'utf8');
    const m = vd.match(/VIDEOS_DISPONIBLES = (\{[\s\S]*?\});/);
    if (!m) throw new Error('No se pudo leer videos_disponibles.js');
    const mapa = JSON.parse(m[1]);
    const set = new Set(Object.keys(mapa).map(norm));
    return { claves: set, origen: `videos_disponibles.js (${set.size} archivos)` };
}

function quote(s) {
    return JSON.stringify(String(s));
}

function lineaCancion(song) {
    return `{ id: ${song.id}, artista: ${quote(song.artista)}, titulo: ${quote(song.titulo)}, genero: ${quote(song.genero)}, idioma: ${quote(song.idioma)} },`;
}

const songs = leerCatalogo();
const { claves, origen } = leerVideos();

const huerfanas = [];
const buenas = [];

for (const s of songs) {
    const clave = norm(`${s.artista} - ${s.titulo}`);
    if (claves.has(clave)) buenas.push(s);
    else huerfanas.push(s);
}

console.log(`Catalogo:  ${songs.length} canciones`);
console.log(`Videos:    ${origen}`);
console.log('');

if (huerfanas.length === 0) {
    console.log('Todo cuadra: no hay canciones sin archivo.');
    process.exit(0);
}

console.log(`SIN ARCHIVO DE VIDEO: ${huerfanas.length}`);
console.log('');
for (const s of huerfanas) {
    console.log(`   id ${String(s.id).padStart(4)}  ${s.artista} - ${s.titulo}`);
}
console.log('');

if (!aplicar) {
    console.log('No se ha tocado nada.');
    console.log('Si la lista es correcta, ejecuta:');
    console.log('   node scripts/limpiar-catalogo.js --aplicar');
    process.exit(0);
}

// Copia de seguridad antes de escribir: es el catalogo entero.
const respaldo = catalogFile + '.bak';
fs.copyFileSync(catalogFile, respaldo);

const header = ['// Contenido de canciones.js', 'const cancionesREAL = ['];
const body = buenas.map(lineaCancion);
const footer = ['];', ''];
fs.writeFileSync(catalogFile, header.concat(body, footer).join('\n'), 'utf8');

console.log(`Quitadas ${huerfanas.length}. El catalogo queda en ${buenas.length}.`);
console.log(`Copia de seguridad: ${path.basename(respaldo)}`);
console.log('');
console.log('Ahora haz commit y push para que llegue al celular de los clientes.');
