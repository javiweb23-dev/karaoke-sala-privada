// Rehace sitemap.xml: la lista de paginas que queremos en Google.
//
// Se corre con "npm run sitemap" cuando se añade una pagina publica o cuando
// se quiere refrescar la fecha de la ultima vez que cambiaron. No va dentro
// del build a proposito: en Vercel el repositorio llega recortado y "git log"
// no siempre tiene la historia completa, asi que la fecha saldria mal.
//
// Para añadir una pagina, se añade aqui abajo y se corre. Nada mas.
//
// Lo que NO va en el sitemap:
//   - /resenas, que lleva "noindex": es un formulario, no algo que se busque
//   - la app, el reproductor, la tienda y las pantallas de administracion,
//     que ademas van bloqueadas en robots.txt

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const SITIO = 'https://mikaraokelatino.com';

const paginas = [
    { ruta: '/',        archivo: 'home.html',    prioridad: '1.0' },
    { ruta: '/eventos', archivo: 'eventos.html', prioridad: '0.9' },
    { ruta: '/reserva', archivo: 'reserva.html', prioridad: '0.9' }
];

// La fecha sale del ultimo commit que toco el archivo, que es cuando de verdad
// cambio. Poner la de hoy en todas le quita el poco valor que tiene el dato: a
// Google le sirve para saber que vale la pena volver, y si miente, deja de
// hacerle caso.
function ultimoCambio(archivo) {
    try {
        const fecha = execSync('git log -1 --format=%cs -- "' + archivo + '"',
            { cwd: raiz, encoding: 'utf8' }).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fecha;
    } catch (e) {
        console.warn('  no pude leer la fecha de ' + archivo + ':', e.message);
    }
    return new Date().toISOString().slice(0, 10);
}

const filas = paginas.map((p) => {
    if (!fs.existsSync(path.join(raiz, p.archivo))) {
        console.error('Falta ' + p.archivo + ', que esta en la lista del sitemap.');
        process.exit(1);
    }
    const fecha = ultimoCambio(p.archivo);
    console.log('  ' + p.ruta.padEnd(10) + fecha + '   (' + p.archivo + ')');
    return [
        '    <url>',
        '        <loc>' + SITIO + p.ruta + '</loc>',
        '        <lastmod>' + fecha + '</lastmod>',
        '        <priority>' + p.prioridad + '</priority>',
        '    </url>'
    ].join('\n');
}).join('\n');

const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Las paginas que queremos en Google.',
    '',
    '     NO se escribe a mano: lo rehace "npm run sitemap". Si lo editas aqui,',
    '     el siguiente que corra el comando te lo pisa. -->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    filas,
    '</urlset>',
    ''
].join('\n');

fs.writeFileSync(path.join(raiz, 'sitemap.xml'), xml, 'utf8');
console.log('\nsitemap.xml al dia con ' + paginas.length + ' paginas.');
