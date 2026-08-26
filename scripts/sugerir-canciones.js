// Sugiere, para los artistas que YA tienes, sus canciones mas populares que
// te faltan en el catalogo.
//
// POR QUE DEEZER Y NO ITUNES:
// Se intento primero con iTunes (la API que index.html usa para las portadas)
// deduciendo la popularidad de en cuantos discos aparecia cada tema. No sirvio:
// salia todo empatado y el orden acababa siendo arbitrario. Deezer publica un
// campo 'rank' de popularidad real y un endpoint de "top del artista", que es
// exactamente lo que hace falta. Tambien es gratis y sin clave.
//
// SOBRE LO DE "POPULARES EN VENEZUELA":
// El rank de Deezer es global, no por pais. En la practica da igual para tu
// caso: los artistas ya los pones tu, y para Oscar D'Leon, Guaco o Adolescent's
// quien los escucha es publico venezolano y latino. El filtro de pais lo hace
// tu propio catalogo, no la API.
//
//   node scripts/sugerir-canciones.js --min=3 --limite=60
//
// Opciones:
//   --min=N       solo artistas de los que ya tengas N canciones (por defecto 2).
//                 Cuantas mas tengas de alguien, mas gusta en tu sala.
//   --limite=N    cuantos artistas consultar por corrida (por defecto 60).
//   --solo="X"    un unico artista, para probar.
//   --max=N       cuantas sugerencias por artista (por defecto 6).
//   --salida=X    archivo de salida (por defecto SUGERENCIAS.md).
//
// Guarda lo consultado en .cache-deezer.json: puedes cortarlo con Ctrl+C y
// volver a lanzarlo, sigue donde quedo.

const fs = require('fs');
const path = require('path');
const { crearXlsx } = require('./lib-xlsx');

const root = path.join(__dirname, '..');
const catalogFile = path.join(root, 'canciones.js');
const cacheFile = path.join(root, '.cache-deezer.json');

