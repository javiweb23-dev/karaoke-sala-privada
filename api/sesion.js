// Sesiones de sala: abrir, cerrar y consultar el codigo.
//
// Todo lo de aqui exige el PIN del operador, porque quien pueda leer el codigo
// puede saltarse el control. Ni admin.html ni reproductor.html tienen login
// propio, asi que este PIN es lo unico que separa al operador de un curioso
// que conozca la URL.
//
// Variables de entorno en Vercel:
//   ADMIN_PIN              (obligatoria — la que teclea el operador)
//   SUPABASE_URL           (obligatoria)
//   SUPABASE_SERVICE_KEY   (obligatoria — la secreta, no la publishable)

const crypto = require('crypto');
const {
    supabaseFetchEstricto,
    pinValido,
    hayPinConfigurado
} = require('./_lib-supabase');
const { aplicarCors } = require('./_lib-http');

// 4 digitos: facil de leer de lejos en la TV y de teclear en el celular.
// No es una contraseña, es una prueba de estar en la sala.
function generarCodigo() {
    return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// Minutos de cortesia una vez agotado el tiempo pagado.
const MINUTOS_GRACIA = 10;

async function sesionAbierta() {
    const filas = await supabaseFetchEstricto(
        'sesiones?estado=eq.abierta&select=id,codigo,nombre_grupo,abierta_en,' +
        'inicio_previsto,fin_previsto&limit=1'
    );
    return filas && filas.length ? filas[0] : null;
}

// El tiempo lo calcula el servidor, no la TV: si el reloj del equipo esta
// desajustado, la cuenta atras seguiria siendo correcta.
function conTiempos(sesion) {
    if (!sesion) return null;
    if (!sesion.fin_previsto) return { ...sesion, programada: false };

    const ahora = Date.now();
    const fin = new Date(sesion.fin_previsto).getTime();
    const restantes = Math.round((fin - ahora) / 1000);
    const graciaSeg = MINUTOS_GRACIA * 60;

    let fase = 'corriendo';
    if (restantes <= 0) {
        fase = restantes <= -graciaSeg ? 'terminada' : 'cortesia';
    } else if (restantes <= 15 * 60) {
        fase = 'por_terminar';
    }

    return {
        ...sesion,
        programada: true,
        segundos_restantes: restantes,
        segundos_gracia: graciaSeg,
        minutos_gracia: MINUTOS_GRACIA,
        fase
    };
}

async function cerrarAbiertas() {
    const abierta = await sesionAbierta();
    if (!abierta) return null;

    await supabaseFetchEstricto('sesiones?estado=eq.abierta', {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
            estado: 'cerrada',
            cerrada_en: new Date().toISOString()
        })
    });

    // Lo que quedo en cola de ese grupo ya no tiene sentido: el grupo se fue.
    // Se marca como completada para que el admin no vea restos de anoche.
    // Se incluyen las que no tienen sesion (pedidas antes de abrirla), que si
    // no quedarian colgadas en la cola indefinidamente.
    await supabaseFetchEstricto(
        `Solicitudes?estado=eq.pendiente` +
        `&or=(sesion_id.eq.${abierta.id},sesion_id.is.null)`,
        {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ estado: 'completada' })
        }
    );

    return abierta;
}

