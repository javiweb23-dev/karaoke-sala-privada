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

function sanitizeToken(raw) {
    let token = sanitizeEnv(raw);
    const fromUrl = token.match(/\/bot([0-9]+:[A-Za-z0-9_-]+)/i);
    if (fromUrl) token = fromUrl[1];
    if (token.toLowerCase().startsWith('bot')) token = token.slice(3);
    return token.trim();
}

function sanitizeChatId(raw) {
    return sanitizeEnv(raw);
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Método no permitido' });
    }

    const token = sanitizeToken(process.env.TELEGRAM_BOT_TOKEN);
    const chatId = sanitizeChatId(process.env.TELEGRAM_CHAT_ID);

    if (!token || !chatId) {
        return res.status(500).json({
            ok: false,
            error: 'Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en Vercel'
        });
    }

    if (!token.includes(':')) {
        return res.status(500).json({
            ok: false,
            error: 'TELEGRAM_BOT_TOKEN inválido (debe ser como 123456789:ABCdef...)'
        });
    }

    const text = '🚨 Alerta Urgente: La Sala VIP solicita asistencia.';

    try {
        const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text })
        });

        const data = await tgRes.json().catch(() => ({}));

        if (!tgRes.ok) {
            const telegramDescription = data.description || 'Sin descripción de Telegram';
            console.error('[alerta-operador] Telegram:', data);
            return res.status(502).json({
                ok: false,
                error: 'Telegram rechazó la alerta',
                telegramDescription,
                details: data
            });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[alerta-operador] Error de red:', err);
        return res.status(500).json({ ok: false, error: 'Error al contactar Telegram' });
    }
};
