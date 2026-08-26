// El catalogo, de ida y vuelta entre Excel y canciones.js.
//
// POR QUE EXISTE:
// El metodo de siempre era llevar las canciones en un Excel, generar con una
// formula las lineas de canciones.js y copiarlas a mano sobre el archivo. Eso
// funciona, pero el copiar y pegar es donde se pierde trabajo: al hacerlo con
// un Excel desactualizado se borran de golpe las canciones que faltaban en el.
// Paso de verdad: el Excel tenia 1.772 canciones y el catalogo 2.195.
//
// Aqui el Excel sigue mandando, pero sin copiar nada:
//
//   npm run excel:exportar     canciones.js  ->  canciones.xlsx
//   npm run excel:importar     canciones.xlsx  ->  canciones.js
//
// Flujo normal: exportar una vez, editar en Excel cuando haga falta,
// importar. La columna de formulas ya no hace falta.

const fs = require('fs');
const path = require('path');
const { crearXlsx, leerXlsx } = require('./lib-xlsx');

const root = path.join(__dirname, '..');
const catalogFile = path.join(root, 'canciones.js');
const excelFile = path.join(root, 'canciones.xlsx');
const videosDir = path.join(root, 'videos_locales');

const args = process.argv.slice(2);
const exportar = args.includes('--exportar');
const importar = args.includes('--importar');
const forzar = args.includes('--forzar');

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

function videosEnDisco() {
    if (!fs.existsSync(videosDir)) return null;
    const archivos = fs.readdirSync(videosDir).filter((f) => /\.mp4$/i.test(f));
    return new Set(archivos.map((f) => norm(f.replace(/\.mp4$/i, ''))));
}

const CABECERAS = ['numero', 'artista', 'titulo', 'genero', 'idioma'];

// ------------------------------------------------------------------ exportar

if (exportar) {
    const songs = leerCatalogo();

    const filas = songs.map((s) => [
        Number(s.id) || 0,
        s.artista || '',
        s.titulo || '',
        (s.genero || '').trim(),
        (s.idioma || '').trim()
    ]);

    fs.writeFileSync(excelFile, crearXlsx(CABECERAS, filas, {
        nombreHoja: 'Canciones',
        anchos: [10, 34, 44, 22, 14]
    }));

    console.log(`canciones.xlsx creado con ${filas.length} canciones.`);
    console.log('');
    console.log('Editalo en Excel (genero e idioma son las columnas D y E) y luego:');
    console.log('   npm run excel:importar');
    process.exit(0);
}

// ------------------------------------------------------------------ importar

