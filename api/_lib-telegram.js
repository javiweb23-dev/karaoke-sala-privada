// Envio de mensajes a Telegram.
//
// Usa las MISMAS variables que la alerta del operador, que ya funcionan:
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_CHAT_ID
//
// Esto se escribio aparte en vez de reutilizar alerta-operador.js a proposito:
// ese archivo es lo que suena cuando la sala pide auxilio, y no se toca para
// agregarle una tienda encima.
//
// El prefijo _ evita que Vercel lo publique como endpoint.

function sanitizeEnv(value) {
    if (!value || typeof value !== 'string') return '';
    let v = value.trim();
    if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
    ) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

// Acepta el token pegado de varias formas, porque al copiarlo de BotFather o
// de una URL se cuela basura delante: "bot123:ABC", o la URL entera.
function sanitizeToken(raw) {
    let token = sanitizeEnv(raw);
    const fromUrl = token.match(/\/bot([0-9]+:[A-Za-z0-9_-]+)/i);
    if (fromUrl) token = fromUrl[1];
    if (token.toLowerCase().startsWith('bot')) token = token.slice(3);
    return token.trim();
}

function configurado() {
    const token = sanitizeToken(process.env.TELEGRAM_BOT_TOKEN);
    const chatId = sanitizeEnv(process.env.TELEGRAM_CHAT_ID);
    return Boolean(token && token.includes(':') && chatId);
}

// EL PROBLEMA QUE ARREGLA LO DE ABAJO
//
// Pasaba que el primer aviso no llegaba nunca y, al mandar el segundo,
// aparecian los dos de golpe. Tanto con los pedidos como con la llamada al
// operador, que a alguien le toco repetir porque la primera se perdio.
//
// Es la firma clasica de una peticion que se queda colgada en una funcion sin
// servidor: Vercel congela la instancia con el socket a medias, y no se
// descongela hasta que llega la siguiente llamada. Ahi sale la de antes y la
// nueva juntas. Esperar sin limite no sirve de nada, porque la funcion se muere
// por tiempo agotado antes de que la peticion termine.
//
// La solucion son las dos cosas juntas:
//   1. Un limite de tiempo por intento, para cortar el socket colgado en vez de
//      arrastrarlo. Sin esto los reintentos tampoco llegarian a ocurrir.
//   2. Reintentos con conexion nueva, porque el fallo casi siempre es del
//      primer intento en frio.
//
// Y en vercel.json se le subio el tiempo maximo a estas funciones, porque con
// los 10 segundos de por defecto no cabian los tres intentos.

const INTENTOS = 3;
const TIMEOUT_MS = 6000;
const ESPERAS_MS = [400, 1200];

function esperar(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

// Un intento suelto. Devuelve { ok } o { ok:false, ... , reintentable }.
async function intentarEnvio(token, chatId, texto) {
    const ac = new AbortController();
    const reloj = setTimeout(() => ac.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: texto }),
            signal: ac.signal
        });

        const data = await res.json().catch(() => ({}));

        if (res.ok) return { ok: true };

        // 4xx es culpa nuestra (token malo, chat que no existe): repetirlo da
        // exactamente el mismo error y solo gasta el tiempo de la funcion.
        // 429 y 5xx si son pasajeros.
        const reintentable = res.status === 429 || res.status >= 500;

        console.error('[telegram] rechazado', res.status, data);
        return {
            ok: false,
            reintentable,
            error: 'Telegram rechazo el mensaje',
            telegramDescription: data.description || 'Sin descripcion de Telegram',
            details: data
        };
    } catch (err) {
        const porTiempo = err.name === 'AbortError';
        console.error('[telegram]', porTiempo ? 'se agoto el tiempo' : 'error de red:', err.message);
        return {
            ok: false,
            reintentable: true,
            error: porTiempo ? 'Telegram no respondio a tiempo' : 'Error al contactar Telegram'
        };
    } finally {
        clearTimeout(reloj);
    }
}

// Nunca lanza: devuelve { ok, error }. Quien llama decide si el fallo importa.
// En el caso de la tienda NO importa tanto como parece: el pedido ya quedo
// guardado en la base antes de llegar aqui.
async function enviarMensaje(texto) {
    const token = sanitizeToken(process.env.TELEGRAM_BOT_TOKEN);
    const chatId = sanitizeEnv(process.env.TELEGRAM_CHAT_ID);

    if (!token || !chatId) {
        return { ok: false, error: 'Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en Vercel' };
    }
    if (!token.includes(':')) {
        return { ok: false, error: 'TELEGRAM_BOT_TOKEN invalido (debe ser como 123456789:ABCdef...)' };
    }

    let ultimo = { ok: false, error: 'No se pudo contactar Telegram' };

    for (let i = 0; i < INTENTOS; i++) {
        ultimo = await intentarEnvio(token, chatId, texto);

        if (ultimo.ok) {
            if (i > 0) console.log(`[telegram] enviado en el intento ${i + 1}`);
            return { ok: true };
        }

        if (!ultimo.reintentable) break;
        if (i < INTENTOS - 1) await esperar(ESPERAS_MS[i]);
    }

    return ultimo;
}

module.exports = { enviarMensaje, configurado };
