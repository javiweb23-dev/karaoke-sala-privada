// El boton de panico del admin: avisa al operador por Telegram.
//
// El envio vive ahora en _lib-telegram.js, compartido con los pedidos de la
// tienda. Antes estaba aqui copiado y sin reintentos, y por eso se perdian
// llamadas: a alguien le toco llamar dos veces porque la primera nunca llego.
// El porque esta explicado a fondo en _lib-telegram.js.

const { enviarMensaje } = require('./_lib-telegram');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Método no permitido' });
    }

    const resultado = await enviarMensaje('🚨 Alerta Urgente: La Sala VIP solicita asistencia.');

    if (resultado.ok) return res.status(200).json({ ok: true });

    // Se conservan los mismos campos que antes porque admin.html los lee para
    // enseñar el motivo en la consola.
    const faltaConfiguracion = /Faltan TELEGRAM|invalido/i.test(resultado.error || '');

    return res.status(faltaConfiguracion ? 500 : 502).json({
        ok: false,
        error: resultado.error || 'No se pudo enviar la alerta',
        telegramDescription: resultado.telegramDescription,
        details: resultado.details
    });
};
