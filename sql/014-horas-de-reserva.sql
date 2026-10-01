-- Ejecutar en Supabase (SQL Editor > New query > Run). Son dos lineas.
--
-- Por que
-- -------
-- La tabla exigia "horas between 3 and 8", porque cuando se creo la reserva
-- minima era de 3 horas. Ahora hay tarifa de 2 horas y la base rechazaria
-- esas reservas.
--
-- Y de paso se deja un margen ancho (1 a 12) en vez de clavar el minimo y el
-- maximo del momento. El precio y las duraciones son una decision de negocio
-- que va a seguir cambiando; quien tiene que decidirla es el codigo, que se
-- toca en un minuto, no una restriccion de la base que obliga a venir aqui
-- cada vez. Lo que se queda aqui es solo un tope de cordura: que nadie reserve
-- cero horas ni cien.

alter table reservas drop constraint if exists reservas_horas_validas;

alter table reservas add constraint reservas_horas_validas check (horas between 1 and 12);
