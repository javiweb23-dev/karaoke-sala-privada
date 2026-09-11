// Comprobacion del sistema sin tocar nada real: ni la base de datos, ni la
// TV, ni el celular. Se sacan las funciones de verdad de reproductor.html,
// index.html, admin.html y api/sesion.js y se les da de comer casos.
//
//   npm run probar
//
// Sirve para pasarlo antes de una noche de show, o despues de cualquier
// cambio, sin tener que esperar a que lleguen los clientes para descubrir
// que algo se rompio.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

let fallos = 0;
let grupo = '';

function seccion(t) {
    grupo = t;
    console.log('\n' + t);
}

function comprobar(nombre, condicion, detalle) {
    if (condicion) {
        console.log('  ok    ' + nombre);
    } else {
        fallos++;
        console.log('  FALLA ' + nombre + (detalle !== undefined ? '  ->  ' + JSON.stringify(detalle) : ''));
    }
}

// --- Sacar una funcion de un archivo, tal cual esta escrita ---------------
function sacarFuncion(texto, nombre, sangria) {
    const marca = ' '.repeat(sangria) + 'function ' + nombre + '(';
    const ini = texto.indexOf(marca);
    if (ini < 0) throw new Error('no encontre la funcion ' + nombre);
    const fin = texto.indexOf('\n' + ' '.repeat(sangria) + '}', ini);
    if (fin < 0) throw new Error('no encontre el final de ' + nombre);
    return texto.slice(ini, fin + sangria + 2);
}

function compilar(codigo, nombre) {
    return new Function(codigo + '\nreturn ' + nombre + ';')();
}

// =========================================================================
// 1. Reparto de turnos
// =========================================================================
const fuentes = {
    'reproductor.html': 8,
    'index.html': 8,
    'admin.html': 8
};

const repartidores = {};
for (const [archivo, sangria] of Object.entries(fuentes)) {
    repartidores[archivo] = compilar(sacarFuncion(leer(archivo), 'repartirCola', sangria), 'repartirCola');
}
const repartirCola = repartidores['reproductor.html'];

// Construye filas como las de la base: c = ya cantadas, p = pendientes.
let siguienteId = 1;
function filasDe(gente) {
    const filas = [];
    for (const [quien, n] of Object.entries(gente.cantadas || {})) {
        for (let i = 0; i < n; i++) filas.push({ id: siguienteId++, nombre_usuario: quien, estado: 'completada' });
    }
    for (const [quien, n] of Object.entries(gente.pendientes || {})) {
        for (let i = 0; i < n; i++) filas.push({ id: siguienteId++, nombre_usuario: quien, estado: 'pendiente' });
    }
    return filas;
}

const nombres = (cola) => cola.map((c) => String(c.nombre_usuario).trim().toUpperCase());

// Simula la noche entera: suena la primera, se marca cantada, se vuelve a repartir.
function simularNoche(filas) {
    const copia = filas.map((f) => ({ ...f }));
    const orden = [];
    const quedan = () => copia.filter((f) => f.estado === 'pendiente').length;
    let ultimo = null;
    while (quedan() > 0) {
        // Se le pasa quien canto de verdad, igual que hace el reproductor.
        const cola = repartirCola(copia, ultimo);
        if (!cola.length) break;
        const elegida = copia.find((f) => f.id === cola[0].id);
        elegida.estado = 'completada';
        ultimo = String(elegida.nombre_usuario).trim().toUpperCase();
        orden.push(ultimo);
    }
    return orden;
}

const rachaMaxima = (orden) => {
    let peor = orden.length ? 1 : 0;
    let seguidas = 1;
    for (let i = 1; i < orden.length; i++) {
        if (orden[i] === orden[i - 1]) { seguidas++; if (seguidas > peor) peor = seguidas; }
        else seguidas = 1;
    }
    return peor;
};

seccion('Reparto de turnos');

{
    // Todos cantan una antes de que nadie repita.
    const orden = simularNoche(filasDe({ pendientes: { ANA: 3, LUIS: 3, EVA: 3 } }));
    comprobar('las 3 primeras son de 3 personas distintas',
        new Set(orden.slice(0, 3)).size === 3, orden.slice(0, 6));
    comprobar('nadie canta dos seguidas habiendo otros',
        rachaMaxima(orden) === 1, orden.join(' '));
    comprobar('suenan las 9', orden.length === 9, orden.length);
}

{
    // El caso que planteo Javier: Maria pidio 10 y Pedro llega con 1.
    const orden = simularNoche(filasDe({ pendientes: { MARIA: 10, PEDRO: 1 } }));
    comprobar('Pedro entra en el puesto 2, no el 11',
        orden.indexOf('PEDRO') === 1, orden.slice(0, 4));
}

