// EL comando. Uno solo.
//
//   npm run actualizar
//
// Lo que hace, en orden:
//   1. Mira que MP4 hay en videos_locales/  (eso es lo que EXISTE de verdad)
//   2. Lee plantillacanciones.xlsx                    (de ahi salen genero e idioma)
//   3. Escribe canciones.js
//   4. Escribe videos_disponibles.js
//   5. Reescribe plantillacanciones.xlsx con todo     (asi nunca se queda atrasado)
//   6. Hace commit y push
//
// La regla de oro: manda la CARPETA. Si el MP4 esta, la cancion entra; si no
// esta, no entra. El Excel solo aporta genero e idioma. Asi es imposible
// borrar una cancion por tener el Excel desactualizado, que era el peligro
// del metodo anterior de copiar y pegar.
//
// Opciones:
//   --sin-publicar   hace todo pero no toca git

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { crearXlsx, leerXlsx } = require('./lib-xlsx');

const root = path.join(__dirname, '..');
const catalogFile = path.join(root, 'canciones.js');
const excelFile = path.join(root, 'plantillacanciones.xlsx');
const videosFile = path.join(root, 'videos_disponibles.js');
const videosDir = path.join(root, 'videos_locales');

const publicar = !process.argv.includes('--sin-publicar');

