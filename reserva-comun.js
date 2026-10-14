// =========================================================================
// El formulario de reserva
//
// Esta maquinaria la usan DOS paginas: el home (seccion "Haz tu reserva") y
// /reserva, que es la pagina suelta que se le manda por WhatsApp a quien
// quiere reservar. Por eso vive aqui y no dentro de ninguna de las dos: el
// precio y los horarios estan escritos una sola vez.
//
// Da por hecho que antes existen tres cosas:
//   TEXTOS     con las frases ya mezcladas (ver reserva-textos.js)
//   idioma     'es' o 'en'
//   WHATSAPP   el numero de Javier, para mandarle la reserva
// y que el HTML de la pagina trae los mismos id que el del home.
// =========================================================================
// =========================================================================
// Cotizacion y reserva
//
// Las reglas estan repetidas aqui y en api/reserva.js, y es a proposito: aqui
// para que el cliente no pierda el tiempo, y alli porque es quien decide. Si
// alguna vez cambian, hay que tocar LOS DOS sitios. Hay una prueba en
// scripts/probar-sistema.js que compara los dos numeros.
// =========================================================================
var RES = {
    ABRE: 20 * 60,

    // La tarifa: $2 por persona y por hora. Antes era precio fijo por la sala
    // (2h $40, 3h $60, 4h $70); ahora paga cada cabeza, asi que un grupo
    // pequeno sale mucho mas barato y uno grande paga mas.
    PRECIO_PERSONA_HORA: 2,

    // Minimo que se cobra. Quien quiera venir solo puede, pero paga como si
    // vinieran cuatro: la sala se ocupa igual.
    MIN_PERSONAS: 4,
    MAX_PERSONAS: 14,          // lo que cabe en la sala

    // Nunca se alquila una sola hora.
    MIN_HORAS: 2,
    MAX_HORAS: 4,

    // A partir de este total va de regalo una racion de tequenos y un
    // refresco de dos litros.
    COMBO_DESDE: 50,

    ACOMODO: 20,           // para instalarse: el tiempo empieza a correr despues
    RECOGIDA: 20           // para recoger al final
};

var reserva = {
    fecha: '', horas: 3,   // 3 es la que se recomienda
    personas: RES.MIN_PERSONAS,
    inicio: null, tasa: null, enviada: null
};

function nodo(id) { return document.getElementById(id); }

// En am/pm, igual que en el servidor: quien reserva una noche piensa en
// "las 8", no en "las 20:00".
function resHora(min) {
    const m24 = min % 1440;
    let h = Math.floor(m24 / 60);
    const m = m24 % 60;
    const sufijo = h < 12 ? 'am' : 'pm';
    h = h % 12 || 12;
    return h + ':' + String(m).padStart(2, '0') + ' ' + sufijo;
}

