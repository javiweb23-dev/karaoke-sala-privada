// El agente nocturno.
//
// Toma lo que los clientes buscaron y NO encontraron, lo resuelve contra
// YouTube, valida los videos y los deja pre-cargados en el catalogo. Asi la
// cancion que falto anoche, mañana ya aparece en la lista y arranca al toque:
// sin busqueda en vivo, sin espera con el microfono en la mano.
//
// La idea de fondo: el trabajo pesado se hace de madrugada, no durante la
// fiesta. El catalogo crece solo, aprendiendo de clientes reales.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... YOUTUBE_API_KEY=... \
//     node scripts/resolver-faltantes.js
//
// Opciones:
//   --limite=N   cuantas busquedas resolver como maximo (por defecto 20).
//                Cada una gasta ~101 unidades de las 10.000 diarias, asi que
//                20 deja de sobra para las busquedas en vivo del dia.
//   --seco       no escribe nada, solo muestra que haria.

const fs = require('fs');
const path = require('path');
const { norm, sanitizeEnv, resolverKaraoke } = require('../api/_lib-youtube');

const root = path.join(__dirname, '..');
const salida = path.join(root, 'canciones_youtube.js');
const catalogoLocal = path.join(root, 'canciones.js');

const args = process.argv.slice(2);
const seco = args.includes('--seco');
const limite = Number((args.find((a) => a.startsWith('--limite=')) || '').split('=')[1]) || 20;

const SUPABASE_URL = sanitizeEnv(process.env.SUPABASE_URL);
const SUPABASE_KEY = sanitizeEnv(process.env.SUPABASE_SERVICE_KEY);
const YOUTUBE_KEY = sanitizeEnv(process.env.YOUTUBE_API_KEY);
const REGION = sanitizeEnv(process.env.KARAOKE_REGION) || 'VE';

if (!SUPABASE_URL || !SUPABASE_KEY || !YOUTUBE_KEY) {
    console.error('Faltan SUPABASE_URL, SUPABASE_SERVICE_KEY o YOUTUBE_API_KEY.');
    process.exit(1);
}

async function supa(ruta, opciones = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
        ...opciones,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            ...(opciones.headers || {})
        }
    });
    if (!res.ok) {
        throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? [] : res.json();
}

