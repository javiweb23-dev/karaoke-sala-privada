-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
--
-- Reservas de la sala desde la web.
--
-- Como funciona
-- -------------
-- El cliente elige dia, hora y cuantas horas, ve el total, paga el 50% por
-- Pago Movil y sube el comprobante. Sin comprobante no hay reserva: por eso
-- no hace falta liberar horarios "apartados" que nadie pago nunca.
--
-- Al crearse, el horario queda ocupado para los demas al instante. Javier
-- confirma el pago despues desde reservas-admin.html.
--
-- Las horas, en minutos desde medianoche
-- --------------------------------------
-- inicio_min y fin_min son enteros: 20:00 son 1200, y la 1:00 de la
-- madrugada SIGUIENTE son 1500 (pasa de 1440 a proposito).
--
-- Se hace asi y no con timestamps para no pelearse con las zonas horarias:
-- el negocio es de Lecheria, las horas son de Lecheria, y una reserva que
-- cruza medianoche sigue perteneciendo a la noche en que empezo. Con
-- timestamptz, una reserva del viernes que acaba a las 2am aparecia el
-- sabado y rompia la cuenta de la noche.

create table if not exists reservas (
    id              bigserial   primary key,

    fecha           date        not null,
    inicio_min      integer     not null,      -- 1200 = 20:00
    fin_min         integer     not null,      -- puede pasar de 1440
    horas           integer     not null,

    -- Ya no se pregunta: caben 14 y el precio no depende de cuantos sean.
    -- Se deja la columna por si algun dia hace falta saberlo.
    -- Quien ya ejecuto la primera version de este archivo tiene que correr
    -- ademas 013-reserva-sin-personas.sql.
    personas        integer,
    nombre          text        not null,
    telefono        text        not null,

    total_usd       numeric(8,2) not null,
    abono_usd       numeric(8,2) not null,
    tasa_bs         numeric(12,4),             -- la del dia, para poder auditar
    comprobante_url text,

    estado          text        not null default 'pendiente',
        -- pendiente | confirmada | cancelada
    creada_en       timestamptz not null default now(),

    constraint reservas_horas_validas    check (horas between 3 and 8),
    constraint reservas_rango_valido     check (fin_min > inicio_min)
);

-- Para buscar que hay ocupado en un dia, que es lo unico que se consulta mucho.
create index if not exists reservas_del_dia
    on reservas (fecha, estado);


-- ---------------------------------------------------------------------------
-- Lo que puede ver el navegador
-- ---------------------------------------------------------------------------
-- Para pintar los horarios libres hace falta saber QUE esta ocupado, pero no
-- QUIEN lo ocupa. Esta vista ensena solo las franjas; el nombre, el telefono
-- y el comprobante no salen de aqui.

create or replace view horarios_ocupados as
    select fecha, inicio_min, fin_min
      from reservas
     where estado in ('pendiente', 'confirmada')
       and fecha >= current_date - 1;

alter view horarios_ocupados set (security_invoker = off);

grant select on horarios_ocupados to anon, authenticated;


-- La tabla en si no la toca nadie desde el navegador: las reservas entran por
-- /api/reserva, que valida el solape con la clave secreta antes de insertar.
-- Si se dejara insertar desde el cliente, dos personas podrian apuntarse a la
-- misma hora a la vez.
alter table reservas enable row level security;

revoke select, insert, update, delete on reservas from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Los comprobantes de pago
-- ---------------------------------------------------------------------------
-- Bucket PRIVADO, al reves que el de las resenas: un comprobante de Pago Movil
-- lleva datos de una persona y no puede quedar a la vista de cualquiera con
-- la direccion. Se sube desde el formulario, pero solo se lee con la clave
-- secreta, que es la que usa el panel de Javier.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'comprobantes', 'comprobantes', false,
    5242880,                                   -- 5 MB
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
    set public             = false,
        file_size_limit    = 5242880,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

drop policy if exists comprobantes_subir on storage.objects;

create policy comprobantes_subir on storage.objects
    for insert with check (bucket_id = 'comprobantes');

-- Sin politica de select: nadie los lee desde el navegador. El panel los pide
-- a /api/reserva, que genera un enlace temporal con la clave secreta.