function norm(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function parseNombre(base) {
    const nombre = base.replace(/\.mp4$/i, '').trim();
    const i = nombre.indexOf(' - ');
    if (i <= 0 || i === nombre.length - 3) {
        return { artista: 'VARIOS', titulo: nombre.toUpperCase() };
    }
    return {
        artista: nombre.slice(0, i).trim().toUpperCase(),
        titulo: nombre.slice(i + 3).trim().toUpperCase()
    };
}

function pareceIngles(texto) {
    const palabras = norm(texto).split(/[^A-Z]+/).filter(Boolean);
    const en = new Set(['THE','YOU','YOUR','MY','ME','WE','IT','IS','ARE','LOVE',
        'BABY','GIRL','NIGHT','DAY','LIFE','HEART','WANT','DONT','CANT','LET',
        'GET','GOT','LIKE','FROM','THIS','THAT','WITH','WHEN','WHERE','WHAT',
        'HOW','HELLO','TONIGHT','ALONE','CRAZY','DREAM','WORLD','TIME','NEVER',
        'ALWAYS','AGAIN','AWAY','DOWN','SONG','DANCE','ROCK','FIRE','RAIN',
        'SUN','MOON','HAPPY','BEAUTIFUL','KNOW','FEEL','MAKE','TAKE','GIVE']);
    const es = new Set(['EL','LA','LOS','LAS','UN','UNA','DE','DEL','QUE','NO',
        'TE','ME','MI','TU','SU','POR','CON','PARA','EN','Y','AMOR','CORAZON',
        'VIDA','NOCHE','DIA','SIN','MAS','COMO','QUIERO','BESO','LLORAR',
        'AMIGOS','ALMA','CIELO','MUJER']);
    let a = 0, b = 0;
    for (const p of palabras) { if (en.has(p)) a++; if (es.has(p)) b++; }
    return a > b && a >= 1;
}

function modo(valores) {
    const c = new Map();
    for (const v of valores) if (v) c.set(v, (c.get(v) || 0) + 1);
    let mejor = null, n = 0;
    for (const [k, v] of c) if (v > n) { mejor = k; n = v; }
    return mejor;
}

function leerCatalogoJs() {
    try {
        const code = fs.readFileSync(catalogFile, 'utf8');
        const m = code.match(/cancionesREAL\s*=\s*(\[[\s\S]*?\]);/);
        return m ? eval(m[1]) : [];
    } catch (e) {
        return [];
    }
}

// ---------------------------------------------------------------------------

// videos_locales/ es un enlace al disco externo. Si el disco no esta
// conectado, la carpeta se ve vacia o rota, y como el catalogo se reconstruye
// a partir de ella eso significaria quedarse sin canciones. Se avisa claro y
// no se escribe nada.
function avisarDiscoYSalir(detalle) {
    console.error('');
    console.error('  No se pueden leer los videos: ' + detalle);
    console.error('');
    console.error('  ¿Está conectado el disco externo?');
    console.error('  Los videos viven en D:\\videos_locales y la carpeta');
    console.error('  videos_locales/ del proyecto es solo un enlace.');
    console.error('');
    console.error('  No se ha tocado el catalogo.');
    process.exit(1);
}

let archivos;
try {
    if (!fs.existsSync(videosDir)) avisarDiscoYSalir('no existe la carpeta');
    archivos = fs.readdirSync(videosDir).filter((f) => /\.mp4$/i.test(f));
} catch (e) {
    avisarDiscoYSalir(e.code === 'ENOENT' ? 'el enlace no lleva a ningun sitio' : e.message);
}

if (archivos.length === 0) avisarDiscoYSalir('la carpeta esta vacia');

console.log(`Archivos MP4:  ${archivos.length}\n`);

// --- De donde salen genero e idioma: primero el Excel, luego el catalogo ---

const meta = new Map();          // "ARTISTA - TITULO" -> { genero, idioma, id }
let leidasDelExcel = 0;

if (fs.existsSync(excelFile)) {
    try {
        const filas = leerXlsx(excelFile);
        const cab = (filas[0] || []).map(norm);
        const col = {
            id: cab.indexOf('NUMERO'),
            artista: cab.indexOf('ARTISTA'),
            // La plantilla llama CANCION a esa columna; se acepta TITULO por si
            // alguna hoja vieja la trae con ese nombre.
            titulo: cab.indexOf('CANCION') >= 0 ? cab.indexOf('CANCION') : cab.indexOf('TITULO'),
            genero: cab.indexOf('GENERO'),
            idioma: cab.indexOf('IDIOMA')
        };

        if (col.artista < 0 || col.titulo < 0) {
            console.log('⚠  plantillacanciones.xlsx no tiene las columnas esperadas; se ignora.\n');
        } else {
            for (const f of filas.slice(1)) {
                const artista = String(f[col.artista] || '').trim();
                const titulo = String(f[col.titulo] || '').trim();
                if (!artista || !titulo) continue;
                meta.set(norm(`${artista} - ${titulo}`), {
                    artista, titulo,
                    genero: String(f[col.genero] || '').trim(),
                    idioma: String(f[col.idioma] || '').trim(),
                    id: Number(f[col.id]) || 0
                });
                leidasDelExcel++;
            }
            console.log(`Excel:         ${leidasDelExcel} filas leidas`);
        }
    } catch (e) {
        console.log(`⚠  No se pudo leer plantillacanciones.xlsx (${e.message}); se ignora.\n`);
    }
}

// El catalogo anterior sirve de respaldo para lo que no este en el Excel.
const anteriores = leerCatalogoJs();
const porArtista = new Map();
for (const s of anteriores) {
    const clave = norm(`${s.artista} - ${s.titulo}`);
    if (!meta.has(clave)) {
        meta.set(clave, {
            artista: s.artista,
            titulo: s.titulo,
            genero: String(s.genero || '').trim(),
            idioma: String(s.idioma || '').trim(),
            id: Number(s.id) || 0
        });
    }
    const ka = norm(s.artista);
    if (!porArtista.has(ka)) porArtista.set(ka, []);
    porArtista.get(ka).push({
        genero: String(s.genero || '').trim(),
        idioma: String(s.idioma || '').trim()
    });
}

// --- Se arma el catalogo: manda la carpeta -------------------------------

const finales = [];
const sinClasificar = [];
const repetidos = [];
const vistos = new Set();

for (const archivo of archivos) {
    const { artista, titulo } = parseNombre(archivo);
    const clave = norm(`${artista} - ${titulo}`);

    if (vistos.has(clave)) { repetidos.push(archivo); continue; }
    vistos.add(clave);

    const previo = meta.get(clave);

    if (previo && previo.genero) {
        // El nombre del archivo dice QUE canciones existen, pero el titulo se
        // toma del catalogo: los archivos suelen ir sin acentos y si no, cada
        // pasada iria comiendose las tildes ("AQUI" por "AQUÍ").
        finales.push({
            id: previo.id,
            artista: previo.artista || artista,
            titulo: previo.titulo || titulo,
            genero: previo.genero,
            idioma: previo.idioma || 'ESPAÑOL'
        });
        continue;
    }

    // Sin datos: se copia de otras canciones del mismo artista si las hay.
    const hermanas = porArtista.get(norm(artista));
    const cancion = {
        id: previo ? previo.id : 0,
        artista,
        titulo,
        genero: hermanas ? (modo(hermanas.map((h) => h.genero)) || 'POP') : 'POP',
        idioma: hermanas
            ? (modo(hermanas.map((h) => h.idioma)) || 'ESPAÑOL')
            : (pareceIngles(`${artista} ${titulo}`) ? 'INGLES' : 'ESPAÑOL')
    };
    finales.push(cancion);
    if (!hermanas) sinClasificar.push(cancion);
}

// Orden alfabetico e ids sin huecos ni repetidos.
finales.sort((a, b) => {
    const aa = norm(a.artista), ba = norm(b.artista);
    if (aa !== ba) return aa.localeCompare(ba, 'es');
    return norm(a.titulo).localeCompare(norm(b.titulo), 'es');
});

// El numero es solo para contar. No lo usa nada del sistema: las canciones se
// identifican por "ARTISTA - TITULO" tanto en los pedidos como en las portadas
// y en las populares. Antes se conservaba el numero viejo de cada cancion, asi
// que al ordenar alfabeticamente quedaban salteados y no servian para contar.
// Ahora se renumera de 1 a N en cada pasada: la ultima fila dice cuantas hay.
finales.forEach((s, i) => { s.id = i + 1; });

// --- Se escriben los tres archivos ---------------------------------------

const q = (s) => JSON.stringify(String(s));

fs.writeFileSync(catalogFile,
    ['// Contenido de canciones.js', 'const cancionesREAL = [']
        .concat(finales.map((s) =>
            `{ id: ${s.id}, artista: ${q(s.artista)}, titulo: ${q(s.titulo)}, genero: ${q(s.genero)}, idioma: ${q(s.idioma)} },`))
        .concat(['];', ''])
        .join('\n'), 'utf8');

const byName = {}, byNorm = {};
for (const f of archivos) {
    const base = f.replace(/\.mp4$/i, '');
    byName[base] = f;
    byNorm[norm(base)] = f;
}
fs.writeFileSync(videosFile, [
    '// Generado por scripts/actualizar.js — no editar a mano',
    `// Archivos: ${archivos.length} — ${new Date().toISOString()}`,
    'window.VIDEOS_DISPONIBLES = ' + JSON.stringify(byName, null, 2) + ';',
    'window.VIDEOS_DISPONIBLES_NORM = ' + JSON.stringify(byNorm, null, 2) + ';',
    ''
].join('\n'), 'utf8');

// El Excel se reescribe con TODO. Es lo que impide que se quede atrasado y
// que un dia se borren canciones por importarlo viejo.
let excelOk = true;
try {
    fs.writeFileSync(excelFile, crearXlsx(
        // Las mismas columnas que ya tenia la plantilla, con sus nombres.
        ['numero', 'Artista', 'Cancion', 'genero', 'idioma'],
        finales.map((s) => [s.id, s.artista, s.titulo, s.genero, s.idioma]),
        { nombreHoja: 'Canciones', anchos: [10, 34, 44, 22, 14] }
    ));
} catch (e) {
    excelOk = false;
}

// --- Efectos de sonido ---------------------------------------------------
// Se listan los archivos que haya en efectos/ y se genera el indice que leen
// el admin y el reproductor. Asi basta con soltar un MP3 en la carpeta para
// que aparezca su boton: no hay que tocar codigo para cambiar los sonidos.

const efectosDir = path.join(root, 'efectos');
const efectosFile = path.join(root, 'efectos_disponibles.js');

const EMOJIS = {
    aplausos: '👏', buuu: '👎', corneta: '📯', chacal: '🎺',
    gato: '🐱', trombon: '🎶', grillos: '🦗', redoble: '🥁',
    risa: '😂', beso: '💋', silbido: '😗', campana: '🔔',
    laser: '🔫', explosion: '💥', tambor: '🥁', sirena: '🚨'
};

let efectos = [];
if (fs.existsSync(efectosDir)) {
    efectos = fs.readdirSync(efectosDir)
        .filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f))
        .sort((a, b) => a.localeCompare(b, 'es'))
        .map((archivo) => {
            const base = archivo.replace(/\.[^.]+$/, '');
            const clave = norm(base).toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const etiqueta = base.charAt(0).toUpperCase() + base.slice(1);
            return {
                clave,
                archivo,
                etiqueta,
                emoji: EMOJIS[clave] || '🔊'
            };
        });
}

