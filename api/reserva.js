// Reservas de la sala.
//
// Las reglas viven AQUI, no en el navegador. El formulario tambien las aplica
// para que el cliente no pierda el tiempo, pero quien decide es este archivo:
// si las comprobara solo el celular, bastaria con abrir la consola para
// apuntarse a una hora ocupada o pagar lo que uno quiera.
//
// Lo mas delicado es el solape. Dos personas pueden estar llenando el
// formulario a la vez para la misma hora; por eso se comprueba contra la base
// justo antes de insertar, con la clave secreta, y no se fia de lo que el
// navegador diga que estaba libre.

const { supabaseFetchEstricto, pinValido, hayPinConfigurado } = require('./_lib-supabase');
const { aplicarCors } = require('./_lib-http');
const { enviarMensaje } = require('./_lib-telegram');

// ---------------------------------------------------------------- las reglas
const ABRE_MIN      = 20 * 60;          // 20:00
const CIERRE_SEMANA = 24 * 60;          // domingo a jueves, medianoche
const CIERRE_FINDE  = 26 * 60;          // viernes y sabado, 2:00 de la madrugada
const ACOMODO_MIN   = 20;               // de regalo, para instalarse: el tiempo
                                        // contratado empieza a correr despues
const RECOGIDA_MIN  = 20;               // de regalo al final, para recoger
const LIMPIEZA_MIN  = 60;               // limpiar y preparar la sala
// Lo que tiene que caber entre el final de un grupo y la llegada del siguiente.
const MARGEN_MIN    = RECOGIDA_MIN + LIMPIEZA_MIN;
const PASO_MIN      = 30;               // las horas se ofrecen cada media hora

const HORAS_MIN   = 3;
const HORAS_MAX   = 8;
const BASE_USD    = 60;                 // las primeras 3 horas
const HORA_EXTRA  = 15;

// Cuando la tasa del BCV no responde se usa la ultima que se vio. No se cae la
// reserva por eso: el precio real es el del dolar y el bolivar es informativo.
let tasaEnCache = { valor: null, cuando: 0 };
const TASA_VIVE_MS = 60 * 60 * 1000;    // una hora

function cierreDe(fecha) {
    // El mediodia en UTC evita que la fecha se corra de dia por la zona horaria.
    const dia = new Date(fecha + 'T12:00:00Z').getUTCDay();   // 0 domingo ... 6 sabado
    return (dia === 5 || dia === 6) ? CIERRE_FINDE : CIERRE_SEMANA;
}

function precioDe(horas) {
    return BASE_USD + Math.max(0, horas - HORAS_MIN) * HORA_EXTRA;
}

// En am/pm: la hora militar obliga a traducir mentalmente, y quien reserva
// una noche piensa en "las 8", no en "las 20:00".
function comoHora(min) {
    const m24 = min % 1440;
    let h = Math.floor(m24 / 60);
    const m = m24 % 60;
    const sufijo = h < 12 ? 'am' : 'pm';
    h = h % 12 || 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + sufijo;
}

async function tasaBcv() {
    if (tasaEnCache.valor && Date.now() - tasaEnCache.cuando < TASA_VIVE_MS) {
        return tasaEnCache.valor;
    }
    try {
        const res = await fetch('https://ve.dolarapi.com/v1/dolares/oficial',
            { signal: AbortSignal.timeout(6000) });
        const j = await res.json();
        const v = Number(j && j.promedio);
        if (v > 0) {
            tasaEnCache = { valor: v, cuando: Date.now() };
            return v;
        }
    } catch (e) {
        console.warn('[reserva] no se pudo leer la tasa:', e.message);
    }
    return tasaEnCache.valor;      // la ultima conocida, o null si nunca hubo
}

async function ocupadoEn(fecha) {
    const filas = await supabaseFetchEstricto(
        'reservas?select=inicio_min,fin_min&fecha=eq.' + encodeURIComponent(fecha) +
        '&estado=in.(pendiente,confirmada)'
    );
    return filas || [];
}