// Los titulos de karaoke suelen venir como
// "Artista - Cancion (Karaoke Version) [HD]". Sacamos artista y titulo
// limpios para que la cancion se vea igual que el resto del catalogo.
function parsearTitulo(tituloYt, consultaOriginal) {
    let t = String(tituloYt || '')
        .replace(/\([^)]*\)/g, ' ')     // (Karaoke Version)
        .replace(/\[[^\]]*\]/g, ' ')    // [HD]
        .replace(/\b(karaoke|instrumental|playback|con letra|lyrics|version|hd|4k|official)\b/gi, ' ')
        .replace(/[|/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const i = t.indexOf(' - ');
    if (i > 0 && i < t.length - 3) {
        return {
            artista: t.slice(0, i).trim().toUpperCase(),
            titulo: t.slice(i + 3).trim().toUpperCase()
        };
    }

    // Sin separador claro: preferimos lo que escribio el cliente, que suele
    // ser mas limpio que el titulo cargado de adornos del canal.
    return {
        artista: 'YOUTUBE',
        titulo: (t || consultaOriginal).toUpperCase().slice(0, 80)
    };
}

function leerCatalogoLocal() {
    try {
        const code = fs.readFileSync(catalogoLocal, 'utf8');
        const m = code.match(/cancionesREAL\s*=\s*(\[[\s\S]*?\]);/);
        if (!m) return new Set();
        const songs = eval(m[1]);
        return new Set(songs.map((s) => norm(`${s.artista} - ${s.titulo}`)));
    } catch (e) {
        console.warn('No se pudo leer el catalogo local:', e.message);
        return new Set();
    }
}

function escribirCatalogoYoutube(filas) {
    const entradas = filas.map((f, idx) => {
        const meta = parsearTitulo(f.titulo_resuelto, f.consulta);
        return {
            id: 900000 + idx,        // rango propio, no choca con canciones.js
            artista: meta.artista,
            titulo: meta.titulo,
            genero: 'YOUTUBE',
            idioma: 'VARIOS',
            fuente: 'youtube',
            video_id: f.video_id,
            respaldo_ids: f.respaldo_ids || [],
            duracion_seg: f.duracion_seg || 0
        };
    });

    const contenido = [
        '// Generado por scripts/resolver-faltantes.js — no editar a mano',
        `// Canciones: ${entradas.length} — ${new Date().toISOString()}`,
        '//',
        '// Estas canciones no estan en videos_locales: se reproducen con el',
        '// player oficial de YouTube. No admiten ajuste de tono.',
        'window.CANCIONES_YOUTUBE = ' + JSON.stringify(entradas, null, 2) + ';',
        ''
    ].join('\n');

    fs.writeFileSync(salida, contenido, 'utf8');
    return entradas.length;
}

async function main() {
    console.log(`Resolviendo hasta ${limite} busquedas fallidas${seco ? ' (simulacion)' : ''}...\n`);

    const pendientes = await supa(
        'busquedas_fallidas?estado=eq.pendiente' +
        `&order=veces.desc&limit=${limite}` +
        '&select=id,consulta,consulta_norm,veces'
    );

    if (pendientes.length === 0) {
        console.log('No hay busquedas pendientes.');
    }

    const yaEnCatalogo = leerCatalogoLocal();
    let resueltas = 0;
    let vacias = 0;

    for (const fila of pendientes) {
        const etiqueta = `"${fila.consulta}" (pedida ${fila.veces}x)`;

        let candidatos = [];
        try {
            candidatos = await resolverKaraoke(fila.consulta, {
                apiKey: YOUTUBE_KEY,
                region: REGION
            });
        } catch (err) {
            if (err.motivo === 'quotaExceeded') {
                console.error('\nCuota de YouTube agotada. Se corta aqui y se sigue mañana.');
                break;
            }
            console.warn(`  ${etiqueta}: error - ${err.message}`);
            continue;
        }

        if (candidatos.length === 0) {
            console.log(`  ✗ ${etiqueta}: sin karaoke decente`);
            vacias++;
            if (!seco) {
                await supa(`busquedas_fallidas?id=eq.${fila.id}`, {
                    method: 'PATCH',
                    headers: { Prefer: 'return=minimal' },
                    body: JSON.stringify({
                        estado: 'sin_resultado',
                        actualizada_en: new Date().toISOString()
                    })
                });
            }
            continue;
        }

        const mejor = candidatos[0];
        const meta = parsearTitulo(mejor.titulo, fila.consulta);
        const clave = norm(`${meta.artista} - ${meta.titulo}`);

        // Si resulta que ya la tenemos descargada, no la duplicamos: el archivo
        // local siempre gana (permite cambiar el tono y no depende de internet).
        if (yaEnCatalogo.has(clave)) {
            console.log(`  = ${etiqueta}: ya estaba en el catalogo local`);
            if (!seco) {
                await supa(`busquedas_fallidas?id=eq.${fila.id}`, {
                    method: 'PATCH',
                    headers: { Prefer: 'return=minimal' },
                    body: JSON.stringify({
                        estado: 'descartada',
                        actualizada_en: new Date().toISOString()
                    })
                });
            }
            continue;
        }

        console.log(`  ✓ ${etiqueta}`);
        console.log(`      ${mejor.titulo}`);
        console.log(`      ${mejor.canal} · ${mejor.puntos} pts · ${mejor.videoId}`);

        resueltas++;
        if (!seco) {
            await supa(`busquedas_fallidas?id=eq.${fila.id}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({
                    estado: 'resuelta',
                    video_id: mejor.videoId,
                    titulo_resuelto: mejor.titulo,
                    actualizada_en: new Date().toISOString()
                })
            });
        }
    }

    if (seco) {
        console.log(`\nSimulacion: ${resueltas} resueltas, ${vacias} sin resultado. No se escribio nada.`);
        return;
    }

    // Se regenera el catalogo completo desde las resueltas, no solo las de hoy.
    const todas = await supa(
        'busquedas_fallidas?estado=eq.resuelta&video_id=not.is.null' +
        '&order=veces.desc&select=consulta,video_id,titulo_resuelto'
    );
    const total = escribirCatalogoYoutube(todas);

    console.log(`\n${resueltas} resueltas, ${vacias} sin resultado.`);
    console.log(`canciones_youtube.js actualizado (${total} canciones).`);
    console.log('Sube el archivo con el proximo deploy para que aparezcan en la lista.');
}

main().catch((err) => {
    console.error('Fallo el resolvedor:', err);
    process.exit(1);
});
