-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
-- Depende de 002-sesiones-de-sala.sql.
--
-- Control del tiempo contratado. La sala se cobra por horas, asi que el
-- operador fija a que hora empieza a correr y cuantas horas se pagaron.
-- El reproductor muestra la cuenta atras en la TV.
--
-- Se guarda la hora de FIN, no los minutos que quedan: asi el reloj sigue
-- corriendo aunque se recargue la pagina o se apague la TV un rato.

alter table sesiones
    add column if not exists inicio_previsto timestamptz,
    add column if not exists fin_previsto    timestamptz;

-- La vista que ve el navegador del cliente sigue sin exponer el codigo.
-- Se le agrega el fin para poder avisar tambien en el celular si hiciera
-- falta; la hora de fin no es un secreto.
create or replace view sesion_activa as
    select id, nombre_grupo, abierta_en, inicio_previsto, fin_previsto
    from sesiones
    where estado = 'abierta';

grant select on sesion_activa to anon, authenticated;
