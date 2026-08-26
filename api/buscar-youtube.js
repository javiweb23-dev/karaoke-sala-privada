// Busca karaokes en YouTube para las canciones que NO estan en el catalogo.
//
// Vive en el servidor por dos razones:
//   1. La API key de YouTube nunca puede tocar el navegador (te la queman).
//   2. Aqui se cachea el resultado, que es lo unico que hace viable la cuota.
//
// Cuota: 10.000 unidades/dia gratis. search.list cuesta 100 (= 100 busquedas
// al dia), videos.list cuesta 1. Por eso: una sola search por consulta nueva,
// y de ahi en adelante todo sale del cache.
//
// Variables de entorno en Vercel:
//   YOUTUBE_API_KEY          (obligatoria)
//   SUPABASE_URL             (obligatoria para el cache)
//   SUPABASE_SERVICE_KEY     (obligatoria para el cache — la secreta, no la publishable)
//   KARAOKE_REGION           (opcional, por defecto VE)
//   KARAOKE_CANALES_OK       (opcional, canales extra separados por coma)

const { norm, sanitizeEnv, resolverKaraoke, DIAS_CACHE } = require('./_lib-youtube');
const { supabaseFetch } = require('./_lib-supabase');
const { aplicarCors } = require('./_lib-http');

async function leerCache(consultaNorm) {
    const desde = new Date(Date.now() - DIAS_CACHE * 86400000).toISOString();
    const filas = await supabaseFetch(
        `youtube_cache?consulta_norm=eq.${encodeURIComponent(consultaNorm)}` +
        `&creada_en=gte.${encodeURIComponent(desde)}&select=resultados&limit=1`
    );
    return filas && filas.length ? filas[0].resultados : null;
}

async function guardarCache(consultaNorm, resultados) {
    await supabaseFetch('youtube_cache?on_conflict=consulta_norm', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
            consulta_norm: consultaNorm,
            resultados,
            creada_en: new Date().toISOString()
        })
    });
}

module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Metodo no permitido' });
    }

    const apiKey = sanitizeEnv(process.env.YOUTUBE_API_KEY);
    if (!apiKey) {
        // Degradar con elegancia: el paso 1 (registrar la busqueda fallida)
        // funciona igual aunque YouTube todavia no este configurado.
        return res.status(200).json({
            ok: true,
            configurado: false,
            candidatos: [],
            mensaje: 'Busqueda en YouTube no configurada todavia.'
        });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
    }

    const consulta = String(cuerpo?.consulta || '').trim().slice(0, 120);
    if (consulta.length < 3) {
        return res.status(400).json({ ok: false, error: 'Consulta muy corta' });
    }

    const consultaNorm = norm(consulta);
    const region = sanitizeEnv(process.env.KARAOKE_REGION) || 'VE';

    try {
        const cacheado = await leerCache(consultaNorm);
        if (cacheado) {
            return res.status(200).json({
                ok: true,
                configurado: true,
                desdeCache: true,
                candidatos: cacheado
            });
        }

        const candidatos = await resolverKaraoke(consulta, { apiKey, region });

        // Se cachea incluso el resultado vacio: si esa busqueda no da nada,
        // no tiene sentido gastar 100 unidades otra vez mañana.
        await guardarCache(consultaNorm, candidatos);

        return res.status(200).json({ ok: true, configurado: true, candidatos });
    } catch (err) {
        console.error('[buscar-youtube]', err);

        if (err.motivo === 'quotaExceeded') {
            return res.status(429).json({
                ok: false,
                error: 'Se agoto la cuota diaria de busquedas de YouTube.',
                motivo: 'quotaExceeded'
            });
        }

        return res.status(502).json({
            ok: false,
            error: 'No se pudo buscar en YouTube',
            detalle: err.message
        });
    }
};