{
    // Ramon no ha pedido en toda la noche y los demas llevan 5.
    const orden = simularNoche(filasDe({
        cantadas: { ANA: 5, LUIS: 5 },
        pendientes: { ANA: 2, LUIS: 2, RAMON: 1 }
    }));
    comprobar('el que llega tarde canta primero',
        orden[0] === 'RAMON', orden.join(' '));
}

{
    // Nadie mas pidiendo: si puede encadenar.
    const orden = simularNoche(filasDe({ pendientes: { ANA: 4 } }));
    comprobar('sola en la cola, canta sus 4 seguidas',
        orden.length === 4 && rachaMaxima(orden) === 4, orden.join(' '));
}

{
    // Mayusculas y espacios: es la misma persona.
    const filas = [
        { id: 901, nombre_usuario: 'ana', estado: 'completada' },
        { id: 902, nombre_usuario: ' ANA ', estado: 'pendiente' },
        { id: 903, nombre_usuario: 'Ana', estado: 'pendiente' },
        { id: 904, nombre_usuario: 'LUIS', estado: 'pendiente' }
    ];
    const orden = nombres(repartirCola(filas));
    comprobar('"ana", " ANA " y "Ana" son la misma persona',
        orden[0] === 'LUIS', orden.join(' '));
}

{
    // Quien pide varias de golpe se lleva ids seguidos y bajos; quien pide
    // despues tiene el id mas alto. Si el reparto dedujera "el ultimo que
    // canto" mirando el id mas alto, se equivocaria de persona y dejaria
    // encadenar a la primera. Fue lo que paso en vivo.
    const filas = [];
    for (let i = 1; i <= 6; i++) filas.push({ id: i, nombre_usuario: 'MARIANNE', estado: 'pendiente' });
    for (let i = 7; i <= 8; i++) filas.push({ id: i, nombre_usuario: 'SARA', estado: 'pendiente' });
    const orden = simularNoche(filas);
    comprobar('quien pidio 6 de golpe no encadena mientras otra espera',
        orden[1] === 'SARA' && orden[3] === 'SARA', orden.join(' '));
    comprobar('la que pidio 2 canta sus 2 en la primera mitad',
        orden.slice(0, 4).filter((n) => n === 'SARA').length === 2, orden.join(' '));
}

{
    // Las tres pantallas tienen que repartir igual, o el celular miente.
    const filas = filasDe({ cantadas: { ANA: 2, LUIS: 1 }, pendientes: { ANA: 3, LUIS: 2, EVA: 4 } });
    const tv = JSON.stringify(nombres(repartidores['reproductor.html'](filas)));
    const cel = JSON.stringify(nombres(repartidores['index.html'](filas)));
    const adm = JSON.stringify(nombres(repartidores['admin.html'](filas)));
    comprobar('TV y celular reparten igual', tv === cel, { tv, cel });
    comprobar('TV y admin reparten igual', tv === adm, { tv, adm });
}

{
    // Una cola vacia no debe reventar.
    comprobar('cola vacia devuelve lista vacia', repartirCola([]).length === 0);
    comprobar('solo cantadas devuelve lista vacia',
        repartirCola(filasDe({ cantadas: { ANA: 3 } })).length === 0);
}

// =========================================================================
// 2. Que ninguna consulta se salga de la sesion
// =========================================================================
seccion('Aislamiento entre sesiones');

for (const archivo of ['reproductor.html', 'index.html', 'admin.html']) {
    const t = leer(archivo);
    const codigo = t.replace(/^\s*\/\/.*$/gm, '');   // sin comentarios
    comprobar(archivo + ' no lee filas sin sesion',
        !/sesion_id\.is\.null/.test(codigo));
}

{
    const t = leer('index.html').replace(/^\s*\/\/.*$/gm, '');
    comprobar('el celular no manda canciones sin sesion',
        /if \(!sesionSalaId\)/.test(t) && /solicitud\.sesion_id = sesionSalaId;/.test(t));
}

// =========================================================================
// 3. La lista de canciones
// =========================================================================
seccion('Lista de canciones');

