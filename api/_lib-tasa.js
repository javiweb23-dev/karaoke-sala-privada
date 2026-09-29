// La tasa del BCV, para mostrar la referencia en bolivares.
//
// ORDEN DE PREFERENCIA:
//   1. Tasa manual, si el operador la activo en el panel. Manda siempre.
//   2. Cache en memoria (10 min), para no golpear las APIs en cada visita.
//   3. ve.dolarapi.com (devuelve la tasa del BCV directamente)
//   4. open.er-api.com (proveedor distinto, por si el primero se cae entero)
//   5. La ultima tasa que se logro traer, guardada en tienda_config.
//   6. Nada: la tienda muestra solo dolares y sigue vendiendo.
//
// Los pasos 3 y 4 son APIs gratuitas y ajenas: se caen, y a veces para siempre.
// El respaldo anterior era pydolarve.org y su dominio dejo de resolver, asi que
// los dos son de proveedores distintos a proposito. Por eso existe el paso 1.
// Lo que no puede pasar nunca es que la tienda deje de vender porque una web
// ajena esta caida.
//
// El prefijo _ evita que Vercel lo publique como endpoint.

const { supabaseFetch } = require('./_lib-supabase');

const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 4000;

// Vive mientras la funcion siga caliente en Vercel. No es fiable ni hace
// falta que lo sea: si se pierde, se vuelve a pedir la tasa y ya.
let cache = { tasa: null, fuente: null, en: 0 };

// Sin esto, una API colgada dejaria la tienda cargando hasta que Vercel corte
// la funcion entera a los 10 segundos.
async function fetchConLimite(url) {
    const ac = new AbortController();
    const reloj = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: ac.signal,
            headers: { Accept: 'application/json' }
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn('[tasa] fallo', url, err.message);
        return null;
    } finally {
        clearTimeout(reloj);
    }
}

function numeroValido(v) {
    const n = Number(v);
    // Una tasa de 0 o negativa es un error de la API, no un dato. El techo es
    // por si algun dia devuelven los centimos juntos o un campo equivocado.
    return Number.isFinite(n) && n > 0 && n < 100000000 ? n : null;
}

// Aqui "promedio" va primero y no es un detalle: compra y venta vienen en null
// en esta API, asi que leerlas antes daria siempre nada.
async function desdeDolarApi() {
    const data = await fetchConLimite('https://ve.dolarapi.com/v1/dolares/oficial');
    if (!data) return null;
    return numeroValido(data.promedio ?? data.venta ?? data.compra);
}

async function desdeErApi() {
    const data = await fetchConLimite('https://open.er-api.com/v6/latest/USD');
    if (!data) return null;
    return numeroValido(data?.rates?.VES);
}

async function leerConfig() {
    const filas = await supabaseFetch(
        'tienda_config?id=eq.1&select=usar_tasa_manual,tasa_manual,tasa_cache,tasa_cache_en&limit=1'
    );
    return filas && filas.length ? filas[0] : null;
}

// Se guarda para que sirva de paracaidas en despliegues futuros, cuando la
// cache en memoria ya no exista. Si falla, da igual: es un extra.
async function guardarCache(tasa) {
    await supabaseFetch('tienda_config?id=eq.1', {
        method: 'PATCH',
        body: JSON.stringify({
            tasa_cache: tasa,
            tasa_cache_en: new Date().toISOString(),
            actualizado_en: new Date().toISOString()
        })
    });
}

// Devuelve siempre un objeto, nunca lanza:
//   { tasa: number|null, fuente: 'manual'|'dolarapi'|'pydolarve'|'cache'|'ninguna' }
async function obtenerTasa() {
    let config = null;
    try {
        config = await leerConfig();
    } catch (err) {
        console.warn('[tasa] no se pudo leer tienda_config:', err.message);
    }

    // 1. Manual: si el operador la puso, es la que vale. Ni se consulta internet.
    if (config && config.usar_tasa_manual) {
        const manual = numeroValido(config.tasa_manual);
        if (manual) return { tasa: manual, fuente: 'manual' };
    }

    // 2. Cache en memoria.
    if (cache.tasa && Date.now() - cache.en < CACHE_MS) {
        return { tasa: cache.tasa, fuente: cache.fuente };
    }

    // 3 y 4. Las APIs, en orden.
    const intentos = [
        ['dolarapi', desdeDolarApi],
        ['erapi', desdeErApi]
    ];

    for (const [fuente, traer] of intentos) {
        const tasa = await traer();
        if (tasa) {
            cache = { tasa, fuente, en: Date.now() };
            guardarCache(tasa).catch(() => {});
            return { tasa, fuente };
        }
    }

    // 5. Lo ultimo que se supo. Mejor una tasa de ayer que ninguna.
    const guardada = config ? numeroValido(config.tasa_cache) : null;
    if (guardada) return { tasa: guardada, fuente: 'cache' };

    // 6. Sin referencia. La tienda muestra solo dolares.
    return { tasa: null, fuente: 'ninguna' };
}

module.exports = { obtenerTasa };
