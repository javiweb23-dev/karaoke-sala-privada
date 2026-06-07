module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Método no permitido' });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        return res.status(500).json({
            ok: false,
            error: 'Faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID en Vercel'
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
            console.error('[alerta-operador] Telegram:', data);
            return res.status(502).json({ ok: false, error: 'Telegram rechazó la alerta', details: data });
        }

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[alerta-operador] Error de red:', err);
        return res.status(500).json({ ok: false, error: 'Error al contactar Telegram' });
    }
};