{
    const t = leer('index.html');
    const plantilla = [...t.matchAll(/info\.innerHTML = `([\s\S]*?)`;/g)]
        .map((m) => m[1]).find((b) => b.includes('flex flex-wrap gap-1.5'));

    // El artista va ANTES que el titulo. Es lo que hace que una lista
    // ordenada por artista se lea como ordenada al recorrerla con la vista.
    const posArtista = plantilla.indexOf('song.artista');
    const posTitulo = plantilla.indexOf('song.titulo');
    comprobar('el artista se pinta encima del titulo',
        posArtista >= 0 && posTitulo >= 0 && posArtista < posTitulo,
        { posArtista, posTitulo });

    comprobar('el titulo sigue siendo el grande',
        /text-\[15px\][^>]*>\s*\$\{song\.titulo\}/.test(plantilla.replace(/\n\s*/g, ' ')));
    comprobar('el artista sigue siendo el chico y gris',
        /text-\[13px\][^>]*text-zinc-400/.test(plantilla));
    comprobar('ninguno de los dos se corta con puntos suspensivos',
        !/truncate/.test(plantilla));
}

{
    // Al cambiar de filtro hay que volver arriba. Si no, el navegador deja el
    // scroll donde estaba y lo recorta al maximo de la lista nueva: pasar de
    // 2685 canciones a las 18 de BACHATA te dejaba viendo la numero 14 de 18,
    // como si casi no hubiera. Medido en el navegador antes de arreglarlo.
    const t = leer('index.html');
    const cuerpo = sacarFuncion(t, 'aplicarFiltros', 8);
    comprobar('al filtrar, la lista vuelve arriba',
        /pageScroll/.test(cuerpo) && /scrollTop\s*=\s*0/.test(cuerpo), cuerpo.slice(0, 120));

    // Las cuatro rutas que rehacen la lista pasan por aplicarFiltros, asi que
    // basta con arreglarlo ahi. Si alguna dejara de pasar, esto lo avisa.
    const llamadas = (t.match(/cargarCanciones\(/g) || []).length;
    comprobar('solo aplicarFiltros rehace la lista',
        llamadas === 2, llamadas + ' apariciones (definicion + 1 llamada)');
}

// =========================================================================
// 4. Orden de los resultados de busqueda
// =========================================================================
seccion('Buscador');

{
    const t = leer('index.html');
    const codigo = ['sinAcentos', 'relevancia', 'ordenarPorRelevancia']
        .map((n) => sacarFuncion(t, n, 8)).join('\n');
    const api = new Function(codigo +
        '\nreturn { sinAcentos, relevancia, ordenarPorRelevancia };')();

    const c = (artista, titulo, genero) => ({ artista, titulo, genero: genero || 'POP', idioma: 'ESPAÑOL' });

    // Los cuatro niveles, en el orden que pidio Javier.
    comprobar('nivel 0: el artista empieza por lo escrito',
        api.relevancia(c('MARC ANTHONY', 'EL CANTANTE'), 'marc') === 0);
    comprobar('nivel 1: el artista lo contiene',
        api.relevancia(c('ELLA BAILA SOLA', 'AMORES DE BARRA'), 'baila') === 1);
    comprobar('nivel 2: el titulo empieza por lo escrito',
        api.relevancia(c('DON OMAR', 'BAILA MORENA'), 'baila') === 2);
    comprobar('nivel 3: el titulo lo contiene',
        api.relevancia(c('CHAYANNE', 'SALOME BAILA'), 'baila') === 3);
    comprobar('nivel 4: solo coincide el genero',
        api.relevancia(c('LUIS ENRIQUE', 'YO NO SE MAÑANA', 'SALSA'), 'salsa') === 4);

    // El genero de ultimo: fue el peor caso en vivo, "salsa" devolvia 279
    // resultados con el bueno en el puesto 206.
    const lista = [
        c('LUIS ENRIQUE', 'YO NO SE MAÑANA', 'SALSA'),
        c('GILBERTO SANTA ROSA', 'CONCIENCIA', 'SALSA'),
        c('ORQUESTA DE LA LUZ', 'SALSA CALIENTE DEL JAPON', 'SALSA'),
        c('SALSA KIDS', 'DEJAME UN BESO', 'SALSA')
    ];
    const orden = api.ordenarPorRelevancia(lista, 'salsa').map((x) => x.artista);
    comprobar('el artista que se llama asi va primero', orden[0] === 'SALSA KIDS', orden);
    comprobar('luego la cancion que se llama asi', orden[1] === 'ORQUESTA DE LA LUZ', orden);
    comprobar('las que solo son del genero, al final',
        orden.slice(2).length === 2, orden);

    // Empatados, el orden de siempre: artista y luego cancion.
    const mismoNivel = [
        c('MARC ANTHONY', 'VALIO LA PENA'),
        c('MARC ANTHONY', 'AHORA QUIEN'),
        c('MARCOS WITT', 'SOPLA')
    ];
    const emp = api.ordenarPorRelevancia(mismoNivel, 'marc').map((x) => x.artista + ' / ' + x.titulo);
    comprobar('empatados, alfabetico por artista y cancion',
        emp[0] === 'MARC ANTHONY / AHORA QUIEN' && emp[2] === 'MARCOS WITT / SOPLA', emp);

    comprobar('los acentos no estorban',
        api.relevancia(c('JOSÉ JOSÉ', 'EL TRISTE'), api.sinAcentos('jose')) === 0);
}

// =========================================================================
// 3. Fases de la sesion y avisos
// =========================================================================
seccion('Avisos de tiempo');

{
    const t = leer('reproductor.html');
    const codigo = ['formatReloj', 'mostrarAvisoSesion', 'faseDe', 'pintarReloj', 'alCambiarFase']
        .map((n) => sacarFuncion(t, n, 8)).join('\n');

    const avisos = [];
    const clase = () => ({ oculto: true, add() { this.oculto = true; }, remove() { this.oculto = false; } });
    const el = () => ({ innerText: '', className: '', classList: clase() });
    const ctx = {
        relojSesion: el(), relojSesionValor: el(), avisoSesion: el(),
        avisoSesionCaja: el(), avisoSesionTitulo: el(), avisoSesionTexto: el(),
        segundosRestantes: null, faseSesion: null, avisosVistos: {},
        sesionActual: { id: 1, segundos_gracia: 600, minutos_gracia: 10 },
        setTimeout: () => {},
        reproducirEfecto: () => {},
        terminarSesionEnPantalla: () => avisos.push('CIERRE'),
        avisos: avisos
    };
    // Se envuelve mostrarAvisoSesion para apuntar CADA llamada. Mirar si
    // cambio el texto no sirve: el segundo aviso de los 15 minutos dice lo
    // mismo que el primero y pareceria que no salio.
    const tic = new Function(...Object.keys(ctx), codigo +
        '\nconst _mostrar = mostrarAvisoSesion;' +
        '\nmostrarAvisoSesion = function (titulo, texto, color, segs) {' +
        '  avisos.push(titulo); return _mostrar(titulo, texto, color, segs); };' +
        '\nreturn (seg) => { segundosRestantes = seg; pintarReloj(); return faseSesion; };'
    )(...Object.values(ctx));

    comprobar('a 20 min esta corriendo', tic(20 * 60) === 'corriendo');
    tic(15 * 60);
    comprobar('a 15 min avisa', avisos.includes('QUEDAN 15 MINUTOS'), avisos);

    // Se paga media hora mas: vuelve a correr y el aviso se rearma.
    tic(45 * 60);
    avisos.length = 0;
    tic(15 * 60);
    comprobar('tras extender, vuelve a avisar a los 15 min',
        avisos.includes('QUEDAN 15 MINUTOS'), avisos);

    avisos.length = 0;
    comprobar('al llegar a cero pasa a cortesia', tic(0) === 'cortesia');
    comprobar('avisa del tiempo cumplido', avisos.includes('TIEMPO CUMPLIDO'), avisos);
    comprobar('a -9 min sigue en cortesia', tic(-9 * 60) === 'cortesia');
    comprobar('a -10 min se termina', tic(-10 * 60) === 'terminada');
    comprobar('y cierra la pantalla', avisos.includes('CIERRE'), avisos);
}

// =========================================================================
// 5. La hora de inicio a partir de un "HH:MM" suelto
// =========================================================================
seccion('Hora de inicio (noches que cruzan la medianoche)');

{
    const codigo = sacarFuncion(leer('admin.html'), 'horaDeHoy', 8);
    const Real = Date;
    const conReloj = (iso, hhmm) => {
        const fijo = new Real(iso).getTime();
        class Falso extends Real {
            constructor(...a) { super(...(a.length ? a : [fijo])); }
            static now() { return fijo; }
        }
        const anterior = global.Date;
        global.Date = Falso;
        try { return compilar(codigo, 'horaDeHoy')(hhmm); }
        finally { global.Date = anterior; }
    };

    const caso = (ahora, hhmm, dia, nota) =>
        comprobar(nota, conReloj(ahora, hhmm).getDate() === dia,
            ahora + ' + ' + hhmm + ' -> dia ' + conReloj(ahora, hhmm).getDate());

    caso('2026-09-05T21:00:00', '21:00', 5, 'la hora de ahora es hoy');
    caso('2026-09-05T23:00:00', '01:00', 6, 'a las 23:00, "01:00" es manana');
    caso('2026-09-06T00:30:00', '23:00', 5, 'a las 00:30, "23:00" fue anoche');
    caso('2026-09-06T02:00:00', '22:00', 5, 'de madrugada, "22:00" fue anoche');
}

// =========================================================================
// 6. La sesion: el tiempo es obligatorio
// =========================================================================
seccion('Abrir sesion (el endpoint real, con Supabase simulado)');

(async () => {
    process.env.ADMIN_PIN = 'PIN-DE-PRUEBA';
    process.env.SUPABASE_URL = 'https://ejemplo.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'clave-de-prueba';

    let sesiones = [];
    let limpiezas = [];
    let proximoId = 1;
    const fetchReal = global.fetch;

    global.fetch = async (url, op = {}) => {
        const u = new URL(url);
        const ruta = u.pathname.replace('/rest/v1/', '');
        const metodo = (op.method || 'GET').toUpperCase();
        const cuerpo = op.body ? JSON.parse(op.body) : null;
        const ok = (d, s = 200) => ({ ok: true, status: s, json: async () => d, text: async () => '' });

        if (ruta === 'sesiones') {
            if (metodo === 'GET') return ok(sesiones.filter((s) => s.estado === 'abierta'));
            if (metodo === 'POST') {
                const n = { id: proximoId++, estado: 'abierta', ...cuerpo };
                sesiones.push(n);
                return ok([n], 201);
            }
            if (metodo === 'PATCH') {
                sesiones.filter((s) => s.estado === 'abierta').forEach((s) => Object.assign(s, cuerpo));
                return ok([], 204);
            }
        }
        if (ruta.startsWith('Solicitudes')) {
            limpiezas.push(decodeURIComponent(u.search) + ' ' + JSON.stringify(cuerpo));
            return ok([], 204);
        }
        throw new Error('ruta no simulada: ' + metodo + ' ' + ruta);
    };

    const handler = require(path.join(root, 'api', 'sesion.js'));
    const llamar = async (cuerpo) => {
        const r = {
            _s: 0, _j: null,
            status(s) { this._s = s; return this; },
            json(d) { this._j = d; return this; },
            setHeader() { return this; }
        };
        await handler({ method: 'POST', body: { pin: 'PIN-DE-PRUEBA', ...cuerpo }, headers: {} }, r);
        return { status: r._s, ...r._j };
    };

    const ahora = new Date().toISOString();

    comprobar('sin tiempo, no abre', (await llamar({ accion: 'abrir' })).status === 400);
    comprobar('sin horas, no abre', (await llamar({ accion: 'abrir', inicio: ahora })).status === 400);
    comprobar('con 0 horas, no abre', (await llamar({ accion: 'abrir', inicio: ahora, horas: 0 })).status === 400);
    comprobar('con 25 horas, no abre', (await llamar({ accion: 'abrir', inicio: ahora, horas: 25 })).status === 400);
    comprobar('no se creo ninguna sesion', sesiones.length === 0, sesiones.length);

    const abierta = await llamar({ accion: 'abrir', nombre: 'Mesa 1', inicio: ahora, horas: 3 });
    comprobar('con tiempo, abre', abierta.ok === true, abierta);
    comprobar('el codigo son 4 numeros', /^\d{4}$/.test(abierta.sesion && abierta.sesion.codigo || ''));
    comprobar('nace con el reloj andando', abierta.sesion && abierta.sesion.programada === true);
    comprobar('quedan unas 3 horas',
        Math.abs((abierta.sesion.segundos_restantes || 0) - 10800) < 120,
        abierta.sesion.segundos_restantes);
    comprobar('vacia la cola de la noche anterior',
        limpiezas.some((l) => l.includes('estado=eq.pendiente') && l.includes('completada')), limpiezas);

    const mal = await llamar({ accion: 'abrir', pin: 'otro', inicio: ahora, horas: 3 });
    comprobar('con PIN equivocado, 401', mal.status === 401, mal);

    const ext = await llamar({ accion: 'extender', minutos: 30 });
    comprobar('extender suma media hora',
        Math.abs((ext.sesion.segundos_restantes || 0) - 12600) < 120,
        ext.sesion.segundos_restantes);

    comprobar('extender un disparate, 400', (await llamar({ accion: 'extender', minutos: 99999 })).status === 400);
    comprobar('accion inventada, 400', (await llamar({ accion: 'jaja' })).status === 400);
    comprobar('cerrar funciona', (await llamar({ accion: 'cerrar' })).ok === true);

    global.fetch = fetchReal;

    // ---------------------------------------------------------------------
    console.log('');
    if (fallos === 0) {
        console.log('Todo correcto.\n');
    } else {
        console.log(fallos + ' comprobacion(es) fallaron.\n');
    }
    process.exit(fallos ? 1 : 0);
})();
