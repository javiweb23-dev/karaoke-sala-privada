// Valida el codigo de sala que teclea el cliente.
//
// Es el unico endpoint de sesiones sin PIN, porque lo usan los clientes.
// A cambio, lo unico que puede hacer es responder si un codigo coincide con
// la sesion abierta: nunca devuelve el codigo ni lista sesiones.

const {
    supabaseFetchEstricto,
    comparaSecreto,
    configurado
} = require('./_lib-supabase');
const { aplicarCors } = require('./_lib-http');

module.exports = async (req, res) => {
    if (aplicarCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Metodo no permitido' });
    }

    if (!configurado()) {
        // Sin Supabase configurado no hay control de sala: se deja pasar para
        // no dejar el sistema inutilizable por una variable que falta.
        return res.status(200).json({ ok: true, sinControl: true });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
    }

    const codigo = String(cuerpo?.codigo || '').replace(/\D/g, '').slice(0, 4);
    if (codigo.length !== 4) {
        return res.status(400).json({ ok: false, error: 'El codigo son 4 numeros' });
    }

    try {
        const filas = await supabaseFetchEstricto(
            'sesiones?estado=eq.abierta&select=id,codigo,nombre_grupo&limit=1'
        );

        // Sin sesion abierta el control no aplica: el sistema funciona como
        // siempre. Las sesiones son opcionales a proposito.
        if (!filas || filas.length === 0) {
            return res.status(200).json({ ok: true, sinControl: true });
        }

        const sesion = filas[0];

        if (!comparaSecreto(codigo, sesion.codigo)) {
            // Retraso fijo: probar los 10.000 codigos a mano deja de ser comodo.
            await new Promise((r) => setTimeout(r, 700));
            return res.status(401).json({ ok: false, error: 'Codigo incorrecto' });
        }

        return res.status(200).json({
            ok: true,
            sesion_id: sesion.id,
            nombre_grupo: sesion.nombre_grupo || null
        });
    } catch (err) {
        console.error('[validar-codigo]', err);
        const texto = String(err.message || '');

        // Si la tabla no existe, el control de sala simplemente no esta
        // montado todavia: se deja pasar en vez de dejar a los clientes
        // encerrados fuera por un SQL sin ejecutar.
        if (/PGRST205|42P01|does not exist|Could not find the table/i.test(texto)) {
            return res.status(200).json({ ok: true, sinControl: true });
        }

        return res.status(500).json({ ok: false, error: 'No se pudo validar el codigo' });
    }
};
