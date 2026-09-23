-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
--
-- Canciones que los clientes reportan como defectuosas.
--
-- Un karaoke malo se descubre cantando: el archivo no tiene sonido, trae la
-- voz del cantante encima, la letra va corrida... Hasta ahora eso se perdia
-- porque el cliente se encogia de hombros y pedia otra. Con esto queda
-- anotado y se puede reemplazar el archivo.
--
-- El motivo importa tanto como la cancion: no se arregla igual una que no
-- suena que una que trae la voz. Por eso se guardan por separado, y la misma
-- cancion puede tener dos reportes distintos.
--
-- Se lee sola al correr "npm run actualizar", que la cruza con la fecha de
-- los MP4 y solo muestra lo que todavia no has reemplazado.

create table if not exists canciones_con_error (
    id             bigserial   primary key,
    identificador  text        not null,   -- "ARTISTA - TITULO", la misma
                                           -- clave con la que se busca el MP4
    motivo         text        not null,
    nombre_usuario text,
    sesion_id      bigint,
    veces          integer     not null default 1,
    estado         text        not null default 'pendiente',
        -- pendiente | arreglada | descartada
    creada_en      timestamptz not null default now(),
    actualizada_en timestamptz not null default now(),

    -- La misma queja sobre la misma cancion suma en vez de duplicar. Dos
    -- quejas distintas de la misma cancion sí son dos filas.
    unique (identificador, motivo)
);

create index if not exists canciones_con_error_ranking
    on canciones_con_error (estado, veces desc);

-- Se registra solo por esta funcion (security definer), asi el navegador no
-- puede escribir filas arbitrarias en la tabla. Es la misma proteccion que
-- lleva busquedas_fallidas.
create or replace function reportar_cancion_con_error(
    p_identificador text,
    p_motivo        text,
    p_usuario       text   default null,
    p_sesion        bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Ruido: sin cancion o sin motivo no se anota nada.
    if p_identificador is null or length(trim(p_identificador)) < 3 then
        return;
    end if;
    if p_motivo is null or length(trim(p_motivo)) < 3 then
        return;
    end if;

    insert into canciones_con_error (identificador, motivo, nombre_usuario, sesion_id)
    values (upper(trim(p_identificador)), trim(p_motivo), p_usuario, p_sesion)
    on conflict (identificador, motivo) do update
        set veces = case
                -- Si seguia pendiente, es otra persona quejandose de lo mismo.
                when canciones_con_error.estado = 'pendiente'
                    then canciones_con_error.veces + 1
                -- Si ya se habia dado por arreglada, vuelve a empezar: el
                -- archivo nuevo tambien esta mal, y eso no es lo mismo que
                -- diez quejas viejas acumuladas.
                else 1
            end,
            estado         = 'pendiente',
            nombre_usuario = coalesce(excluded.nombre_usuario, canciones_con_error.nombre_usuario),
            sesion_id      = coalesce(excluded.sesion_id, canciones_con_error.sesion_id),
            actualizada_en = now();
end;
$$;

alter table canciones_con_error enable row level security;

-- Leer si; escribir solo por la funcion de arriba.
drop policy if exists cce_lectura on canciones_con_error;
create policy cce_lectura on canciones_con_error
    for select using (true);

grant execute on function reportar_cancion_con_error(text, text, text, bigint)
    to anon, authenticated;
