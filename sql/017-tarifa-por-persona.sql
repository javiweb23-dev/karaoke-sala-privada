-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
-- Depende de 012-reservas.sql y 013-reserva-sin-personas.sql.
--
-- LA TARIFA CAMBIA Y EL ABONO DESAPARECE
--
-- Que cambia en el negocio
-- ------------------------
--   1. Antes la sala tenia precio cerrado (2h $40, 3h $60, 4h $70) y daba
--      igual cuantos vinieran. Ahora se cobra $2 por persona y por hora, con
--      un minimo de 4 personas y 2 horas: quien quiera cantar solo puede,
--      pero paga como si fueran cuatro, porque ocupa la sala igual.
--
--   2. Ya no se abona el 50% ni se sube comprobante. Se reserva, le llega un
--      WhatsApp a Javier con los datos, el manda el pago movil y confirma la
--      reserva cuando ha cobrado todo.
--
-- Que cambia en la base
-- ---------------------
-- Casi nada, y es a proposito: las columnas siguen donde estaban para que las
-- reservas VIEJAS se sigan leyendo igual en el panel.
--
--   personas     vuelve a usarse. 013 la habia dejado opcional porque se
--                quito del formulario; ahora se pregunta otra vez. Se queda
--                opcional por las viejas, que la tienen vacia.
--
--   abono_usd    se escribe 0. Es "not null" desde 012 y no se toca: borrarla
--                perderia lo que de verdad abonaron los clientes de antes.
--                Se le pone un valor por defecto para que nadie tenga que
--                acordarse de mandarlo.
--
--   comprobante_url  se queda vacia en las nuevas. En las viejas sigue su
--                    archivo, y el panel sigue sabiendo abrirlo.

alter table reservas alter column abono_usd set default 0;

-- Que no se cuele un disparate: la sala tiene 14 sitios. Se permite nulo por
-- las reservas de antes de que se volviera a preguntar.
alter table reservas drop constraint if exists reservas_personas_validas;
alter table reservas
    add constraint reservas_personas_validas
    check (personas is null or (personas >= 1 and personas <= 14));

comment on column reservas.personas is
    'Cuantos vienen. Se cobran minimo 4 aunque sean menos.';
comment on column reservas.abono_usd is
    'Historico: el 50% que se abonaba antes. Desde octubre de 2026 va en 0, se cobra todo antes de confirmar.';

-- ---------------------------------------------------------------------------
-- OJO CON EL BLOQUEO DE HORARIOS
--
-- api/reserva.js cambio con esto: antes una reserva "pendiente" ya bloqueaba
-- el horario, porque para crearla habia que subir el comprobante del 50% y
-- por tanto algo habia pagado. Ahora no se paga nada por la web, asi que
-- bloquear al crear dejaria que cualquiera apartase todos los sabados del mes
-- gratis.
--
-- Desde ahora SOLO bloquean las confirmadas. Mientras una reserva este
-- pendiente, esa hora se le sigue ofreciendo a los demas: hay que confirmarla
-- en cuanto se cobre.
--
-- Para ver lo que esta esperando cobro:
--
--   select id, fecha, inicio_min, nombre, telefono, personas, total_usd
--     from reservas
--    where estado = 'pendiente'
--    order by fecha, inicio_min;
-- ---------------------------------------------------------------------------
