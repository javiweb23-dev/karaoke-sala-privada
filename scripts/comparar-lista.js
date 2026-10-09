// Cruza una lista vieja de canciones contra el catalogo de ahora, para saber
// cuales se perdieron y habria que reponer.
//
//   node scripts/comparar-lista.js listavieja.txt
//
// La lista puede venir separada por tabulador (ARTISTA<tab>TITULO) o con un
// guion (ARTISTA - TITULO). La primera linea se salta si es la cabecera.
//
// Deja DOS archivos, porque no todo es blanco o negro:
//
//   faltantes.txt   las que no estan, ni parecidas. Estas si hay que reponer.
//
//   dudosas.txt     el titulo SI esta en el catalogo, pero con otro artista.
//                   Casi siempre es la misma cancion escrita distinto ("50
//                   CENTS" contra "50 CENT"), y darlas por faltantes haria
//                   descargar cosas que ya se tienen. Se apartan para mirarlas
//                   a ojo, que son pocas.
//
// No se imprime la lista entera en pantalla a proposito: son miles de lineas.

const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const archivo = process.argv[2] || 'listavieja.txt';

// Se quitan acentos, mayusculas y todo lo que no sea letra o numero, porque
// "Qué Será" y "QUE SERA" son la misma cancion escrita por dos personas.
const norm = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// ------------------------------------------------------------ el catalogo
const txt = fs.readFileSync(path.join(raiz, 'canciones.js'), 'utf8');
const catalogo = new Function('return ' + txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1))();

const claves = new Set();              // "ARTISTA TITULO" exacto
const porTitulo = new Map();           // titulo -> [artistas que la tienen]
for (const c of catalogo) {
    const a = norm(c.artista);
    const t = norm(c.titulo);
    claves.add(a + ' | ' + t);
    if (!porTitulo.has(t)) porTitulo.set(t, []);
    porTitulo.get(t).push(c.artista);
}

// Y otro indice por artista, para poder perdonar erratas en el TITULO sin
// arriesgarse: solo se comparan canciones del mismo artista, asi que un
// parecido de mas no puede emparejar a dos canciones distintas.
// De paso se le quitan al titulo los anadidos entre parentesis, que es donde
// van los "(VIDEO)", "(KARAOKE)" y demas.
const sinAnadidos = (s2) => norm(String(s2).replace(/\([^)]*\)/g, ''));
const porArtista = new Map();
for (const c of catalogo) {
    const p = norm(String(c.artista).split(/ (?:FT|FEAT|CON|Y|X|VS) /)[0]);
    if (!porArtista.has(p)) porArtista.set(p, []);
    porArtista.get(p).push({ titulo: sinAnadidos(c.titulo), original: c.artista + ' - ' + c.titulo });
}

// ------------------------------------------------------------- la lista
const bruto = fs.readFileSync(path.join(raiz, archivo), 'utf8')
    .replace(/^﻿/, '')            // marca de orden de bytes, si la trae
    .split(/\r?\n/);

const lista = [];
for (const linea of bruto) {
    if (!linea.trim()) continue;
    let artista, titulo;
    if (linea.includes('\t')) {
        [artista, titulo] = linea.split('\t');
    } else if (linea.includes(' - ')) {
        const i = linea.indexOf(' - ');
        artista = linea.slice(0, i);
        titulo = linea.slice(i + 3);
    } else {
        continue;                      // sin artista no se puede comparar
    }
    artista = String(artista || '').trim();
    titulo = String(titulo || '').replace(/\.(mp4|mkv|avi|cdg|zip)$/i, '').trim();
    if (!artista || !titulo) continue;
    if (norm(artista) === 'ARTISTA' && norm(titulo) === 'TITULO') continue;   // cabecera
    lista.push({ artista, titulo });
}

// --------------------------------------------------------------- cruzar
// Cuando se escribe un artista a mano, lo mismo sale de tres formas:
//
//   ALANIS MORISETTE            contra  ALANIS MORISSETTE      (una S de menos)
//   ALEJANDRO FERNANDEZ & X     contra  ALEJANDRO FERNANDEZ FT X
//   50 CENTS                    contra  50 CENT
//
// Asi que se compara solo el artista PRINCIPAL (lo de antes del "ft", "&" o
// "con"), y se perdona hasta dos letras de diferencia. Sin esto salian
// cientos de dudosas que eran la misma cancion con una errata.
function principal(a) {
    return norm(a).split(/ (?:FT|FEAT|FEATURING|CON|Y|X|VS) /)[0].trim();
}

