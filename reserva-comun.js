// =========================================================================
// El formulario de reserva
//
// Esta maquinaria la usan DOS paginas: el home (seccion "Haz tu reserva") y
// /reserva, que es la pagina suelta que se le manda por WhatsApp a quien
// quiere reservar. Por eso vive aqui y no dentro de ninguna de las dos: el
// precio y los horarios estan escritos una sola vez.
//
// Da por hecho que antes existen dos cosas:
//   TEXTOS   con las frases ya mezcladas (ver reserva-textos.js)
//   idioma   'es' o 'en'
// y que el HTML de la pagina trae los mismos id que el del home.
// =========================================================================
// =========================================================================
// Cotizacion y reserva
//
// Las reglas estan repetidas aqui y en api/reserva.js, y es a proposito: aqui
// para que el cliente no pierda el tiempo, y alli porque es quien decide. Si
// alguna vez cambian, hay que tocar LOS DOS sitios.
// =========================================================================
var RES = {
    ABRE: 20 * 60,
    // La tarifa, igual que en api/reserva.js. Si cambia, se cambia en los dos.
    PRECIOS: { 2: 40, 3: 60, 4: 70 },
    ACOMODO: 20,           // para instalarse: el tiempo empieza a correr despues
    RECOGIDA: 20           // para recoger al final
};

var reserva = {
    fecha: '', horas: 3,   // 3 es la que se recomienda
    inicio: null, comprobante: null, tasa: null
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

function resPrecio(horas) {
    return RES.PRECIOS[horas];
}

function resBolivares(usd) {
    if (!reserva.tasa) return null;
    return (usd * reserva.tasa).toLocaleString('es-VE', { maximumFractionDigits: 0 });
}

// ------------------------------------------------- los desplegables, una vez
function resLlenarSelects() {
    const t = TEXTOS[idioma];

    // Cada duracion con su precio al lado: asi se elige mirando lo que cuesta,
    // sin tener que sumar nada.
    nodo('resHoras').innerHTML = Object.keys(RES.PRECIOS).map(Number).sort((a, b) => a - b)
        .map((horas) => `<option value="${horas}"${horas === reserva.horas ? ' selected' : ''}>` +
             `${horas} ${t.resHoraPl} · $${RES.PRECIOS[horas]}</option>`).join('');

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
    const total = resPrecio(reserva.horas);
    const abono = total / 2;
    const bsTotal = resBolivares(total);
    const bsAbono = resBolivares(abono);

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
            <div class="flex items-baseline justify-between">
                <span class="text-crema-400 text-sm">${t.resResumenTotal}</span>
                <span class="text-crema-100 font-bold">$${total}${bsTotal ? `
                    <span class="text-crema-500 font-normal text-sm"> · Bs ${bsTotal}</span>` : ''}</span>
            </div>
            <div class="flex items-baseline justify-between">
                <span class="text-marca-400 text-sm font-bold">${t.resResumenAbono}</span>
                <span class="degradado-marca font-black text-xl">$${abono}${bsAbono ? `
                    <span class="text-crema-400 font-normal text-sm"> · Bs ${bsAbono}</span>` : ''}</span>
            </div>
            <p class="text-crema-600 text-xs pt-1">${t.resResumenResto}${
                reserva.tasa ? ` · ${t.resTasaNota}: ${reserva.tasa.toLocaleString('es-VE',
                    { maximumFractionDigits: 2 })}` : ''}</p>
        </div>`;
}

// ---------------------------------------------------------- el comprobante
nodo('resComprobante').addEventListener('change', (ev) => {
    const t = TEXTOS[idioma];
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;

    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(f.type)) {
        return resMostrarError(t.resErrArchivo);
    }
    if (f.size > 5 * 1024 * 1024) return resMostrarError(t.resErrPesado);

    reserva.comprobante = f;
    resOcultarError();

    const ok = nodo('resComprobanteOk');
    ok.textContent = t.resComprobanteListo + ' ' + f.name;
    ok.classList.remove('hidden');
    nodo('resEnviar').disabled = false;
});

function resMostrarError(texto) {
    const e = nodo('resError');
    e.textContent = texto;
    e.classList.remove('hidden');
}
function resOcultarError() { nodo('resError').classList.add('hidden'); }

// --------------------------------------------------------------- enviarla
async function resEnviar() {
    const t = TEXTOS[idioma];
    const nombre = nodo('resNombre').value.trim();
    const telefono = nodo('resTelefono').value.trim();

    if (nombre.length < 2) return resMostrarError(t.resErrNombre);
    if (telefono.replace(/\D/g, '').length < 10) return resMostrarError(t.resErrTelefono);
    if (!reserva.comprobante) return resMostrarError(t.resErrComprobante);

    resOcultarError();
    const btn = nodo('resEnviar');
    btn.disabled = true;
    btn.textContent = t.resSubiendo;

    try {
        // El comprobante va primero: si falla, no queda una reserva sin pago.
        const cliente = supabase.createClient(
            'https://mefrjbmjfdphdqndpzcw.supabase.co',
            'sb_publishable_Xfq71bq0xH8DQ62OHekwCQ_B5dAPsz8'
        );
        const ext = (reserva.comprobante.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
        const ruta = Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '.' + ext;

        const { error: errSubida } = await cliente.storage
            .from('comprobantes')
            .upload(ruta, reserva.comprobante, { contentType: reserva.comprobante.type });
        if (errSubida) throw errSubida;

        btn.textContent = t.resEnviando;

        const r = await fetch('/api/reserva', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accion: 'crear',
                fecha: reserva.fecha,
                inicio_min: reserva.inicio,
                horas: reserva.horas,
                nombre, telefono,
                comprobante: ruta
            })
        });
        const d = await r.json();

        if (!d.ok) {
            // Si alguien se adelanto, se vuelven a pedir las horas para que
            // vea el hueco real en vez de insistir contra uno ocupado.
            if (d.ocupado) resBuscarHoras();
            throw new Error(d.error || t.resErrEnvio);
        }

        nodo('resGracias').previousElementSibling.classList.add('hidden');
        nodo('resGracias').classList.remove('hidden');
        nodo('resGracias').scrollIntoView({ behavior: 'smooth', block: 'center' });

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

resLlenarSelects();
resBuscarHoras();
