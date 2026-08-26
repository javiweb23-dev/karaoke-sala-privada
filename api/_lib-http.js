// CORS para los endpoints.
//
// Hace falta porque el reproductor NO corre en Vercel: se abre con Live Server
// desde VS Code (localhost), porque necesita la carpeta videos_locales/ con los
// 2000 y pico de MP4, que no se despliegan. O sea que la TV pide a un origen
// distinto del suyo y sin esto el navegador bloquea la respuesta.
//
// Se puede restringir con CORS_ORIGENES en Vercel (lista separada por comas).
// Por defecto se permite cualquiera: lo que protege /api/sesion es el PIN,
// no el origen.
//
// El prefijo _ evita que Vercel lo publique como endpoint.

function origenesPermitidos() {
    const raw = String(process.env.CORS_ORIGENES || '').trim();
    if (!raw) return null;   // null = permitir cualquiera
    return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

// Devuelve true si la peticion ya quedo resuelta (preflight OPTIONS) y quien
// llama debe cortar ahi.
function aplicarCors(req, res) {
    const permitidos = origenesPermitidos();
    const origen = (req.headers || {}).origin;

    if (!permitidos) {
        res.setHeader('Access-Control-Allow-Origin', origen || '*');
    } else if (origen && permitidos.includes(origen)) {
        res.setHeader('Access-Control-Allow-Origin', origen);
    }

    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');

    // El navegador manda OPTIONS antes del POST con JSON. Hay que contestarlo.
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true;
    }

    return false;
}

module.exports = { aplicarCors };
