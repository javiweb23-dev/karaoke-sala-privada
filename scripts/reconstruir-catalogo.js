// Reconstruye canciones.js desde los archivos de videos_locales/.
//
// QUE PROBLEMA RESUELVE:
// sync-catalogo-desde-videos.js solo agrega, nunca quita. Al renombrar un MP4
// deja la entrada vieja huerfana para siempre, y el catalogo se va desviando
// de la carpeta. Esto lo rehace entero: lo que hay en la carpeta es la verdad.
//
// LO QUE NO SE PIERDE:
// Los generos e idiomas estan curados a mano (LLANERA, GAITA, GALERON,
// CALIPSO...) y ningun script sabria deducirlos. Antes de reescribir, se
// guardan los de cada cancion y se le devuelven. Solo los archivos NUEVOS,
// que no estaban en el catalogo, reciben metadatos deducidos.
//
//   node scripts/reconstruir-catalogo.js            <- solo muestra que haria
//   node scripts/reconstruir-catalogo.js --aplicar  <- lo escribe
//
// Por defecto NO toca nada.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const catalogFile = path.join(root, 'canciones.js');
const videosDir = path.join(root, 'videos_locales');

const aplicar = process.argv.includes('--aplicar');

function norm(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
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
    const t = norm(texto);
    const palabras = t.split(/[^A-Z]+/).filter(Boolean);
    const en = new Set([
        'THE', 'YOU', 'YOUR', 'MY', 'ME', 'WE', 'IT', 'IS', 'ARE', 'WAS',
        'LOVE', 'BABY', 'GIRL', 'BOY', 'NIGHT', 'DAY', 'LIFE', 'HEART',
        'WANT', 'DONT', 'CANT', 'WONT', 'LET', 'GET', 'GOT', 'LIKE',
        'FROM', 'THIS', 'THAT', 'WITH', 'WHEN', 'WHERE', 'WHAT', 'WHY',
        'HOW', 'HELLO', 'GOODBYE', 'TONIGHT', 'ALONE', 'CRAZY', 'DREAM',
        'WORLD', 'TIME', 'NEVER', 'ALWAYS', 'AGAIN', 'AWAY', 'DOWN',
        'SONG', 'DANCE', 'ROCK', 'ROLL', 'FIRE', 'RAIN', 'SUN', 'MOON',
        'HAPPY', 'BEAUTIFUL', 'KNOW', 'FEEL', 'MAKE', 'TAKE', 'GIVE'
    ]);
    const es = new Set([
        'EL', 'LA', 'LOS', 'LAS', 'UN', 'UNA', 'DE', 'DEL', 'QUE', 'NO',
        'TE', 'ME', 'MI', 'TU', 'SU', 'POR', 'CON', 'PARA', 'EN', 'Y',
        'AMOR', 'CORAZON', 'VIDA', 'NOCHE', 'DIA', 'SIN', 'MAS', 'COMO',
        'QUIERO', 'BESO', 'LLORAR', 'AMIGOS', 'ALMA', 'CIELO', 'MUJER'
    ]);
    let nEn = 0, nEs = 0;
    for (const p of palabras) {
        if (en.has(p)) nEn++;
        if (es.has(p)) nEs++;
    }
    return nEn > nEs && nEn >= 1;
}

function modo(valores) {
    const cuenta = new Map();
    for (const v of valores) {
        if (!v) continue;
        cuenta.set(v, (cuenta.get(v) || 0) + 1);
    }
    let mejor = null, n = 0;
    for (const [k, c] of cuenta) if (c > n) { mejor = k; n = c; }
    return mejor;
}

function quote(s) {
    return JSON.stringify(String(s));
}

// ---------------------------------------------------------------------------

if (!fs.existsSync(videosDir)) {
    console.error('No existe videos_locales/. Este script necesita los videos.');
    process.exit(1);
}

const anteriores = leerCatalogo();

// Metadatos por nombre normalizado, y tambien agrupados por artista para
// poder deducir los de un archivo nuevo a partir de sus hermanos.
const metaPorCancion = new Map();
const metaPorArtista = new Map();

for (const s of anteriores) {
    // Se recortan espacios sobrantes: hay generos guardados como "POP  " que
    // salian como una categoria aparte de "POP" en el filtro del cliente.
    const genero = String(s.genero || '').trim();
    const idioma = String(s.idioma || '').trim();

    metaPorCancion.set(norm(`${s.artista} - ${s.titulo}`), { genero, idioma, id: s.id });

    const ka = norm(s.artista);
    if (!metaPorArtista.has(ka)) metaPorArtista.set(ka, []);
    metaPorArtista.get(ka).push({ genero, idioma });
}

