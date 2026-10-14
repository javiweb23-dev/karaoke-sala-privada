// =========================================================================
// Las frases del formulario de reserva, en los dos idiomas
//
// Viven aqui y no dentro de cada pagina porque el formulario sale en dos
// sitios: en el home (seccion "Haz tu reserva") y en /reserva, que es la
// pagina suelta para mandarle el enlace a un cliente. Escritas una sola vez
// no se pueden descuadrar.
//
// Las dos paginas lo mezclan en su propio TEXTOS con ...TEXTOS_RESERVA.es
//
// Ojo: el mensaje que se le manda a Javier por WhatsApp NO esta aqui, va
// siempre en castellano y se arma en reserva-comun.js. Lo lee el, no el
// cliente.
// =========================================================================
const TEXTOS_RESERVA = {
    es: {
        resTitulo: "Haz tu reserva",
        resTexto: "La sala completa para tu grupo. Elige el día, cuántos son y cuánto tiempo.",
        resCampoFecha: "Día",
        resCampoHoras: "Duración",
        resCampoPersonas: "¿Cuántas personas son?",
        resCampoHora: "¿A qué hora empiezan?",
        resCampoNombre: "Nombre y apellido",
        resCampoTelefono: "Número de WhatsApp",
        resBtnEnviar: "Reservar por WhatsApp",
        resGraciasTitulo: "¡Listo, ya está apartada!",
        resGraciasTexto: "Te abrimos WhatsApp con los datos de tu reserva. Mándanoslo y te pasamos el pago móvil para confirmarla.",
        resGraciasWa: "Enviar por WhatsApp",
        resElegirDia: "Elige un día para ver las horas libres.",
        resSinHoras: "No disponible. Intenta con otra fecha y hora.",
        resSinSitio: "Ese día ya no caben {n} horas.",
        resVerDe: "Ver las de {n} horas",
        resCargando: "Buscando horas libres...",
        resHoraPl: "horas",
        resResumenEntran: "Llegan a las",
        resResumenCantan: "Cantan de",
        resResumenSalen: "Salen antes de",
        resResumenCortesia: "El tiempo empieza a correr 20 minutos después de llegar, para que se instalen con calma. Al final les damos otros 20 para recoger. Nada de eso se cobra.",
        resResumenCuenta: "{p} personas × {h} horas × {precio} por persona cada hora",
        resResumenTotal: "Total",
        resResumenCabeza: "Le toca a cada uno",
        resResumenPagoTodo: "Se paga completo para apartar el día.",
        resMinimoNota: "Mínimo se cobran {n} personas, aunque vengan menos.",
        resComboGanado: "¡Te lo ganaste!",
        resComboQue: "Va incluida 1 ración de tequeños y 1 refresco de 2 litros.",
        resComboAviso: "Si tu pedido pasa los {n} recibes de obsequio una ración de tequeños y un refresco de 2 litros.",
        resErrNombre: "Escribe tu nombre y apellido.",
        resErrTelefono: "Escribe un teléfono válido.",
        resErrEnvio: "No se pudo enviar. Revisa tu internet e inténtalo de nuevo.",
        resEnviando: "Guardando..."
    },
    en: {
        resTitulo: "Book your night",
        resTexto: "The whole room, just for your group. Pick the day, how many you are and how long.",
        resCampoFecha: "Day",
        resCampoHoras: "Length",
        resCampoPersonas: "How many people?",
        resCampoHora: "What time do you start?",
        resCampoNombre: "Full name",
        resCampoTelefono: "WhatsApp number",
        resBtnEnviar: "Book on WhatsApp",
        resGraciasTitulo: "Done, the slot is yours!",
        resGraciasTexto: "We opened WhatsApp with your booking details. Send it over and we will reply with the payment details to confirm it.",
        resGraciasWa: "Send on WhatsApp",
        resElegirDia: "Pick a day to see the free slots.",
        resSinHoras: "Not available. Try another date and time.",
        resSinSitio: "No room for {n} hours that day.",
        resVerDe: "See the {n}-hour slots",
        resCargando: "Looking for free slots...",
        resHoraPl: "hours",
        resResumenEntran: "You arrive at",
        resResumenCantan: "Singing from",
        resResumenSalen: "Out before",
        resResumenCortesia: "The clock starts 20 minutes after you arrive, so you can settle in. At the end you get another 20 to pack up. None of it is charged.",
        resResumenCuenta: "{p} people × {h} hours × {precio} per person each hour",
        resResumenTotal: "Total",
        resResumenCabeza: "Each of you pays",
        resResumenPagoTodo: "Paid in full to hold the date.",
        resMinimoNota: "A minimum of {n} people is charged, even if fewer come.",
        resComboGanado: "You earned it!",
        resComboQue: "A portion of tequeños and a 2-litre soda are included.",
        resComboAviso: "If your booking goes over {n} you get a free portion of tequeños and a 2-litre soda.",
        resErrNombre: "Please write your full name.",
        resErrTelefono: "Please write a valid phone number.",
        resErrEnvio: "Could not send it. Check your connection and try again.",
        resEnviando: "Saving..."
    }
};
