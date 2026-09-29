// Catalogo de la tienda, para el cliente. Publico y sin PIN: es una tienda.
//
// Devuelve solo los productos activos y la tasa de referencia, en una sola
// peticion para que la pagina cargue de un tiron.
//
// No expone precios editables ni nada mas: lo unico que se puede hacer aqui es
// leer lo que ya esta a la vista en la tienda.

const { supabaseFetch, configurado } = require('./_lib-supabase');
const { obtenerTasa } = require('./_lib-tasa');
const { aplicarCors } = require('./_lib-http');

module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ ok: false, error: 'Metodo no permitido' });
    }

    if (!configurado()) {
        return res.status(500).json({
            ok: false,
            error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en Vercel'
        });
    }

    let productos = null;
    try {
        productos = await supabaseFetch(
            'tienda_productos?activo=eq.true' +
            '&select=id,nombre,descripcion,precio_usd,imagen_url' +
            '&order=orden.asc,id.asc'
        );
    } catch (err) {
        console.error('[tienda-productos]', err);
    }

    // supabaseFetch devuelve null si algo fallo, incluida la tabla ausente.
    if (!productos) {
        return res.status(503).json({
            ok: false,
            error: 'No se pudo cargar el catalogo. Revisa que sql/011-tienda.sql este ejecutado.'
        });
    }

    const tasa = await obtenerTasa();

    // Un minuto de cache en el borde de Vercel. Cuando llegan diez personas
    // juntas a escanear el QR, solo la primera toca la base de datos.
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    return res.status(200).json({
        ok: true,
        productos: productos.map((p) => ({
            id: p.id,
            nombre: p.nombre,
            descripcion: p.descripcion || '',
            precio_usd: Number(p.precio_usd),
            imagen_url: p.imagen_url || null
        })),
        tasa: tasa.tasa,
        tasa_fuente: tasa.fuente
    });
};