const archivos = fs.readdirSync(videosDir).filter((f) => /\.mp4$/i.test(f));

const conservadas = [];
const nuevas = [];
const duplicados = [];
const vistos = new Set();

for (const archivo of archivos) {
    const { artista, titulo } = parseNombreArchivo(archivo);
    const clave = norm(`${artista} - ${titulo}`);

    if (vistos.has(clave)) {
        duplicados.push(archivo);
        continue;
    }
    vistos.add(clave);

    const previo = metaPorCancion.get(clave);

    if (previo) {
        conservadas.push({
            id: previo.id,
            artista, titulo,
            genero: previo.genero || 'POP',
            idioma: previo.idioma || 'ESPAÑOL'
        });
    } else {
        const hermanas = metaPorArtista.get(norm(artista));
        nuevas.push({
            artista, titulo,
            genero: hermanas ? (modo(hermanas.map((h) => h.genero)) || 'POP') : 'POP',
            idioma: hermanas
                ? (modo(hermanas.map((h) => h.idioma)) || 'ESPAÑOL')
                : (pareceIngles(`${artista} ${titulo}`) ? 'INGLES' : 'ESPAÑOL')
        });
    }
}

// Los que estaban en el catalogo y ya no tienen archivo.
const clavesArchivos = new Set(vistos);
const eliminadas = anteriores.filter(
    (s) => !clavesArchivos.has(norm(`${s.artista} - ${s.titulo}`))
);

// IDs nuevos a partir del mayor existente, para no pisar ninguno.
let siguienteId = anteriores.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0) + 1;
for (const s of nuevas) s.id = siguienteId++;

const finales = conservadas.concat(nuevas).sort((a, b) => {
    const aa = norm(a.artista), ba = norm(b.artista);
    if (aa !== ba) return aa.localeCompare(ba, 'es');
    return norm(a.titulo).localeCompare(norm(b.titulo), 'es');
});

// ------------------------------------------------------------------ informe

console.log(`Archivos en videos_locales/:  ${archivos.length}`);
console.log(`Catalogo actual:              ${anteriores.length}`);
console.log(`Catalogo reconstruido:        ${finales.length}`);
console.log('');
console.log(`  Conservan sus datos:  ${conservadas.length}`);
console.log(`  Nuevas (deducidas):   ${nuevas.length}`);
console.log(`  Se quitan (sin video): ${eliminadas.length}`);
if (duplicados.length) console.log(`  Archivos repetidos:   ${duplicados.length}`);
console.log('');

if (eliminadas.length) {
    console.log('SE QUITAN (no tienen archivo):');
    eliminadas.forEach((s) => console.log(`   ${s.artista} - ${s.titulo}`));
    console.log('');
}

if (nuevas.length) {
    console.log('SE AGREGAN (revisa que el genero deducido tenga sentido):');
    nuevas.slice(0, 40).forEach((s) =>
        console.log(`   ${s.artista} - ${s.titulo}   [${s.genero} / ${s.idioma}]`));
    if (nuevas.length > 40) console.log(`   ... y ${nuevas.length - 40} mas`);
    console.log('');
}

if (duplicados.length) {
    console.log('ARCHIVOS REPETIDOS (mismo artista y titulo, solo entra uno):');
    duplicados.forEach((f) => console.log(`   ${f}`));
    console.log('');
}

if (!aplicar) {
    console.log('No se ha tocado nada.');
    console.log('Si el resumen cuadra, ejecuta:');
    console.log('   node scripts/reconstruir-catalogo.js --aplicar');
    process.exit(0);
}

fs.copyFileSync(catalogFile, catalogFile + '.bak');

const salida = ['// Contenido de canciones.js', 'const cancionesREAL = [']
    .concat(finales.map((s) =>
        `{ id: ${s.id}, artista: ${quote(s.artista)}, titulo: ${quote(s.titulo)}, genero: ${quote(s.genero)}, idioma: ${quote(s.idioma)} },`))
    .concat(['];', '']);

fs.writeFileSync(catalogFile, salida.join('\n'), 'utf8');

console.log(`canciones.js reconstruido: ${finales.length} canciones.`);
console.log('Copia de seguridad: canciones.js.bak');
console.log('');
console.log('Ahora: npm run videos:index  y despues commit y push.');
