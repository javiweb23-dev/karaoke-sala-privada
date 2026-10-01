// Los contadores del portal.
//
// Existe para que el portal diga QUE esta esperando sin tener que entrar a
// cada sitio a mirar. Es lo unico que lo hace util de verdad: un menu de
// enlaces lo resuelve un marcador del navegador.
//
// Pide la misma clave que la tienda (TIENDA_PIN), no el PIN del operador.

const { supabaseFetch, claveAdminValida, hayClaveAdmin } = require('./_lib-supabase');
const { aplicarCors } = require('./_lib-http');

// Cuenta filas sin traerselas: se pide un rango vacio y se lee la cabecera.
async function contar(tabla, filtro) {
    const filas = await supabaseFetch(tabla + '?select=id&' + filtro + '&limit=1000');
    return Array.isArray(filas) ? filas.length : null;
}

module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Método no permitido' });
    }

    if (!hayClaveAdmin()) {
        return res.status(500).json({
            ok: false, sinConfigurar: true,
            error: 'Falta TIENDA_PIN en Vercel.'
        });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
    }

    if (!claveAdminValida(cuerpo?.pin)) {
        return res.status(401).json({ ok: false, error: 'Clave incorrecta' });
    }

    // Si una tabla falla, su contador viene en null y el portal no enseña
    // puntito. Vale mas un portal que abre con un dato de menos que uno que
    // se cae entero porque una consulta no respondio.
    const [reservas, resenas] = await Promise.all([
        contar('reservas', 'estado=eq.pendiente').catch(() => null),
        contar('resenas',  'estado=eq.pendiente').catch(() => null)
    ]);

    return res.status(200).json({ ok: true, reservas, resenas });
};
