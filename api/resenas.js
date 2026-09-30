// Moderacion de las reseñas de la web.
//
// Todo lo que hay aqui pide el PIN del operador, porque publicar es decidir
// que sale en la portada del negocio. La clave secreta de Supabase se queda
// en el servidor: el navegador nunca la ve.
//
// Las reseñas pendientes SOLO se pueden leer por aqui. La politica de RLS
// deja ver a cualquiera unicamente las que ya estan publicadas, asi que una
// reseña con una groseria no es visible para nadie hasta que se apruebe.

const { supabaseFetchEstricto, pinValido, hayPinConfigurado } = require('./_lib-supabase');
const { aplicarCors } = require('./_lib-http');

const ESTADOS = {
    publicar:  'publicada',
    descartar: 'descartada',
    devolver:  'pendiente'
};

module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Método no permitido' });
    }

    if (!hayPinConfigurado()) {
        return res.status(500).json({
            ok: false,
            sinConfigurar: true,
            error: 'Falta ADMIN_PIN en Vercel.'
        });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
    }

    if (!pinValido(cuerpo?.pin)) {
        return res.status(401).json({ ok: false, error: 'PIN incorrecto' });
    }

    const accion = String(cuerpo?.accion || '');

    try {
        // ---------------------------------------------------------- listar
        if (accion === 'listar') {
            // Se piden todas y se separan aqui: son pocas, y asi el panel
            // enseña de una vez las pendientes y las que ya estan publicadas.
            const filas = await supabaseFetchEstricto(
                'resenas?select=id,nombre,texto,estrellas,foto_url,estado,creada_en' +
                '&order=creada_en.desc&limit=300'
            );

            return res.status(200).json({ ok: true, resenas: filas || [] });
        }

        // ------------------------------------------------- cambiar de estado
        if (ESTADOS[accion]) {
            const id = Number(cuerpo?.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ ok: false, error: 'Falta el id' });
            }

            await supabaseFetchEstricto(`resenas?id=eq.${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ estado: ESTADOS[accion] })
            });

            return res.status(200).json({ ok: true });
        }

        return res.status(400).json({ ok: false, error: 'Acción no válida' });

    } catch (err) {
        console.error('[resenas]', err);
        const texto = String(err.message || '');

        // Si la tabla no existe todavia, se dice con claridad en vez de
        // devolver un 500 pelado que no explica nada.
        if (/PGRST205|42P01|does not exist|Could not find the table/i.test(texto)) {
            return res.status(500).json({
                ok: false,
                faltaSql: true,
                error: 'Falta ejecutar sql/011-resenas.sql en Supabase.'
            });
        }

        return res.status(500).json({ ok: false, error: 'No se pudo completar la acción' });
    }
};
