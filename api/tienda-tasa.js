// La tasa de referencia, suelta.
//
// El catalogo ya la trae, asi que la tienda no necesita llamar aqui. Existe
// para el panel del operador, que la consulta al abrir para enseñar cual esta
// usando ahora mismo y de donde salio, y para poder comprobarla desde el
// navegador cuando algo se ve raro.

const { obtenerTasa } = require('./_lib-tasa');
const { aplicarCors } = require('./_lib-http');

module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ ok: false, error: 'Metodo no permitido' });
    }

    const { tasa, fuente } = await obtenerTasa();

    // Sin cache: el panel necesita ver el efecto de guardar la tasa manual al
    // instante, no dentro de un minuto.
    res.setHeader('Cache-Control', 'no-store');

    return res.status(200).json({ ok: true, tasa, fuente });
};
