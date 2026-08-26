-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
-- Depende de 001-youtube-y-busquedas.sql.
--
-- IDEA: no hay que saber DONDE esta el cliente, sino que esta AQUI Y AHORA.
-- El codigo solo se ve en la pantalla de la sala, asi que verlo ya demuestra
-- presencia fisica. Sin GPS, sin permisos del navegador, sin contraseñas.
--
-- Todo esto es OPCIONAL: mientras no haya una sesion abierta, el sistema se
-- comporta exactamente como antes y no se le pide codigo a nadie.

create table if not exists sesiones (
    id            bigserial   primary key,
    codigo        text        not null,
    estado        text        not null default 'abierta',   -- abierta | cerrada
    nombre_grupo  text,
    abierta_en    timestamptz not null default now(),
    cerrada_en    timestamptz
);

-- Garantiza a nivel de base de datos que nunca haya dos sesiones abiertas.
create unique index if not exists sesiones_una_sola_abierta
    on sesiones (estado) where estado = 'abierta';

create index if not exists sesiones_recientes on sesiones (abierta_en desc);

-- Cada solicitud queda atada a la sesion en la que se pidio.
alter table "Solicitudes"
    add column if not exists sesion_id bigint references sesiones(id);

-- ---------------------------------------------------------------------------
-- Lo importante: el cliente NUNCA puede leer el codigo.
-- Si pudiera consultarlo desde el navegador, el control no serviria de nada.
-- Solo se expone una vista con lo minimo: si hay sesion y cual es su id.
-- ---------------------------------------------------------------------------

create or replace view sesion_activa as
    select id, nombre_grupo, abierta_en
    from sesiones
    where estado = 'abierta';

revoke all on sesiones from anon, authenticated;
grant select on sesion_activa to anon, authenticated;

-- Abrir y cerrar sesiones, y leer el codigo, pasa solo por /api/sesion.js,
-- que usa la clave secreta y exige el PIN del operador. Por eso aqui no hay
-- ninguna funcion accesible desde el navegador.
