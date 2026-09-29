// Recibe un pedido de la tienda: lo guarda y avisa por Telegram.
//
// REGLA QUE NO SE NEGOCIA: los precios NO vienen del navegador. Del cliente
// solo se acepta que producto y cuantos; el precio se vuelve a leer de la base
// de datos aqui. Si se confiara en lo que manda la pagina, cualquiera podria
// pedir cuatro cocas a un centimo editando la peticion.
//
// El orden importa: primero se guarda en Supabase, despues se manda a Telegram.
// Si Telegram esta caido, el pedido ya existe y se puede ver en la base; al
// contrario se perderia.

const { supabaseFetchEstricto, configurado } = require('./_lib-supabase');
const { obtenerTasa } = require('./_lib-tasa');
const { enviarMensaje } = require('./_lib-telegram');
const { aplicarCors } = require('./_lib-http');

const MAX_LINEAS = 50;
const MAX_CANTIDAD = 99;

function texto(valor, maximo) {
    return String(valor == null ? '' : valor).trim().replace(/\s+/g, ' ').slice(0, maximo);
}

// Bolivares al estilo de aqui: punto para los miles, coma para los decimales.
// Se formatea a mano y no con toLocaleString para no depender de que el
// servidor de Vercel tenga los datos de idioma completos.
function formatearBs(n) {
    const fijo = Number(n).toFixed(2);
    const [entero, decimales] = fijo.split('.');
    const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${conMiles},${decimales}`;
}

function formatearUsd(n) {
    return Number(n).toFixed(2);
}

function armarMensaje(pedido) {
    const lineas = pedido.lineas
        .map((l) => `• ${l.cantidad} x ${l.nombre} — $${formatearUsd(l.subtotal_usd)}`)
        .join('\n');

    const partes = [
        '🛒 NUEVO PEDIDO — Tienda',
        '',
        `👤 ${pedido.nombre}`,
        `📍 ${pedido.ubicacion}`,
        '',
        lineas,
        '',
        `TOTAL: $${formatearUsd(pedido.total_usd)}`
    ];

    if (pedido.total_bs != null && pedido.tasa_bs != null) {
        const nota = pedido.tasa_fuente === 'manual' ? 'tasa manual' : 'tasa BCV';
        partes.push(`Ref. Bs ${formatearBs(pedido.total_bs)} (${nota} ${formatearBs(pedido.tasa_bs)})`);
    }

    partes.push('', `Pedido #${pedido.id}`);
    return partes.join('\n');
}

module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Metodo no permitido' });
    }

    if (!configurado()) {
        return res.status(500).json({
            ok: false,
            error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en Vercel'
        });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
    }

    const nombre = texto(cuerpo?.nombre, 60);
    const ubicacion = texto(cuerpo?.ubicacion, 80);

    if (nombre.length < 2) {
        return res.status(400).json({ ok: false, error: 'Escribe tu nombre' });
    }
    if (ubicacion.length < 2) {
        return res.status(400).json({ ok: false, error: 'Escribe desde donde pides' });
    }

    const items = Array.isArray(cuerpo?.items) ? cuerpo.items : [];
    if (items.length === 0) {
        return res.status(400).json({ ok: false, error: 'El carrito esta vacio' });
    }
    if (items.length > MAX_LINEAS) {
        return res.status(400).json({ ok: false, error: 'Demasiados productos distintos' });
    }

    // Se juntan las cantidades por id: si la pagina manda el mismo producto dos
    // veces, se suma en vez de crear dos lineas iguales.
    const pedidas = new Map();
    for (const item of items) {
        const id = Number(item?.id);
        const cantidad = Math.floor(Number(item?.cantidad));

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ ok: false, error: 'Producto no valido' });
        }
        if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) {
            return res.status(400).json({ ok: false, error: 'Cantidad no valida' });
        }

        pedidas.set(id, Math.min(MAX_CANTIDAD, (pedidas.get(id) || 0) + cantidad));
    }

    const ids = [...pedidas.keys()];

    let productos;
    try {
        productos = await supabaseFetchEstricto(
            `tienda_productos?id=in.(${ids.join(',')})&activo=eq.true` +
            '&select=id,nombre,precio_usd'
        );
    } catch (err) {
        console.error('[tienda-pedido] al leer productos:', err);
        return res.status(503).json({ ok: false, error: 'No se pudo confirmar el pedido' });
    }

    const porId = new Map((productos || []).map((p) => [Number(p.id), p]));

    // Un producto que se agoto o se desactivo mientras el cliente llenaba el
    // carrito: se le dice cual, no un error generico.
    const faltantes = ids.filter((id) => !porId.has(id));
    if (faltantes.length > 0) {
        return res.status(409).json({
            ok: false,
            error: 'Alguno de los productos ya no esta disponible. Vuelve a cargar la tienda.',
            no_disponibles: faltantes
        });
    }

    const lineas = ids.map((id) => {
        const producto = porId.get(id);
        const cantidad = pedidas.get(id);
        const precio = Number(producto.precio_usd);
        return {
            producto_id: id,
            nombre: producto.nombre,
            precio_usd: Number(precio.toFixed(2)),
            cantidad,
            subtotal_usd: Number((precio * cantidad).toFixed(2))
        };
    });

    const totalUsd = Number(lineas.reduce((s, l) => s + l.subtotal_usd, 0).toFixed(2));

    const { tasa, fuente } = await obtenerTasa();
    const totalBs = tasa ? Number((totalUsd * tasa).toFixed(2)) : null;

    let guardado;
    try {
        const filas = await supabaseFetchEstricto('tienda_pedidos', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
                nombre,
                ubicacion,
                lineas,
                total_usd: totalUsd,
                tasa_bs: tasa,
                total_bs: totalBs,
                tasa_fuente: fuente
            })
        });
        guardado = Array.isArray(filas) ? filas[0] : filas;
    } catch (err) {
        console.error('[tienda-pedido] al guardar:', err);
        return res.status(503).json({ ok: false, error: 'No se pudo registrar el pedido' });
    }

    const aviso = await enviarMensaje(armarMensaje({
        id: guardado?.id ?? '—',
        nombre,
        ubicacion,
        lineas,
        total_usd: totalUsd,
        total_bs: totalBs,
        tasa_bs: tasa,
        tasa_fuente: fuente
    }));

    // El pedido esta guardado, asi que la respuesta es ok aunque Telegram
    // falle. Se avisa igual para que la tienda pueda decirle al cliente que
    // confirme de viva voz.
    return res.status(200).json({
        ok: true,
        pedido_id: guardado?.id ?? null,
        total_usd: totalUsd,
        total_bs: totalBs,
        avisado: aviso.ok,
        aviso_error: aviso.ok ? undefined : (aviso.telegramDescription || aviso.error)
    });
};
