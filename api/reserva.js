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

const { supabaseFetchEstricto, claveAdminValida, hayClaveAdmin,
        sanitizeEnv } = require('./_lib-supabase');
const { aplicarCors } = require('./_lib-http');
const { enviarMensaje } = require('./_lib-telegram');

// ---------------------------------------------------------------- las reglas
const ABRE_MIN      = 20 * 60;          // 20:00
const CIERRE_SEMANA = 24 * 60;          // domingo a jueves, medianoche
const CIERRE_FINDE  = 26 * 60;          // viernes y sabado, 2:00 de la madrugada
const ACOMODO_MIN   = 20;               // de regalo, para instalarse: el tiempo
                                        // contratado empieza a correr despues
const RECOGIDA_MIN  = 20;               // de regalo al final, para recoger
const LIMPIEZA_MIN  = 40;               // limpiar y preparar la sala
// Lo que tiene que caber entre el final de un grupo y la llegada del siguiente.
const MARGEN_MIN    = RECOGIDA_MIN + LIMPIEZA_MIN;
const PASO_MIN      = 30;               // las horas se ofrecen cada media hora

// La tarifa: $2 por persona y por hora.
//
// Antes era precio cerrado por la sala (2h $40, 3h $60, 4h $70). Ahora paga
// cada cabeza, asi que un grupo pequeno sale mucho mas barato y uno grande
// paga mas. El minimo existe porque la sala se ocupa entera venga quien
// venga: quien quiera cantar solo puede, pero paga como si fueran cuatro.
//
// Si cambia, se cambia AQUI y en reserva-comun.js. Hay una prueba en
// scripts/probar-sistema.js que compara los dos sitios.
const PRECIO_PERSONA_HORA = 2;
const MIN_PERSONAS = 4;
const MAX_PERSONAS = 14;          // lo que cabe en la sala

// A partir de este total va de regalo una racion de tequenos y un refresco
// de dos litros. Mismo numero en reserva-comun.js.
const COMBO_DESDE = 50;

// Nunca se alquila una sola hora.
const HORAS_MIN = 2;
const HORAS_MAX = 4;
const DURACIONES = [];
for (let h = HORAS_MIN; h <= HORAS_MAX; h++) DURACIONES.push(h);

// Cuando la tasa del BCV no responde se usa la ultima que se vio. No se cae la
// reserva por eso: el precio real es el del dolar y el bolivar es informativo.
let tasaEnCache = { valor: null, cuando: 0 };
const TASA_VIVE_MS = 60 * 60 * 1000;    // una hora

function cierreDe(fecha) {
    // El mediodia en UTC evita que la fecha se corra de dia por la zona horaria.
    const dia = new Date(fecha + 'T12:00:00Z').getUTCDay();   // 0 domingo ... 6 sabado
    return (dia === 5 || dia === 6) ? CIERRE_FINDE : CIERRE_SEMANA;
}

// Cuantas se COBRAN, que no es lo mismo que cuantas vienen.
function personasCobradas(personas) {
    return Math.max(MIN_PERSONAS, Number(personas) || 0);
}

function duracionValida(horas) {
    return DURACIONES.indexOf(horas) !== -1;
}

