// Apunta un video de YouTube que fallo al reproducirse en la TV.
//
// La API de busqueda marca como embeddable=true videos que luego dan error
// 150 al reproducirlos. Como no hay forma de saberlo por adelantado, se
// aprende del fallo: lo que revienta una vez no se vuelve a ofrecer.
//
// Lo llama el reproductor, que ya tiene el PIN del operador.

const { supabaseFetchEstricto, pinValido, hayPinConfigurado } = require('./_lib-supabase');
const { aplicarCors } = require('./_lib-http');

module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Metodo no permitido' });
    }

    if (!hayPinConfigurado()) {
        return res.status(503).json({ ok: false, error: 'Falta ADMIN_PIN en Vercel' });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
    }

    if (!pinValido(cuerpo?.pin)) {
        return res.status(401).json({ ok: false, error: 'PIN incorrecto' });
    }

    // Los IDs de YouTube son 11 caracteres de un alfabeto conocido.
    const videoId = String(cuerpo?.video_id || '').trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
        return res.status(400).json({ ok: false, error: 'video_id invalido' });
    }

    try {
        await supabaseFetchEstricto('videos_vetados?on_conflict=video_id', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({
                video_id: videoId,
                motivo: String(cuerpo?.motivo || '').slice(0, 120) || null,
                consulta: String(cuerpo?.consulta || '').slice(0, 120) || null
            })
        });

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[vetar-video]', err);
        const texto = String(err.message || '');

        if (/PGRST205|42P01|does not exist|Could not find the table/i.test(texto)) {
            return res.status(503).json({
                ok: false,
                error: 'Falta ejecutar sql/003-videos-vetados.sql en Supabase.',
                faltaSql: true
            });
        }

        return res.status(500).json({ ok: false, error: 'No se pudo vetar el video' });
    }
};