// La fecha, con todas las letras. El mediodia en UTC evita que se corra de
// dia segun la zona horaria del telefono.
function resFechaEnPalabras(iso) {
    if (!iso) return '';
    try {
        return new Date(iso + 'T12:00:00Z').toLocaleDateString(
            idioma === 'es' ? 'es-VE' : 'en-US',
            { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    } catch (e) {
        return iso;
    }
}

// Cuantas personas se COBRAN, que no es lo mismo que cuantas vienen.
function resPersonasCobradas(personas) {
    return Math.max(RES.MIN_PERSONAS, Number(personas) || 0);
}

function resPrecio(horas, personas) {
    return RES.PRECIO_PERSONA_HORA * horas * resPersonasCobradas(personas);
}

// Lo que pone cada uno de los que de verdad vienen. Si son menos de cuatro,
// el minimo se reparte entre los que son, no entre cuatro imaginarios.
function resPorCabeza(horas, personas) {
    const cuantos = Math.max(1, Number(personas) || 1);
    return resPrecio(horas, personas) / cuantos;
}

// Dos decimales solo cuando hacen falta: $6 se lee mejor que $6.00, pero
// $5.33 no se puede redondear a $5.
function resDinero(usd) {
    return Number.isInteger(usd) ? String(usd) : usd.toFixed(2);
}

function resBolivares(usd) {
    if (!reserva.tasa) return null;
    return (usd * reserva.tasa).toLocaleString('es-VE', { maximumFractionDigits: 0 });
}

// ------------------------------------------------- los desplegables, una vez
function resLlenarSelects() {
    const t = TEXTOS[idioma];

    // Solo la duracion, sin el precio al lado: el total sale completo en el
    // resumen de abajo y ponerlo tambien aqui era ruido.
    const horas = [];
    for (let h = RES.MIN_HORAS; h <= RES.MAX_HORAS; h++) horas.push(h);
    nodo('resHoras').innerHTML = horas
        .map((h) => `<option value="${h}"${h === reserva.horas ? ' selected' : ''}>` +
             `${h} ${t.resHoraPl}</option>`).join('');

    // Las personas, numeros pelados: ya lo dice la etiqueta de encima.
    const caja = nodo('resPersonas');
    if (caja) {
        const gente = [];
        for (let p = 1; p <= RES.MAX_PERSONAS; p++) gente.push(p);
        caja.innerHTML = gente
            .map((p) => `<option value="${p}"${p === reserva.personas ? ' selected' : ''}>` +
                 `${p}</option>`).join('');
    }

    // Desde hoy: no tiene sentido ofrecer ayer.
    const hoy = new Date();
    const dosDigitos = (n) => String(n).padStart(2, '0');
    nodo('resFecha').min = hoy.getFullYear() + '-' +
        dosDigitos(hoy.getMonth() + 1) + '-' + dosDigitos(hoy.getDate());
}

// ------------------------------------------------ pedir y pintar las horas
async function resBuscarHoras() {
    const t = TEXTOS[idioma];
    const caja = nodo('resHorasLibres');
    const aviso = nodo('resAvisoHoras');

    // El mismo parrafo sirve para dos cosas muy distintas: una pista mientras
    // se elige ("elige un dia") y una mala noticia ("no hay"). La mala noticia
    // tiene que verse: en gris pequeno pasaba desapercibida y la gente se
    // quedaba mirando un hueco vacio sin entender.
    const resAviso = (texto, malaNoticia) => {
        aviso.textContent = texto;
        aviso.className = 'mt-2 ' + (malaNoticia
            ? 'text-marca-400 text-lg font-bold leading-snug'
            : 'text-crema-600 text-sm');
    };

    reserva.inicio = null;
    resPintarResumen();

    if (!reserva.fecha) {
        caja.innerHTML = '';
        resAviso(t.resElegirDia, false);
        return;
    }

    caja.innerHTML = '';
    resAviso(t.resCargando, false);

    try {
        const r = await fetch('/api/reserva', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accion: 'disponibilidad',
                fecha: reserva.fecha,
                horas: reserva.horas
            })
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'sin horas');

        if (d.tasa) reserva.tasa = d.tasa;

        if (!d.horas.length) {
            // Si no cabe lo que pidio pero si una duracion mas corta, se le
            // ofrece en vez de dejarlo con un "no hay". Muchas veces acepta.
            if (Array.isArray(d.alternativas) && d.alternativas.length) {
                resAviso(t.resSinSitio.replace('{n}', reserva.horas), true);
                caja.innerHTML = d.alternativas.map((n) => `
                    <button type="button" data-horas="${n}"
                        class="res-otra border border-marca-500/60 text-marca-400
                               hover:bg-marca-500 hover:text-black hover:border-marca-500
                               text-sm font-bold px-4 py-2.5 rounded-xl transition-colors">
                        ${t.resVerDe.replace('{n}', n)}
                    </button>`).join('');

                caja.querySelectorAll('.res-otra').forEach((b) => {
                    b.addEventListener('click', () => {
                        reserva.horas = Number(b.dataset.horas);
                        nodo('resHoras').value = String(reserva.horas);
                        resBuscarHoras();
                    });
                });
                return;
            }
            resAviso(t.resSinHoras, true);
            return;
        }

        resAviso('', false);
        caja.innerHTML = d.horas.map((h) => `
            <button type="button" data-min="${h.min}"
                class="res-hora border border-noche-700 hover:border-marca-500/60
                       text-crema-300 text-sm font-bold px-4 py-2.5 rounded-xl
                       transition-colors">${h.texto}</button>`).join('');

        caja.querySelectorAll('.res-hora').forEach((b) => {
            b.addEventListener('click', () => {
                reserva.inicio = Number(b.dataset.min);
                caja.querySelectorAll('.res-hora').forEach((o) => {
                    const suyo = o === b;
                    o.classList.toggle('bg-marca-500', suyo);
                    o.classList.toggle('text-black', suyo);
                    o.classList.toggle('border-marca-500', suyo);
                    o.classList.toggle('text-crema-300', !suyo);
                });
                resPintarResumen();
            });
        });
    } catch (e) {
        console.warn('[reserva]', e.message);
        resAviso(t.resSinHoras, true);
    }
}