// Cuantas letras hay que cambiar para pasar de una palabra a la otra.
function distancia(a, b, limite = 2) {
    if (Math.abs(a.length - b.length) > limite) return 99;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return d[a.length][b.length];
}

function mismoArtista(a, b) {
    const x = principal(a), y = principal(b);
    if (!x || !y) return false;
    if (x === y) return true;
    // Uno contiene al otro, pero solo si lo que sobra no cambia de artista:
    // "ABBA" y "ABBA EN ESPANOL" si; "LOS" y "LOS BUKIS" no.
    if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
    return distancia(x, y) <= 2;
}

const tiene = [], dudosas = [], faltan = [];

for (const fila of lista) {
    const a = norm(fila.artista);
    const t = norm(fila.titulo);

    if (claves.has(a + ' | ' + t)) { tiene.push(fila); continue; }

    const otros = porTitulo.get(t);
    if (otros) {
        if (otros.some((o) => mismoArtista(o, fila.artista))) tiene.push(fila);
        else dudosas.push({ ...fila, enElCatalogo: otros.join(', ') });
        continue;
    }

    // El titulo no esta tal cual. Solo se da por encontrada si en el catalogo
    // aparece con un anadido conocido Y ADEMAS del mismo artista. Antes bastaba
    // con que un titulo contuviera al otro, y eso emparejaba disparates:
    // "FALLASTE CORAZON" con una de Danny Ocean que no tiene nada que ver.
    let encontrada = false;
    for (const [tc, artistas] of porTitulo) {
        if (tc.length < 6 || !tc.startsWith(t + ' ')) continue;
        if (artistas.some((o) => mismoArtista(o, fila.artista))) { encontrada = true; break; }
    }

    // Ultima oportunidad: del MISMO artista, un titulo que se diferencie en
    // dos o tres letras. Son erratas de quien escribio la lista: "VIVIR LOS
    // NUESTRO" por "VIVIR LO NUESTRO", "LEO LEO LE" por "LEO LEO LEEE".
    if (!encontrada) {
        const tope = Math.max(2, Math.round(t.length * 0.12));
        for (const [p, suyas] of porArtista) {
            if (!mismoArtista(p, fila.artista)) continue;
            if (suyas.some((x) => distancia(x.titulo, t, tope) <= tope)) { encontrada = true; break; }
        }
    }

    if (encontrada) tiene.push(fila);
    else faltan.push(fila);
}

// -------------------------------------------------------------- guardar
function guardar(nombre, cabecera, filas, linea) {
    fs.writeFileSync(path.join(raiz, nombre),
        cabecera + '\n' + '='.repeat(cabecera.length) + '\n\n' +
        filas.map(linea).join('\n') + '\n', 'utf8');
}

faltan.sort((a, b) => (a.artista + a.titulo).localeCompare(b.artista + b.titulo));
dudosas.sort((a, b) => (a.artista + a.titulo).localeCompare(b.artista + b.titulo));

guardar('faltantes.txt',
    'CANCIONES DE LA LISTA VIEJA QUE YA NO TIENES (' + faltan.length + ')',
    faltan, (x) => x.artista + '\t' + x.titulo);

guardar('dudosas.txt',
    'EL TITULO SI ESTA, PERO CON OTRO ARTISTA (' + dudosas.length + ') - MIRALAS A OJO',
    dudosas, (x) => x.artista + '\t' + x.titulo + '\t\t-> en el catalogo: ' + x.enElCatalogo);

// -------------------------------------------------------------- resumen
console.log('Lista vieja:   ' + lista.length + ' canciones');
console.log('Catalogo hoy:  ' + catalogo.length + ' canciones');
console.log('');
console.log('  ya las tienes   ' + String(tiene.length).padStart(5));
console.log('  dudosas         ' + String(dudosas.length).padStart(5) + '   -> dudosas.txt');
console.log('  NO las tienes   ' + String(faltan.length).padStart(5) + '   -> faltantes.txt');