function precioDe(horas, personas) {
    if (!duracionValida(horas)) return null;    // duracion que no vendemos
    return PRECIO_PERSONA_HORA * horas * personasCobradas(personas);
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

// El nombre del archivo lo pone el navegador, asi que se mira con lupa: solo
// letras, numeros, punto y guion. Sin esto se podria pedir "../otra-cosa" y
// asomarse a otros sitios del deposito.
//
// Sigue haciendo falta para el panel: las reservas VIEJAS si tienen
// comprobante subido y Javier tiene que poder abrirlo. Lo que se fue es la
// comprobacion al crear la reserva, porque ya no se sube ninguno.
const NOMBRE_LIMPIO = /^[A-Za-z0-9._-]{5,120}$/;

// Solo bloquean el horario las CONFIRMADAS.
//
// Antes bloqueaban tambien las pendientes, y tenia sentido: no se podia
// reservar sin subir el comprobante del 50%, asi que una pendiente era una
// reserva pagada a medias y merecia guardar el sitio.
//
// Ahora no se paga nada por la web, asi que cualquiera podria apartar todos
// los sabados del mes sin poner un bolivar. Una reserva se queda en
// pendiente hasta que Javier cobra y la confirma desde el panel; hasta
// entonces el horario se le sigue ofreciendo a los demas.
async function ocupadoEn(fecha) {
    const filas = await supabaseFetchEstricto(
        'reservas?select=inicio_min,fin_min&fecha=eq.' + encodeURIComponent(fecha) +
        '&estado=eq.confirmada'
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
            const pedidas = Number(cuerpo?.horas);
            const horas = duracionValida(pedidas) ? pedidas : HORAS_MIN;

            const ocupado = await ocupadoEn(fecha);
            const libres = horasLibres(fecha, horas, ocupado);

            // Si para esa duracion no queda sitio, se mira si cabe una mas
            // corta. Decirle "solo quedan 2 horas" es mucho mas util que un
            // "no hay" a secas: muchas veces el cliente acepta y reserva igual,
            // y si no se lo decimos se va creyendo que la noche esta llena.
            const alternativas = libres.length ? [] : DURACIONES.filter(
                (h) => h < horas && horasLibres(fecha, h, ocupado).length > 0
            );

            return res.status(200).json({
                ok: true,
                horas: libres,
                alternativas,
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
            const personas = Number(cuerpo?.personas);

            if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
                return res.status(400).json({ ok: false, error: 'Falta la fecha.' });
            }
            if (!Number.isInteger(inicio) || inicio < ABRE_MIN) {
                return res.status(400).json({ ok: false, error: 'Falta la hora de inicio.' });
            }
            if (!duracionValida(horas)) {
                return res.status(400).json({
                    ok: false,
                    error: 'Esa duración no está disponible (' + DURACIONES.join(', ') + ' horas).'
                });
            }
            if (!Number.isInteger(personas) || personas < 1 || personas > MAX_PERSONAS) {
                return res.status(400).json({
                    ok: false,
                    error: 'Dinos cuántos son (de 1 a ' + MAX_PERSONAS + ').'
                });
            }
            if (nombre.length < 2) {
                return res.status(400).json({ ok: false, error: 'Falta tu nombre.' });
            }
            if (telefono.replace(/\D/g, '').length < 10) {
                return res.status(400).json({ ok: false, error: 'Falta un teléfono válido.' });
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

            const total = precioDe(horas, personas);
            const tasa = await tasaBcv();

            const creada = await supabaseFetchEstricto('reservas', {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({
                    fecha, inicio_min: inicio, fin_min: fin, horas,
                    personas,
                    nombre: nombre.slice(0, 60),
                    telefono: telefono.slice(0, 25),
                    total_usd: total,
                    // Se guarda en cero: ya no hay abono, se cobra todo por
                    // WhatsApp antes de confirmar. La columna se queda por las
                    // reservas viejas (ver sql/017).
                    abono_usd: 0,
                    tasa_bs: tasa
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
                '📱 ' + telefono + '\n' +
                '👥 ' + personas + (personas < MIN_PERSONAS
                    ? ' (se cobran ' + MIN_PERSONAS + ')' : '') + '\n\n' +
                '💵 Total $' + total + '  ·  $' +
                    (Math.round(total / personas * 100) / 100) + ' cada uno\n' +
                (total >= COMBO_DESDE ? '🎁 Lleva tequeños y refresco\n' : '') +
                '⏳ SIN PAGAR todavía. No bloquea el horario hasta que la confirmes.'
            );
            if (!aviso.ok) console.warn('[reserva] telegram:', aviso.error);

            return res.status(200).json({ ok: true, id, total });
        }

        // ================================================ lo del panel, con PIN
        if (!hayClaveAdmin()) {
            return res.status(500).json({ ok: false, sinConfigurar: true, error: 'Falta TIENDA_PIN en Vercel.' });
        }
        if (!claveAdminValida(cuerpo?.pin)) {
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