fs.writeFileSync(efectosFile, [
    '// Generado por scripts/actualizar.js — no editar a mano',
    `// Archivos en efectos/: ${efectos.length}`,
    '//',
    '// Para cambiar los sonidos: suelta el MP3 en efectos/ y vuelve a correr',
    '// "npm run actualizar". El boton aparece solo, con el nombre del archivo.',
    'window.EFECTOS = ' + JSON.stringify(efectos, null, 2) + ';',
    ''
].join('\n'), 'utf8');

// --- Musica de cierre ----------------------------------------------------
// Lo que suene de fondo cuando se acaba la sesion, mientras el grupo recoge.
// Mismo sistema que los efectos: suelta MP3 en la carpeta y ya.

const musicaDir = path.join(root, 'musica_cierre');
const musicaFile = path.join(root, 'musica_cierre_disponible.js');

let musica = [];
if (fs.existsSync(musicaDir)) {
    musica = fs.readdirSync(musicaDir)
        .filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f))
        .sort((a, b) => a.localeCompare(b, 'es'));
}

fs.writeFileSync(musicaFile, [
    '// Generado por scripts/actualizar.js — no editar a mano',
    `// Pistas en musica_cierre/: ${musica.length}`,
    '//',
    '// Suena de fondo y en bucle cuando termina la sesion, a volumen bajo.',
    '// Para cambiarla: suelta MP3 en musica_cierre/ y corre "npm run actualizar".',
    'window.MUSICA_CIERRE = ' + JSON.stringify(musica, null, 2) + ';',
    ''
].join('\n'), 'utf8');

