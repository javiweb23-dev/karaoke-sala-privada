// Acceso a Supabase desde los endpoints, con la clave SECRETA.
//
// Se usa fetch directo contra la API REST a proposito: evita sumarle la
// dependencia @supabase/supabase-js al despliegue, que en el navegador ya
// viene por CDN.
//
// El prefijo _ evita que Vercel lo publique como endpoint.

function sanitizeEnv(value) {
    if (!value || typeof value !== 'string') return '';
    let v = value.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

function configurado() {
    return Boolean(
        sanitizeEnv(process.env.SUPABASE_URL) &&
        sanitizeEnv(process.env.SUPABASE_SERVICE_KEY)
    );
}

// Devuelve null si algo falla, para que quien llame decida como degradar.
async function supabaseFetch(ruta, opciones = {}) {
    const url = sanitizeEnv(process.env.SUPABASE_URL);
    const key = sanitizeEnv(process.env.SUPABASE_SERVICE_KEY);
    if (!url || !key) return null;

    try {
        const res = await fetch(`${url}/rest/v1/${ruta}`, {
            ...opciones,
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                ...(opciones.headers || {})
            }
        });

        if (!res.ok) {
            console.warn('[supabase]', res.status, await res.text());
            return null;
        }
        return res.status === 204 ? [] : await res.json();
    } catch (err) {
        console.warn('[supabase] no disponible:', err.message);
        return null;
    }
}

// Igual que la anterior pero lanza en vez de devolver null: para cuando el
// fallo NO se puede tragar en silencio (abrir o cerrar una sesion, por ejemplo).
async function supabaseFetchEstricto(ruta, opciones = {}) {
    const url = sanitizeEnv(process.env.SUPABASE_URL);
    const key = sanitizeEnv(process.env.SUPABASE_SERVICE_KEY);
    if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY');

    const res = await fetch(`${url}/rest/v1/${ruta}`, {
        ...opciones,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...(opciones.headers || {})
        }
    });

    if (!res.ok) {
        throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? [] : res.json();
}

// Comparacion en tiempo constante: evita que se pueda adivinar el PIN
// midiendo cuanto tarda la respuesta.
function comparaSecreto(a, b) {
    const sa = String(a || '');
    const sb = String(b || '');
    if (sa.length !== sb.length) return false;
    let diff = 0;
    for (let i = 0; i < sa.length; i++) {
        diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
    }
    return diff === 0;
}

// El PIN del operador protege todo lo que no debe tocar un cliente.
function pinValido(pinRecibido) {
    const esperado = sanitizeEnv(process.env.ADMIN_PIN);
    if (!esperado) return false;
    // Se recorta tambien lo que llega: un espacio de mas al teclearlo en el
    // celular no deberia parecer un PIN equivocado.
    return comparaSecreto(String(pinRecibido || '').trim(), esperado);
}

function hayPinConfigurado() {
    return Boolean(sanitizeEnv(process.env.ADMIN_PIN));
}

module.exports = {
    sanitizeEnv,
    configurado,
    supabaseFetch,
    supabaseFetchEstricto,
    comparaSecreto,
    pinValido,
    hayPinConfigurado
};