// ------------------------------------------- repintar al cambiar de idioma
//
// Lo llaman las dos paginas desde su aplicarIdioma(). Existe para que ninguna
// tenga que saber QUE hay que repintar aqui dentro.
//
// Ojo con como se comprueba desde fuera: en el home hay un
// <section id="reserva">, y un id crea una variable global con ese nombre
// apuntando al ELEMENTO. O sea que "typeof reserva" alli vale 'object'
// aunque este archivo no se haya ejecutado todavia. Por eso las paginas
// preguntan por ESTA funcion, que no choca con ningun id.
function resRefrescarTextos() {
    resLlenarSelects();
    resPintarResumen();
    nodo('resFechaTexto').textContent = resFechaEnPalabras(reserva.fecha);

    // El parrafo de "elige un dia" tambien esta escrito en un idioma. Se
    // repinta solo cuando aun no hay dia: con dia elegido habria que volver a
    // preguntarle las horas al servidor, y se perderia la que ya marco.
    if (!reserva.fecha) resBuscarHoras();
}

// ------------------------------------------------------------- el resumen
function resPintarResumen() {
    const t = TEXTOS[idioma];
    const caja = nodo('resResumen');

    const listo = Boolean(reserva.fecha && reserva.inicio !== null);
    ['resResumen', 'resQuien', 'resPago'].forEach((id) =>
        nodo(id).classList.toggle('hidden', !listo));
    if (!listo) return;

    // Llegan a la hora elegida, se instalan 20 minutos y ENTONCES empieza a
    // correr el tiempo contratado.
    const canta = reserva.inicio + RES.ACOMODO;
    const fin = canta + reserva.horas * 60;

    const total = resPrecio(reserva.horas, reserva.personas);
    const cabeza = resPorCabeza(reserva.horas, reserva.personas);
    const cobradas = resPersonasCobradas(reserva.personas);
    const bsTotal = resBolivares(total);

    // Si vienen menos de cuatro se les dice, para que el total no parezca un
    // error de la pagina.
    //
    // Con replace() y un texto, solo se cambia la PRIMERA aparicion. La frase
    // llevaba {n} dos veces y en pantalla salia "se cobran {n}" tal cual. Por
    // eso ahora el marcador esta una sola vez en la frase.
    const notaMinimo = reserva.personas < RES.MIN_PERSONAS
        ? `<p class="text-crema-500 text-xs pt-1">${t.resMinimoNota
             .replace('{n}', RES.MIN_PERSONAS)}</p>`
        : '';

    // El combo: o se lo ganaron, o se les dice cuanto les falta. Lo segundo es
    // lo que de verdad mueve a subir una hora o avisar a un amigo mas.
    let combo = '';
    if (total >= RES.COMBO_DESDE) {
        combo = `
            <div class="mt-4 bg-marca-500/10 border border-marca-500/30 rounded-xl p-4">
                <!-- En el celular las fotos van ARRIBA y el texto debajo: a lo
                     ancho, entre las dos fotos solo quedaban unos 160px y
                     "¡Te lo ganaste!" se partia en dos lineas. -->
                <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div class="flex gap-3 flex-shrink-0">
                        <img src="fotos/combo-tequenos.webp" alt="" width="56" height="56" loading="lazy"
                             class="w-14 h-14 rounded-lg object-cover">
                        <img src="fotos/combo-refresco.webp" alt="" width="56" height="56" loading="lazy"
                             class="w-14 h-14 rounded-lg object-cover">
                    </div>
                    <div class="min-w-0">
                        <p class="text-marca-400 text-xs font-black uppercase tracking-wider mb-0.5">
                            ${t.resComboGanado}</p>
                        <p class="text-crema-300 text-sm leading-snug">${t.resComboQue}</p>
                    </div>
                </div>
            </div>`;
    } else {
        // Una frase y ya. Antes se calculaba cuanto faltaba y con cuanta
        // gente mas se llegaba, pero eran cuentas en la cara de alguien que
        // solo esta decidiendo si reserva.
        combo = `
            <p class="mt-4 text-crema-500 text-xs leading-relaxed">
                ${t.resComboAviso.replace('{n}', '$' + RES.COMBO_DESDE)}</p>`;
    }

    caja.innerHTML = `
        <div class="space-y-1.5 text-sm mb-4">
            <p class="text-crema-300">${t.resResumenEntran}
               <strong class="text-crema-100">${resHora(reserva.inicio)}</strong></p>
            <p class="text-crema-300">${t.resResumenCantan}
               <strong class="text-crema-100">${resHora(canta)} a ${resHora(fin)}</strong></p>
            <p class="text-crema-300">${t.resResumenSalen}
               <strong class="text-crema-100">${resHora(fin + RES.RECOGIDA)}</strong></p>
        </div>
        <p class="text-crema-500 text-xs leading-relaxed mb-5">${t.resResumenCortesia}</p>

        <div class="border-t border-noche-800 pt-4 space-y-2">
            <p class="text-crema-500 text-xs">${t.resResumenCuenta
                .replace('{p}', cobradas)
                .replace('{h}', reserva.horas)
                .replace('{precio}', '$' + RES.PRECIO_PERSONA_HORA)}</p>
            <div class="flex items-baseline justify-between">
                <span class="text-marca-400 text-sm font-bold">${t.resResumenTotal}</span>
                <span class="degradado-marca font-black text-xl">$${resDinero(total)}${bsTotal ? `
                    <span class="text-crema-400 font-normal text-sm"> · Bs ${bsTotal}</span>` : ''}</span>
            </div>
            <div class="flex items-baseline justify-between">
                <span class="text-crema-400 text-sm">${t.resResumenCabeza}</span>
                <span class="text-crema-100 font-bold">$${resDinero(cabeza)}</span>
            </div>
            ${notaMinimo}
            <!-- Sin la tasa del BCV. Se ponia la del dia, pero entre que
                 reservan y pagan suele pasar una noche y ya no es esa: era
                 prometer un numero que al rato dejaba de ser verdad. -->
            <p class="text-crema-600 text-xs pt-1">${t.resResumenPagoTodo}</p>
        </div>
        ${combo}`;
}