// --- Resumen -------------------------------------------------------------

console.log(`Catalogo:      ${finales.length} canciones\n`);

if (repetidos.length) {
    console.log(`Archivos repetidos (solo entra uno):`);
    repetidos.forEach((f) => console.log('   ' + f));
    console.log('');
}

if (sinClasificar.length) {
    console.log(`⚠  ${sinClasificar.length} de artistas nuevos, quedaron en POP:`);
    sinClasificar.forEach((s) => console.log(`   ${s.artista} - ${s.titulo}`));
    console.log('\n   Ponles el genero en plantillacanciones.xlsx y vuelve a correr esto.\n');
}

if (!excelOk) {
    console.log('⚠  No se pudo reescribir plantillacanciones.xlsx (¿lo tienes abierto en Excel?).');
    console.log('   Cierralo y vuelve a correr esto para que quede al dia.\n');
}

// --- Publicar ------------------------------------------------------------

if (!publicar) {
    console.log('Listo (sin publicar).');
    process.exit(0);
}

try {
    const pendiente = execSync('git status --porcelain canciones.js videos_disponibles.js',
        { cwd: root }).toString().trim();

    if (!pendiente) {
        console.log('Listo. No hubo cambios que publicar.');
        process.exit(0);
    }

    execSync('git add canciones.js videos_disponibles.js', { cwd: root });
    execSync(`git commit -q -m "Actualizar catalogo: ${finales.length} canciones"`, { cwd: root });
    execSync('git push -q', { cwd: root });
    console.log('Listo. Publicado: ya lo ven los clientes en su celular.');
} catch (e) {
    console.log('El catalogo quedo bien, pero fallo la publicacion:');
    console.log('   ' + String(e.message).split('\n')[0]);
    console.log('\nPublicalo a mano con:');
    console.log('   git add . && git commit -m "nuevas canciones" && git push');
}
