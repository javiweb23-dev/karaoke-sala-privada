// Gestion de la tienda: productos, fotos y tasa manual.
//
// LLEVA SU PROPIA CLAVE, distinta a la del operador. No es lo mismo dejar que
// alguien pause una cancion que dejarle cambiar los precios: el ADMIN_PIN lo
// tiene quien maneje la consola esa noche, y con el no se debe poder tocar el
// menu. Por eso aqui manda TIENDA_PIN y solo eso.
//
// Variables de entorno en Vercel:
//   TIENDA_PIN             (NUEVA — la clave del menu, distinta de ADMIN_PIN)
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

const {
    sanitizeEnv,
    supabaseFetch,
    supabaseFetchEstricto,
    configurado,
    comparaSecreto
} = require('./_lib-supabase');
const { obtenerTasa } = require('./_lib-tasa');
const { aplicarCors } = require('./_lib-http');

const BUCKET = 'tienda';
const TIPOS_IMAGEN = {
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/png': 'png'
};
// 3 MB. La pagina reduce la foto antes de subirla, asi que llegar a esto
// significa que algo no funciono y es mejor cortarlo que tragarlo.
const MAX_BYTES = 3 * 1024 * 1024;

function texto(valor, maximo) {
    return String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ').slice(0, maximo);
}

function hayClaveTienda() {
    return Boolean(sanitizeEnv(process.env.TIENDA_PIN));
}

// Comparacion en tiempo constante, igual que el PIN del operador: sin ella se
// podria adivinar la clave midiendo cuanto tarda la respuesta.
function claveTiendaValida(recibida) {
    const esperada = sanitizeEnv(process.env.TIENDA_PIN);
    if (!esperada) return false;
    return comparaSecreto(String(recibida || '').trim(), esperada);
}

function precioValido(valor) {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
    return Number(n.toFixed(2));
}

// El Storage no esta bajo /rest/v1/, asi que no sirve supabaseFetch.
async function storageFetch(ruta, opciones = {}) {
    const url = sanitizeEnv(process.env.SUPABASE_URL);
    const key = sanitizeEnv(process.env.SUPABASE_SERVICE_KEY);
    if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY');

    const res = await fetch(`${url}/storage/v1/${ruta}`, {
        ...opciones,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            ...(opciones.headers || {})
        }
    });

    if (!res.ok) {
        throw new Error(`Storage ${res.status}: ${await res.text()}`);
    }
    return res;
}

function urlPublica(ruta) {
    const url = sanitizeEnv(process.env.SUPABASE_URL);
    return `${url}/storage/v1/object/public/${BUCKET}/${ruta}`;
}

// Saca la ruta dentro del bucket a partir de la URL publica. Devuelve null si
// la foto no es nuestra (por si alguna vez se pega una URL de fuera): asi no se
// intenta borrar algo que no nos pertenece.
function rutaDesdeUrl(imagenUrl) {
    const marca = `/storage/v1/object/public/${BUCKET}/`;
    const i = String(imagenUrl || '').indexOf(marca);
    return i === -1 ? null : imagenUrl.slice(i + marca.length);
}

async function borrarImagen(imagenUrl) {
    const ruta = rutaDesdeUrl(imagenUrl);
    if (!ruta) return;
    try {
        await storageFetch(`object/${BUCKET}/${ruta}`, { method: 'DELETE' });
    } catch (err) {
        // Una foto huerfana en el bucket no rompe nada. No vale la pena hacer
        // fallar el borrado del producto por esto.
        console.warn('[tienda-admin] no se pudo borrar la foto:', err.message);
    }
}

async function listarTodo() {
    const productos = await supabaseFetchEstricto(
        'tienda_productos?select=id,nombre,descripcion,precio_usd,imagen_url,activo,orden' +
        '&order=orden.asc,id.asc'
    );

    const filas = await supabaseFetch(
        'tienda_config?id=eq.1&select=usar_tasa_manual,tasa_manual&limit=1'
    );
    const config = filas && filas.length ? filas[0] : {};
    const tasa = await obtenerTasa();

    return {
        ok: true,
        productos: (productos || []).map((p) => ({
            ...p,
            precio_usd: Number(p.precio_usd)
        })),
        config: {
            usar_tasa_manual: Boolean(config.usar_tasa_manual),
            tasa_manual: config.tasa_manual == null ? null : Number(config.tasa_manual)
        },
        tasa: tasa.tasa,
        tasa_fuente: tasa.fuente
    };
}