// A que hora acaba de cantar un grupo que LLEGA a tal hora.
function finDe(inicio, horas) {
    return inicio + ACOMODO_MIN + horas * 60;
}

// Un hueco sirve si entre el final de una reserva y la llegada de la otra cabe
// la recogida mas la limpieza, mirado por los dos lados.
function chocaCon(ocupado, inicio, fin) {
    return ocupado.some((o) =>
        inicio < o.fin_min + MARGEN_MIN && o.inicio_min < fin + MARGEN_MIN
    );
}

function horasLibres(fecha, horas, ocupado) {
    const cierre = cierreDe(fecha);
    const libres = [];

    // El canto tiene que acabar antes del cierre. La recogida son 20 minutos
    // mas, que se perdonan: lo que no vale es seguir cantando pasada la hora.
    for (let ini = ABRE_MIN; finDe(ini, horas) <= cierre; ini += PASO_MIN) {
        if (!chocaCon(ocupado, ini, finDe(ini, horas))) {
            libres.push({ min: ini, texto: comoHora(ini) });
        }
    }
    return libres;
}


module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Método no permitido' });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
    }
    const accion = String(cuerpo?.accion || '');

    try {
        // ============================================= lo que ve el cliente
        if (accion === 'disponibilidad') {
            const fecha = String(cuerpo?.fecha || '');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
                return res.status(400).json({ ok: false, error: 'Fecha no válida' });
            }
            const horas = Math.min(HORAS_MAX, Math.max(HORAS_MIN, Number(cuerpo?.horas) || HORAS_MIN));

            return res.status(200).json({
                ok: true,
                horas: horasLibres(fecha, horas, await ocupadoEn(fecha)),
                cierre: comoHora(cierreDe(fecha)),
                tasa: await tasaBcv()
            });
        }

        if (accion === 'tasa') {
            return res.status(200).json({ ok: true, tasa: await tasaBcv() });
        }

        // ===================================================== crear la reserva
        if (accion === 'crear') {
            const fecha = String(cuerpo?.fecha || '');
            const inicio = Number(cuerpo?.inicio_min);
            const horas = Number(cuerpo?.horas);
            const nombre = String(cuerpo?.nombre || '').trim();
            const telefono = String(cuerpo?.telefono || '').trim();
            const comprobante = String(cuerpo?.comprobante || '').trim();

            if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
                return res.status(400).json({ ok: false, error: 'Falta la fecha.' });
            }
            if (!Number.isInteger(inicio) || inicio < ABRE_MIN) {
                return res.status(400).json({ ok: false, error: 'Falta la hora de inicio.' });
            }
            if (!Number.isInteger(horas) || horas < HORAS_MIN || horas > HORAS_MAX) {
                return res.status(400).json({ ok: false, error: 'Las horas no son válidas.' });
            }
            if (nombre.length < 2) {
                return res.status(400).json({ ok: false, error: 'Falta tu nombre.' });
            }
            if (telefono.replace(/\D/g, '').length < 10) {
                return res.status(400).json({ ok: false, error: 'Falta un teléfono válido.' });
            }
            // Sin comprobante no hay reserva. Es lo que evita que alguien
            // aparte una hora y no aparezca nunca.
            if (!comprobante) {
                return res.status(400).json({ ok: false, error: 'Falta el comprobante del abono.' });
            }

            const fin = finDe(inicio, horas);
            if (fin > cierreDe(fecha)) {
                return res.status(400).json({
                    ok: false,
                    error: 'Esa hora se pasa del cierre (' + comoHora(cierreDe(fecha)) + ').'
                });
            }

            // La comprobacion que de verdad manda: contra la base, ahora mismo.
            if (chocaCon(await ocupadoEn(fecha), inicio, fin)) {
                return res.status(409).json({
                    ok: false,
                    ocupado: true,
                    error: 'Alguien acaba de reservar esa hora. Elige otra, por favor.'
                });
            }

            const total = precioDe(horas);
            const abono = Math.round(total * 50) / 100;
            const tasa = await tasaBcv();

            const creada = await supabaseFetchEstricto('reservas', {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({
                    fecha, inicio_min: inicio, fin_min: fin, horas,
                    nombre: nombre.slice(0, 60),
                    telefono: telefono.slice(0, 25),
                    total_usd: total,
                    abono_usd: abono,
                    tasa_bs: tasa,
                    comprobante_url: comprobante.slice(0, 400)
                })
            });

            const id = (creada && creada[0] && creada[0].id) || '?';

            // El aviso. Si Telegram falla, la reserva YA esta guardada: se le
            // dice que si al cliente igual y Javier la vera en el panel.
            const aviso = await enviarMensaje(
                '🎤 RESERVA NUEVA  #' + id + '\n\n' +
                '📅 ' + fecha + '\n' +
                '🕗 Llegan ' + comoHora(inicio) + '\n' +
                '🎵 Cantan ' + comoHora(inicio + ACOMODO_MIN) + ' a ' + comoHora(fin) +
                '  (' + horas + ' h)\n\n' +
                '👤 ' + nombre + '\n' +
                '📱 ' + telefono + '\n\n' +
                '💵 Total $' + total + '  ·  abonó $' + abono + '\n' +
                '📎 Comprobante subido: revísalo en el panel.'
            );
            if (!aviso.ok) console.warn('[reserva] telegram:', aviso.error);

            return res.status(200).json({ ok: true, id, total, abono });
        }

        // ================================================ lo del panel, con PIN
        if (!hayPinConfigurado()) {
            return res.status(500).json({ ok: false, sinConfigurar: true, error: 'Falta ADMIN_PIN en Vercel.' });
        }
        if (!pinValido(cuerpo?.pin)) {
            return res.status(401).json({ ok: false, error: 'PIN incorrecto' });
        }

        if (accion === 'listar') {
            const filas = await supabaseFetchEstricto(
                'reservas?select=*&order=fecha.desc,inicio_min.desc&limit=200'
            );
            return res.status(200).json({ ok: true, reservas: filas || [] });
        }

        if (accion === 'confirmar' || accion === 'cancelar') {
            const id = Number(cuerpo?.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ ok: false, error: 'Falta el id' });
            }
            await supabaseFetchEstricto('reservas?id=eq.' + id, {
                method: 'PATCH',
                body: JSON.stringify({
                    estado: accion === 'confirmar' ? 'confirmada' : 'cancelada'
                })
            });
            return res.status(200).json({ ok: true });
        }

        // El comprobante vive en un bucket privado: se devuelve un enlace que
        // caduca, en vez de hacer publico el deposito entero.
        if (accion === 'comprobante') {
            const ruta = String(cuerpo?.ruta || '');
            if (!ruta) return res.status(400).json({ ok: false, error: 'Falta la ruta' });

            const url = process.env.SUPABASE_URL;
            const key = process.env.SUPABASE_SERVICE_KEY;
            const r = await fetch(url + '/storage/v1/object/sign/comprobantes/' + ruta, {
                method: 'POST',
                headers: {
                    apikey: key,
                    Authorization: 'Bearer ' + key,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ expiresIn: 600 })     // diez minutos
            });
            if (!r.ok) throw new Error('firmar: ' + r.status);
            const j = await r.json();
            return res.status(200).json({ ok: true, url: url + '/storage/v1' + j.signedURL });
        }

        return res.status(400).json({ ok: false, error: 'Acción no válida' });

    } catch (err) {
        console.error('[reserva]', err);
        const texto = String(err.message || '');

        if (/PGRST205|42P01|does not exist|Could not find the table/i.test(texto)) {
            return res.status(500).json({
                ok: false, faltaSql: true,
                error: 'Falta ejecutar sql/012-reservas.sql en Supabase.'
            });
        }
        // El motivo de verdad va tambien en la respuesta. Un "no se pudo" a
        // secas obliga a adivinar, y aqui lo que falla suele ser una columna
        // o una restriccion que no cuadra: conviene poder leerlo.
        return res.status(500).json({
            ok: false,
            error: 'No se pudo completar la reserva',
            motivo: texto.slice(0, 300)
        });
    }
};
