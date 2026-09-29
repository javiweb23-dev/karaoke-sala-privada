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

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: texto })
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            console.error('[telegram]', data);
            return {
                ok: false,
                error: 'Telegram rechazo el mensaje',
                telegramDescription: data.description || 'Sin descripcion de Telegram'
            };
        }

        return { ok: true };
    } catch (err) {
        console.error('[telegram] error de red:', err);
        return { ok: false, error: 'Error al contactar Telegram' };
    }
}

module.exports = { enviarMensaje, configurado };