const args = process.argv.slice(2);
function opcion(nombre, porDefecto) {
    const found = args.find((a) => a.startsWith(`--${nombre}=`));
    if (!found) return porDefecto;
    return found.slice(nombre.length + 3).replace(/^["']|["']$/g, '');
}

// Por defecto entran TODOS los artistas, incluidos los que solo tienen una
// cancion tuya: ahi es justo donde mas falta hace (Palito Ortega tiene una
// sola en el catalogo y muchos temas conocidos que no estan).
const MIN_CANCIONES = Number(opcion('min', 1));
const LIMITE_ARTISTAS = Number(opcion('limite', 60));
const MAX_SUGERENCIAS = Number(opcion('max', 6));
const SOLO_ARTISTA = opcion('solo', '');
const SALIDA = path.join(root, opcion('salida', 'SUGERENCIAS.xlsx'));

// Deezer permite unas 50 peticiones cada 5 segundos. Vamos muy por debajo.
const PAUSA_MS = 350;

function norm(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

// Para comparar titulos: fuera parentesis, corchetes, featurings y puntuacion.
// Asi "Lloraras (Version Salsa)" y "Lloraras" cuentan como la misma cancion.
function claveTitulo(titulo) {
    return norm(titulo)
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\b(FEAT|FT|CON|WITH)\b.*$/g, ' ')
        .replace(/[^A-Z0-9N ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Versiones que no sirven para karaoke o que ensucian la lista.
const TITULOS_A_IGNORAR = [
    'EN VIVO', 'LIVE', 'REMIX', 'KARAOKE', 'INSTRUMENTAL', 'DEMO',
    'INTRO', 'INTERLUDIO', 'POPURRI', 'MEDLEY', 'MIX', 'CONTINUOUS',
    'RADIO EDIT', 'EXTENDED', 'ACAPPELLA', 'A CAPPELLA', 'REPRISE',
    'VERSION ACUSTICA', 'UNPLUGGED'
];

function esTituloUtil(titulo) {
    const t = norm(titulo);
    if (t.length < 2) return false;
    return !TITULOS_A_IGNORAR.some((mala) => t.includes(mala));
}

function leerCatalogo() {
    const code = fs.readFileSync(catalogFile, 'utf8');
    const m = code.match(/cancionesREAL\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) throw new Error('No se pudo leer cancionesREAL en canciones.js');
    return eval(m[1]);
}

function leerCache() {
    try {
        return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch (e) {
        return {};
    }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function deezer(ruta) {
    const res = await fetch(`https://api.deezer.com${ruta}`);
    if (!res.ok) throw new Error(`Deezer ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'error de Deezer');
    return data;
}

// Palabras que no distinguen a nadie: sobran al comparar nombres.
const CONECTORES = new Set([
    'Y', 'E', 'O', 'AND', 'THE', 'DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS',
    'SU', 'SUS', 'CON', 'FEAT', 'FT'
]);

function palabrasClave(nombre) {
    return norm(nombre)
        // Los apostrofos se BORRAN, no se cambian por espacio: si no,
        // "Adolescent's" se parte en "ADOLESCENT" + "S" y deja de parecerse
        // a "ADOLESCENTES", que es como lo tienes tu escrito.
        .replace(/['’´`]/g, '')
        .replace(/[^A-Z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((p) => p.length >= 2 && !CONECTORES.has(p));
}

// Distancia de edicion, para tolerar plurales y variantes de escritura.
function distancia(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = cur;
    }
    return prev[n];
}

// Una palabra del catalogo aparece en el nombre de Deezer, exacta o casi.
//
// Se tolera UNA letra de diferencia en palabras de 5+ letras: cubre
// "ADOLESCENTES"/"ADOLESCENTS" y "TACUBA"/"TACVBA". Y solo una, que es lo
// que separa esos aciertos de "PIRELA"/"VILELA" (dos letras), un artista
// completamente distinto que antes se colaba.
function apareceEn(palabra, palabrasCandidato) {
    if (palabrasCandidato.includes(palabra)) return true;
    if (palabra.length < 5) return false;
    return palabrasCandidato.some((p) => distancia(palabra, p) <= 1);
}

// Deezer resuelve bien las variantes buenas ("ADOLESCENTES" -> "Adolescent's
// Orquesta", "BOB MARLEY" -> "Bob Marley & The Wailers") pero tambien devuelve
// homonimos que no tienen nada que ver. La regla: TODAS las palabras con peso
// del nombre que tienes deben aparecer en el de Deezer. Deezer puede añadir
// ("& The Wailers", "de America"), pero no cambiar lo que ya escribiste.
function pareceMismoArtista(pedido, devuelto) {
    const a = palabrasClave(pedido);
    const b = palabrasClave(devuelto);
    if (a.length === 0 || b.length === 0) return false;
    return a.every((p) => apareceEn(p, b));
}

// Hay ambigüedades que ningun algoritmo resuelve: "SELENA" coincide de forma
// legitima con "Selena Gomez", y no hay nada en el nombre que diga cual
// querias. Para esos casos se fija el ID de Deezer a mano en
// artistas-deezer.json. Buscar un ID: https://api.deezer.com/search/artist?q=NOMBRE
function leerCorrecciones() {
    try {
        const crudo = JSON.parse(
            fs.readFileSync(path.join(root, 'artistas-deezer.json'), 'utf8')
        );
        const mapa = {};
        for (const [k, v] of Object.entries(crudo)) {
            if (k.startsWith('//')) continue;   // comentarios
            mapa[norm(k)] = v;
        }
        return mapa;
    } catch (e) {
        return {};
    }
}

const CORRECCIONES = leerCorrecciones();

async function datosDeArtista(id, nombreVisible, fans) {
    const top = await deezer(`/artist/${id}/top?limit=50`);
    const temas = top.data || [];
    if (temas.length === 0) return null;
    return {
        nombreDeezer: nombreVisible,
        fans: fans || 0,
        temas: temas.map((t) => ({ titulo: t.title, rank: t.rank || 0 }))
    };
}

async function consultarArtista(nombre) {
    const fijado = CORRECCIONES[norm(nombre)];

    if (fijado === null) return null;          // marcado para ignorar
    if (typeof fijado === 'number') {
        const info = await deezer(`/artist/${fijado}`);
        await dormir(PAUSA_MS);
        return datosDeArtista(fijado, info.name || nombre, info.nb_fan);
    }

    const busqueda = await deezer(
        `/search/artist?q=${encodeURIComponent(nombre)}&limit=8`
    );

    // Deezer tiene perfiles duplicados y vacios con el mismo nombre: hay un
    // "Luis Miguel" de 109 seguidores y sin canciones, y el de verdad tiene
    // 1.900.000. Quedarse con el primero que coincida de nombre elige mal.
    // El numero de seguidores desambigua sin lugar a dudas.
    const candidatos = (busqueda.data || [])
        .filter((c) => pareceMismoArtista(nombre, c.name))
        .sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));

    if (candidatos.length === 0) return null;

    // Aun asi el mas seguido puede venir sin temas, asi que se prueban los
    // siguientes antes de darlo por perdido.
    for (const candidato of candidatos.slice(0, 3)) {
        await dormir(PAUSA_MS);
        const top = await deezer(`/artist/${candidato.id}/top?limit=50`);
        const temas = top.data || [];
        if (temas.length === 0) continue;

        return {
            nombreDeezer: candidato.name,
            fans: candidato.nb_fan || 0,
            temas: temas.map((t) => ({ titulo: t.title, rank: t.rank || 0 }))
        };
    }

    return null;
}

function faltantesDe(datos, titulosQueTengo) {
    const vistos = new Set();
    const salida = [];

    for (const t of datos.temas) {
        if (!esTituloUtil(t.titulo)) continue;

        const clave = claveTitulo(t.titulo);
        if (!clave || vistos.has(clave) || titulosQueTengo.has(clave)) continue;

        vistos.add(clave);
        salida.push(t);
    }

    return salida
        .sort((a, b) => b.rank - a.rank)
        .slice(0, MAX_SUGERENCIAS);
}

// El rank de Deezer llega hasta ~1.000.000. Se traduce a estrellas para que
// se lea de un vistazo cuales son himnos y cuales son temas menores.
function estrellas(rank) {
    if (rank >= 500000) return '★★★★★';
    if (rank >= 350000) return '★★★★';
    if (rank >= 200000) return '★★★';
    if (rank >= 100000) return '★★';
    return '★';
}

async function main() {
    const songs = leerCatalogo();

    const porArtista = new Map();
    for (const s of songs) {
        const k = norm(s.artista);
        if (!porArtista.has(k)) {
            porArtista.set(k, { nombre: s.artista.trim(), titulos: new Set() });
        }
        porArtista.get(k).titulos.add(claveTitulo(s.titulo));
    }

    let artistas = [...porArtista.values()]
        .filter((a) => a.titulos.size >= MIN_CANCIONES)
        .sort((a, b) => b.titulos.size - a.titulos.size);

    if (SOLO_ARTISTA) {
        const buscado = norm(SOLO_ARTISTA);
        artistas = artistas.filter((a) => norm(a.nombre).includes(buscado));
        if (artistas.length === 0) {
            console.error(`No tienes canciones de "${SOLO_ARTISTA}" (o tiene menos de ${MIN_CANCIONES}).`);
            process.exit(1);
        }
    }

    const cache = leerCache();
    const pendientes = artistas.filter((a) => !cache[norm(a.nombre)]);
    const aConsultar = pendientes.slice(0, LIMITE_ARTISTAS);

    console.log(`Artistas con ${MIN_CANCIONES}+ canciones tuyas: ${artistas.length}`);
    console.log(`Ya consultados: ${artistas.length - pendientes.length}`);
    console.log(`Por consultar ahora: ${aConsultar.length}\n`);

    for (let i = 0; i < aConsultar.length; i++) {
        const artista = aConsultar[i];
        const etiqueta = `[${i + 1}/${aConsultar.length}] ${artista.nombre}`;

        try {
            const datos = await consultarArtista(artista.nombre);
            // Se cachea incluso el "no encontrado" (null): asi no se reintenta
            // en cada corrida un artista que Deezer no tiene.
            cache[norm(artista.nombre)] = datos;
            fs.writeFileSync(cacheFile, JSON.stringify(cache), 'utf8');

            console.log(datos
                ? `${etiqueta} -> ${datos.nombreDeezer} (${datos.temas.length} temas)`
                : `${etiqueta} -> no encontrado en Deezer`);
        } catch (err) {
            console.warn(`${etiqueta} -> fallo: ${err.message}`);
        }

        if (i < aConsultar.length - 1) await dormir(PAUSA_MS);
    }

    // El informe se arma con TODO lo cacheado, no solo con lo de esta corrida.
    const filas = [];

    for (const artista of artistas) {
        const datos = cache[norm(artista.nombre)];
        if (!datos) continue;

        const faltantes = faltantesDe(datos, artista.titulos);
        if (faltantes.length === 0) continue;

        // Si Deezer resolvio a otro nombre puede ser un acierto (Adolescent's
        // Orquesta) o una confusion. Va en su columna para poder revisarlo.
        const otroNombre = norm(datos.nombreDeezer) !== norm(artista.nombre)
            ? datos.nombreDeezer
            : '';

        for (const f of faltantes) {
            filas.push([
                artista.nombre,
                f.titulo,
                estrellas(f.rank),
                f.rank,
                artista.titulos.size,
                `${artista.nombre} - ${f.titulo}.mp4`,
                otroNombre,
                ''   // columna vacia para ir marcando lo descargado
            ]);
        }
    }

    // Las mas famosas arriba: es el orden en que conviene descargarlas.
    // En Excel se puede reordenar por artista con un clic en el filtro.
    filas.sort((a, b) => b[3] - a[3]);

    const cabeceras = [
        'Artista', 'Canción', 'Popularidad', 'Puntos', 'Ya tengo',
        'Nombre para el archivo', 'Ojo: en Deezer es', 'Descargada'
    ];

    fs.writeFileSync(
        SALIDA,
        crearXlsx(cabeceras, filas, {
            nombreHoja: 'Por descargar',
            anchos: [26, 38, 13, 9, 9, 52, 22, 12]
        })
    );

    console.log(`\n${filas.length} canciones sugeridas.`);
    console.log(`Excel: ${path.basename(SALIDA)}`);

    const quedan = pendientes.length - aConsultar.length;
    if (quedan > 0) {
        console.log(`\nQuedan ${quedan} artistas. Vuelve a correr el mismo comando.`);
    }
}

main().catch((err) => {
    console.error('Fallo:', err);
    process.exit(1);
});