if (importar) {
    if (!fs.existsSync(excelFile)) {
        console.error('No existe canciones.xlsx.');
        console.error('Crealo primero con:  npm run excel:exportar');
        process.exit(1);
    }

    const filas = leerXlsx(excelFile);
    if (filas.length < 2) {
        console.error('El Excel esta vacio.');
        process.exit(1);
    }

    // Se localizan las columnas por su nombre en la cabecera, para que mover
    // una columna en Excel no desordene los datos en silencio.
    const cabecera = filas[0].map((c) => norm(c));
    const col = {
        id: cabecera.indexOf('NUMERO'),
        artista: cabecera.indexOf('ARTISTA'),
        titulo: cabecera.indexOf('TITULO'),
        genero: cabecera.indexOf('GENERO'),
        idioma: cabecera.indexOf('IDIOMA')
    };

    if (col.artista < 0 || col.titulo < 0) {
        console.error('La primera fila debe tener las columnas: ' + CABECERAS.join(', '));
        console.error('Encontrado: ' + filas[0].join(', '));
        process.exit(1);
    }

    const nuevas = [];
    const problemas = [];
    const vistos = new Set();

    filas.slice(1).forEach((f, i) => {
        const numeroFila = i + 2;   // +1 por la cabecera, +1 porque Excel cuenta desde 1
        const artista = String(f[col.artista] || '').trim();
        const titulo = String(f[col.titulo] || '').trim();

        if (!artista && !titulo) return;   // fila vacia, se ignora
        if (!artista || !titulo) {
            problemas.push(`fila ${numeroFila}: falta artista o titulo`);
            return;
        }

        const clave = norm(`${artista} - ${titulo}`);
        if (vistos.has(clave)) {
            problemas.push(`fila ${numeroFila}: repetida (${artista} - ${titulo})`);
            return;
        }
        vistos.add(clave);

        nuevas.push({
            id: Number(f[col.id]) || 0,
            artista,
            titulo,
            genero: String(f[col.genero] || '').trim() || 'POP',
            idioma: String(f[col.idioma] || '').trim() || 'ESPAÑOL'
        });
    });

    // Ids: se respetan los del Excel y se rellenan los que falten.
    let siguiente = nuevas.reduce((m, s) => Math.max(m, s.id), 0) + 1;
    for (const s of nuevas) if (!s.id) s.id = siguiente++;

    // ---- La red de seguridad -------------------------------------------
    // Lo que de verdad importa: que no desaparezca del catalogo una cancion
    // cuyo video SI esta en disco. Es exactamente el accidente que provocaba
    // el copiar y pegar.
    const enDisco = videosEnDisco();
    let perdidas = [];

    if (enDisco) {
        perdidas = [...enDisco].filter((clave) => !vistos.has(clave));
    }

    console.log(`Excel:      ${nuevas.length} canciones`);
    console.log(`Catalogo:   ${leerCatalogo().length} canciones (antes de importar)`);
    if (enDisco) console.log(`Videos:     ${enDisco.size} archivos en disco`);
    console.log('');

    if (problemas.length) {
        console.log(`Filas con problemas: ${problemas.length}`);
        problemas.slice(0, 20).forEach((p) => console.log('   ' + p));
        if (problemas.length > 20) console.log(`   ... y ${problemas.length - 20} mas`);
        console.log('');
    }

    if (perdidas.length && !forzar) {
        console.error(`⚠  ATENCION: ${perdidas.length} canciones tienen su video en disco`);
        console.error('   pero NO estan en el Excel. Importar asi las borraria del');
        console.error('   catalogo y nadie podria pedirlas.\n');
        perdidas.slice(0, 15).forEach((c) => console.error('   ' + c));
        if (perdidas.length > 15) console.error(`   ... y ${perdidas.length - 15} mas`);
        console.error('\nLo mas probable es que tu Excel este desactualizado.');
        console.error('Solucion:  npm run excel:exportar   (rehace el Excel con todo)');
        console.error('           y vuelve a editarlo desde ahi.\n');
        console.error('Si aun asi quieres borrarlas, añade --forzar.');
        process.exit(1);
    }

    if (perdidas.length && forzar) {
        console.log(`Se quitan ${perdidas.length} canciones que si tienen video (--forzar).`);
        console.log('');
    }

    fs.copyFileSync(catalogFile, catalogFile + '.bak');

    const q = (s) => JSON.stringify(String(s));
    const salida = ['// Contenido de canciones.js', 'const cancionesREAL = [']
        .concat(nuevas.map((s) =>
            `{ id: ${s.id}, artista: ${q(s.artista)}, titulo: ${q(s.titulo)}, genero: ${q(s.genero)}, idioma: ${q(s.idioma)} },`))
        .concat(['];', '']);

    fs.writeFileSync(catalogFile, salida.join('\n'), 'utf8');

    console.log(`canciones.js actualizado: ${nuevas.length} canciones.`);
    console.log('Copia de seguridad: canciones.js.bak');
    console.log('');
    console.log('Ahora haz commit y push para que llegue al celular de los clientes.');
    process.exit(0);
}

console.log('Uso:');
console.log('   npm run excel:exportar     canciones.js -> canciones.xlsx');
console.log('   npm run excel:importar     canciones.xlsx -> canciones.js');