// El orden nuevo es el ultimo + 1: el producto recien creado aparece al final,
// que es donde uno espera encontrarlo.
async function siguienteOrden() {
    const filas = await supabaseFetch('tienda_productos?select=orden&order=orden.desc&limit=1');
    const ultimo = filas && filas.length ? Number(filas[0].orden) : 0;
    return (Number.isFinite(ultimo) ? ultimo : 0) + 1;
}

async function crear(datos) {
    const nombre = texto(datos?.nombre, 80);
    if (nombre.length < 2) return { ok: false, error: 'Ponle un nombre al producto' };

    const precio = precioValido(datos?.precio_usd);
    if (precio === null) return { ok: false, error: 'Precio no valido' };

    const filas = await supabaseFetchEstricto('tienda_productos', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
            nombre,
            descripcion: texto(datos?.descripcion, 300),
            precio_usd: precio,
            imagen_url: datos?.imagen_url ? String(datos.imagen_url).slice(0, 500) : null,
            activo: datos?.activo !== false,
            orden: await siguienteOrden()
        })
    });

    return { ok: true, producto: Array.isArray(filas) ? filas[0] : filas };
}

async function editar(datos) {
    const id = Number(datos?.id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Producto no valido' };

    // Solo se escriben los campos que vinieron: asi el interruptor de activar
    // no tiene que mandar el precio ni la descripcion para no borrarlos.
    const cambios = {};

    if (datos.nombre !== undefined) {
        const nombre = texto(datos.nombre, 80);
        if (nombre.length < 2) return { ok: false, error: 'Ponle un nombre al producto' };
        cambios.nombre = nombre;
    }

    if (datos.descripcion !== undefined) {
        cambios.descripcion = texto(datos.descripcion, 300);
    }

    if (datos.precio_usd !== undefined) {
        const precio = precioValido(datos.precio_usd);
        if (precio === null) return { ok: false, error: 'Precio no valido' };
        cambios.precio_usd = precio;
    }

    if (datos.activo !== undefined) {
        cambios.activo = Boolean(datos.activo);
    }

    if (datos.imagen_url !== undefined) {
        cambios.imagen_url = datos.imagen_url ? String(datos.imagen_url).slice(0, 500) : null;
    }

    if (Object.keys(cambios).length === 0) {
        return { ok: false, error: 'No hay nada que cambiar' };
    }

    const filas = await supabaseFetchEstricto(`tienda_productos?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(cambios)
    });

    const producto = Array.isArray(filas) ? filas[0] : filas;
    if (!producto) return { ok: false, error: 'Ese producto ya no existe' };

    return { ok: true, producto };
}

async function borrar(datos) {
    const id = Number(datos?.id);
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Producto no valido' };

    const filas = await supabaseFetchEstricto(
        `tienda_productos?id=eq.${id}&select=imagen_url`
    );
    const previo = filas && filas.length ? filas[0] : null;

    await supabaseFetchEstricto(`tienda_productos?id=eq.${id}`, { method: 'DELETE' });

    if (previo && previo.imagen_url) await borrarImagen(previo.imagen_url);

    // Los pedidos viejos no se tocan: guardan el nombre y el precio por su
    // cuenta, justamente para que borrar un producto no deforme el historial.
    return { ok: true };
}

// Subir o bajar un producto en la lista, intercambiando el orden con el vecino.
// Se hace asi y no arrastrando porque arrastrar en un celular con el dedo es
// una loteria, y esto son cuatro o cinco productos.
async function mover(datos) {
    const id = Number(datos?.id);
    const arriba = datos?.direccion === 'arriba';
    if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Producto no valido' };

    const todos = await supabaseFetchEstricto(
        'tienda_productos?select=id,orden&order=orden.asc,id.asc'
    );
    const lista = todos || [];
    const i = lista.findIndex((p) => Number(p.id) === id);
    if (i === -1) return { ok: false, error: 'Ese producto ya no existe' };

    const j = arriba ? i - 1 : i + 1;
    if (j < 0 || j >= lista.length) return { ok: true, sin_cambios: true };

    // Se reescribe el orden de toda la lista con la posicion nueva. Intercambiar
    // solo los dos valores falla cuando varios productos comparten el mismo
    // orden, que es lo que pasa tras ejecutar el SQL de arranque dos veces.
    const reordenada = [...lista];
    [reordenada[i], reordenada[j]] = [reordenada[j], reordenada[i]];

    for (let k = 0; k < reordenada.length; k++) {
        await supabaseFetchEstricto(`tienda_productos?id=eq.${reordenada[k].id}`, {
            method: 'PATCH',
            body: JSON.stringify({ orden: k + 1 })
        });
    }

    return { ok: true };
}

async function subirImagen(datos) {
    const tipo = String(datos?.tipo || '').toLowerCase();
    const extension = TIPOS_IMAGEN[tipo];
    if (!extension) {
        return { ok: false, error: 'Formato no admitido. Usa JPG, PNG o WEBP.' };
    }

    const base64 = String(datos?.datos_base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) return { ok: false, error: 'No llego la imagen' };

    let bytes;
    try {
        bytes = Buffer.from(base64, 'base64');
    } catch (err) {
        return { ok: false, error: 'La imagen llego dañada' };
    }

    if (bytes.length === 0) return { ok: false, error: 'No llego la imagen' };
    if (bytes.length > MAX_BYTES) return { ok: false, error: 'La imagen es demasiado grande' };

    // Nombre inventado aqui, nunca el del archivo original: un nombre con
    // barras o puntos podria escribir fuera de la carpeta del bucket.
    const ruta = `productos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

    await storageFetch(`object/${BUCKET}/${ruta}`, {
        method: 'POST',
        headers: {
            'Content-Type': tipo,
            'Cache-Control': 'public, max-age=31536000'
        },
        body: bytes
    });

    return { ok: true, imagen_url: urlPublica(ruta) };
}

async function guardarTasa(datos) {
    const usar = Boolean(datos?.usar_tasa_manual);
    let manual = null;

    if (datos?.tasa_manual !== undefined && datos.tasa_manual !== null && datos.tasa_manual !== '') {
        const n = Number(datos.tasa_manual);
        if (!Number.isFinite(n) || n <= 0 || n > 100000000) {
            return { ok: false, error: 'Tasa no valida' };
        }
        manual = Number(n.toFixed(4));
    }

    if (usar && manual === null) {
        return { ok: false, error: 'Escribe la tasa antes de activarla' };
    }

    await supabaseFetchEstricto('tienda_config?id=eq.1', {
        method: 'PATCH',
        body: JSON.stringify({
            usar_tasa_manual: usar,
            tasa_manual: manual,
            actualizado_en: new Date().toISOString()
        })
    });

    const tasa = await obtenerTasa();
    return { ok: true, tasa: tasa.tasa, tasa_fuente: tasa.fuente };
}

const ACCIONES = {
    listar: listarTodo,
    crear,
    editar,
    borrar,
    mover,
    subir_imagen: subirImagen,
    guardar_tasa: guardarTasa
};

module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Metodo no permitido' });
    }

    res.setHeader('Cache-Control', 'no-store');

    if (!configurado()) {
        return res.status(500).json({
            ok: false,
            sinConfigurar: true,
            error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en Vercel'
        });
    }

    // Sin TIENDA_PIN no se abre con el del operador "para que al menos
    // funcione": eso es justo lo que se quiere evitar. Se dice que falta y ya.
    if (!hayClaveTienda()) {
        return res.status(500).json({
            ok: false,
            sinConfigurar: true,
            error: 'Falta TIENDA_PIN en Vercel. Agregala en Settings > Environment ' +
                   'Variables (Production) y vuelve a desplegar.'
        });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
    }

    if (!claveTiendaValida(cuerpo?.pin)) {
        // Retraso fijo: probar claves a mano deja de ser comodo.
        await new Promise((r) => setTimeout(r, 700));
        return res.status(401).json({ ok: false, error: 'Clave incorrecta' });
    }

    const accion = ACCIONES[String(cuerpo?.accion || '')];
    if (!accion) {
        return res.status(400).json({ ok: false, error: 'Accion desconocida' });
    }

    try {
        const resultado = await accion(cuerpo);
        return res.status(resultado.ok ? 200 : 400).json(resultado);
    } catch (err) {
        console.error('[tienda-admin]', err);
        const mensaje = String(err.message || '');

        if (/PGRST205|42P01|does not exist|Could not find the table/i.test(mensaje)) {
            return res.status(503).json({
                ok: false,
                faltaSql: true,
                error: 'Falta ejecutar sql/011-tienda.sql en Supabase'
            });
        }

        if (/Bucket not found/i.test(mensaje)) {
            return res.status(503).json({
                ok: false,
                faltaSql: true,
                error: 'Falta el bucket de fotos. Ejecuta sql/011-tienda.sql en Supabase.'
            });
        }

        return res.status(500).json({ ok: false, error: 'No se pudo completar la operacion' });
    }
};