module.exports = async (req, res) => {
    // El reproductor llama desde localhost (Live Server), no desde Vercel.
    if (aplicarCors(req, res)) return;

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'Metodo no permitido' });
    }

    if (!hayPinConfigurado()) {
        return res.status(503).json({
            ok: false,
            error: 'Falta ADMIN_PIN en Vercel. Las sesiones estan desactivadas.',
            sinConfigurar: true
        });
    }

    let cuerpo = req.body;
    if (typeof cuerpo === 'string') {
        try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; }
    }

    if (!pinValido(cuerpo?.pin)) {
        // Retraso fijo: encarece un poco probar PINs a lo bruto.
        await new Promise((r) => setTimeout(r, 700));
        return res.status(401).json({ ok: false, error: 'PIN incorrecto' });
    }

    const accion = String(cuerpo?.accion || '').trim();

    try {
        if (accion === 'estado') {
            const actual = await sesionAbierta();
            return res.status(200).json({ ok: true, sesion: conTiempos(actual) });
        }

        // Fija a que hora empieza a correr el tiempo y cuantas horas se
        // pagaron. El inicio llega ya resuelto desde el admin (fecha y hora
        // completas), para no tener que adivinar aqui la zona horaria.
        if (accion === 'programar') {
            const abierta = await sesionAbierta();
            if (!abierta) {
                return res.status(400).json({ ok: false, error: 'No hay sesion abierta' });
            }

            const inicio = new Date(cuerpo?.inicio);
            const horas = Number(cuerpo?.horas);

            if (isNaN(inicio.getTime())) {
                return res.status(400).json({ ok: false, error: 'Hora de inicio no valida' });
            }
            if (!(horas > 0) || horas > 24) {
                return res.status(400).json({ ok: false, error: 'Las horas deben estar entre 0 y 24' });
            }

            const fin = new Date(inicio.getTime() + horas * 3600000);

            await supabaseFetchEstricto(`sesiones?id=eq.${abierta.id}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({
                    inicio_previsto: inicio.toISOString(),
                    fin_previsto: fin.toISOString()
                })
            });

            return res.status(200).json({ ok: true, sesion: conTiempos(await sesionAbierta()) });
        }

        // Suma minutos al final. Sirve tanto para la hora adicional que
        // contratan como para regalar un rato.
        if (accion === 'extender') {
            const abierta = await sesionAbierta();
            if (!abierta) {
                return res.status(400).json({ ok: false, error: 'No hay sesion abierta' });
            }
            if (!abierta.fin_previsto) {
                return res.status(400).json({ ok: false, error: 'La sesion no tiene tiempo programado' });
            }

            const minutos = Number(cuerpo?.minutos);
            if (!minutos || Math.abs(minutos) > 24 * 60) {
                return res.status(400).json({ ok: false, error: 'Minutos no validos' });
            }

            // Si ya se paso de la hora, la extension cuenta desde AHORA: si no,
            // pagar una hora cuando llevas 20 minutos de cortesia daria 40.
            const base = Math.max(Date.now(), new Date(abierta.fin_previsto).getTime());
            const fin = new Date(base + minutos * 60000);

            await supabaseFetchEstricto(`sesiones?id=eq.${abierta.id}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ fin_previsto: fin.toISOString() })
            });

            return res.status(200).json({ ok: true, sesion: conTiempos(await sesionAbierta()) });
        }

        if (accion === 'abrir') {
            // El indice unico parcial impide dos sesiones abiertas, asi que
            // primero se cierra la anterior si quedo alguna.
            await cerrarAbiertas();

            const nueva = await supabaseFetchEstricto('sesiones', {
                method: 'POST',
                headers: { Prefer: 'return=representation' },
                body: JSON.stringify({
                    codigo: generarCodigo(),
                    nombre_grupo: String(cuerpo?.nombre || '').trim().slice(0, 60) || null
                })
            });

            return res.status(200).json({ ok: true, sesion: conTiempos(nueva[0]) });
        }

        if (accion === 'cerrar') {
            const cerrada = await cerrarAbiertas();
            return res.status(200).json({ ok: true, cerrada: Boolean(cerrada) });
        }

        return res.status(400).json({ ok: false, error: 'Accion no valida' });
    } catch (err) {
        console.error('[sesion]', err);
        const texto = String(err.message || '');

        // Un 500 generico obliga a adivinar. Estas dos son las causas reales
        // en la practica, y cada una se arregla de una forma distinta.
        if (/PGRST205|42P01|does not exist|Could not find the table/i.test(texto)) {
            return res.status(503).json({
                ok: false,
                error: 'Falta ejecutar sql/002-sesiones-de-sala.sql en Supabase.',
                faltaSql: true
            });
        }

        if (/Faltan SUPABASE_URL|SUPABASE_SERVICE_KEY/i.test(texto)) {
            return res.status(503).json({
                ok: false,
                error: 'Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en Vercel.',
                sinConfigurar: true
            });
        }

        return res.status(500).json({
            ok: false,
            error: 'Error al manejar la sesion',
            detalle: texto.slice(0, 200)
        });
    }
};