function resMostrarError(texto) {
    const e = nodo('resError');
    e.textContent = texto;
    e.classList.remove('hidden');
}
function resOcultarError() { nodo('resError').classList.add('hidden'); }

// ------------------------------------------------- el mensaje para Javier
//
// Va en castellano SIEMPRE, aunque el cliente tenga la pagina en ingles: lo
// lee Javier, no el cliente. Lleva justo lo que necesita para cobrar y
// apuntar la noche, y el numero de reserva para encontrarla en el panel.
function resMensajeWhatsApp(datos) {
    const lineas = [
        'Hola, quiero reservar la sala 🎤',
        '',
        'Nombre: ' + datos.nombre,
        'WhatsApp: ' + datos.telefono,
        'Personas: ' + datos.personas,
        'Día: ' + datos.fechaTexto,
        'Hora: ' + datos.hora,
        '',
        'Total de la reserva: $' + resDinero(datos.total),
        'Le toca a cada uno: $' + resDinero(datos.cabeza)
    ];
    if (datos.combo) lineas.push('', 'Incluye: 1 ración de tequeños + 1 refresco de 2 L 🎉');
    if (datos.id) lineas.push('', 'Reserva #' + datos.id);
    return lineas.join('\n');
}

function resEnlaceWhatsApp(datos) {
    const numero = (typeof WHATSAPP !== 'undefined' && WHATSAPP) ? WHATSAPP : '584121591072';
    return 'https://wa.me/' + numero + '?text=' +
        encodeURIComponent(resMensajeWhatsApp(datos));
}

// --------------------------------------------------------------- enviarla
async function resEnviar() {
    const t = TEXTOS[idioma];
    const nombre = nodo('resNombre').value.trim();
    const telefono = nodo('resTelefono').value.trim();

    if (nombre.length < 2) return resMostrarError(t.resErrNombre);
    if (telefono.replace(/\D/g, '').length < 10) return resMostrarError(t.resErrTelefono);

    resOcultarError();
    const btn = nodo('resEnviar');
    btn.disabled = true;
    btn.textContent = t.resEnviando;

    try {
        const r = await fetch('/api/reserva', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accion: 'crear',
                fecha: reserva.fecha,
                inicio_min: reserva.inicio,
                horas: reserva.horas,
                personas: reserva.personas,
                nombre, telefono
            })
        });
        const d = await r.json();

        if (!d.ok) {
            // Si alguien se adelanto, se vuelven a pedir las horas para que
            // vea el hueco real en vez de insistir contra uno ocupado.
            if (d.ocupado) resBuscarHoras();
            throw new Error(d.error || t.resErrEnvio);
        }

        // El total manda el servidor, no este navegador. Si por lo que sea no
        // coincidieran, el mensaje lleva el bueno.
        const total = typeof d.total === 'number'
            ? d.total : resPrecio(reserva.horas, reserva.personas);
        const datos = {
            id: d.id,
            nombre, telefono,
            personas: reserva.personas,
            fechaTexto: resFechaEnPalabras(reserva.fecha),
            hora: resHora(reserva.inicio),
            total,
            cabeza: total / Math.max(1, reserva.personas),
            combo: total >= RES.COMBO_DESDE
        };
        reserva.enviada = datos;

        const enlace = resEnlaceWhatsApp(datos);

        // El boton de la pantalla de gracias se deja listo ANTES de intentar
        // abrir nada: si el navegador bloquea la ventana —cosa normal cuando
        // se abre despues de esperar al servidor y no en el toque— el cliente
        // tiene igual donde pulsar, y ese toque suyo nunca se bloquea.
        const btnWa = nodo('resGraciasWa');
        if (btnWa) btnWa.href = enlace;

        nodo('resGracias').previousElementSibling.classList.add('hidden');
        nodo('resGracias').classList.remove('hidden');
        nodo('resGracias').scrollIntoView({ behavior: 'smooth', block: 'center' });

        try { window.open(enlace, '_blank'); } catch (e) {}

    } catch (e) {
        console.warn('[reserva]', e.message);
        resMostrarError(e.message || t.resErrEnvio);
        btn.disabled = false;
        btn.textContent = t.resBtnEnviar;
    }
}

nodo('resEnviar').addEventListener('click', resEnviar);
// En varios telefonos, tocar el campo no abre el calendario: hay que acertarle
// al iconito. Y como el formato es de solo lectura en movil, tampoco sale el
// teclado, asi que el cliente se queda tocando una caja que no hace nada.
//
// showPicker() lo abre a proposito desde cualquier punto del campo. Lanza
// excepcion si el navegador no lo soporta o si no viene de un gesto del
// usuario, y por eso va envuelto: en ese caso queda el iconito, que ahora si
// se ve.
nodo('resFecha').addEventListener('click', function () {
    try { this.showPicker(); } catch (e) {}
});

nodo('resFecha').addEventListener('change', (e) => {
    reserva.fecha = e.target.value;
    nodo('resFechaTexto').textContent = resFechaEnPalabras(reserva.fecha);
    resBuscarHoras();
});
nodo('resHoras').addEventListener('change', (e) => {
    reserva.horas = Number(e.target.value); resBuscarHoras();
});

// Cambiar el numero de personas cambia el total, pero ya no el texto de los
// desplegables, asi que basta con repintar el resumen. Tampoco hace falta
// volver a preguntar los horarios libres: cuanta gente viene no cambia lo que
// esta ocupado.
if (nodo('resPersonas')) {
    nodo('resPersonas').addEventListener('change', (e) => {
        reserva.personas = Number(e.target.value);
        resPintarResumen();
    });
}

resLlenarSelects();
resBuscarHoras();
