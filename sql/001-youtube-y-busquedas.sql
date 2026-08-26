-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
-- Todo es aditivo: nada de lo que ya funciona se toca.

-- ---------------------------------------------------------------------------
-- PASO 1 — Registro de lo que la gente busca y NO encuentra.
-- Es la tabla mas valiosa del sistema: dice que canciones faltan de verdad,
-- con datos de clientes reales en lugar de suposiciones.
-- ---------------------------------------------------------------------------

create table if not exists busquedas_fallidas (
    id              bigserial primary key,
    consulta        text        not null,          -- lo que escribio el cliente
    consulta_norm   text        not null unique,   -- sin acentos, mayusculas
    nombre_usuario  text,
    veces           integer     not null default 1,
    estado          text        not null default 'pendiente',
        -- pendiente | resuelta | descartada | sin_resultado
    video_id        text,                          -- ID de YouTube ya validado
    titulo_resuelto text,                          -- "ARTISTA - TITULO" final
    creada_en       timestamptz not null default now(),
    actualizada_en  timestamptz not null default now()
);

create index if not exists busquedas_fallidas_ranking
    on busquedas_fallidas (estado, veces desc);

-- Un upsert atomico: si la misma busqueda se repite, suma en vez de duplicar.
-- La normalizacion la hace el cliente (ya tiene sinAcentos()) para no depender
-- de la extension unaccent de Postgres.
create or replace function registrar_busqueda_fallida(
    p_consulta text,
    p_norm     text,
    p_usuario  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_norm is null or length(trim(p_norm)) < 3 then
        return;  -- ignora ruido de teclado
    end if;

    insert into busquedas_fallidas (consulta, consulta_norm, nombre_usuario)
    values (trim(p_consulta), trim(p_norm), p_usuario)
    on conflict (consulta_norm) do update
        set veces          = busquedas_fallidas.veces + 1,
            actualizada_en = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- PASO 2 — Cache de resultados de YouTube.
-- Cada search.list cuesta 100 unidades de las 10.000 diarias gratis (o sea:
-- 100 busquedas al dia). El cache es lo que hace viable la cuota, porque las
-- mismas canciones se piden una y otra vez.
-- ---------------------------------------------------------------------------

create table if not exists youtube_cache (
    id             bigserial primary key,
    consulta_norm  text        not null unique,
    resultados     jsonb       not null,   -- array de candidatos ya puntuados
    creada_en      timestamptz not null default now()
);

create index if not exists youtube_cache_edad on youtube_cache (creada_en);

-- ---------------------------------------------------------------------------
-- PASO 3 — La cola aprende a reproducir desde dos motores.
-- Con default 'local', TODAS las filas existentes siguen comportandose igual.
-- ---------------------------------------------------------------------------

alter table "Solicitudes"
    add column if not exists fuente       text not null default 'local',  -- local | youtube
    add column if not exists video_id     text,
    add column if not exists respaldo_ids jsonb,   -- ["id2","id3"] por si el 1o falla
    add column if not exists duracion_seg integer;

-- ---------------------------------------------------------------------------
-- Permisos.
-- OJO: esto replica el acceso abierto que ya tiene el proyecto hoy (la clave
-- publishable esta en el HTML del cliente). Sirve para una sala. Antes de
-- vender a varios locales hay que meter sala_id y politicas RLS de verdad.
-- ---------------------------------------------------------------------------

alter table busquedas_fallidas enable row level security;
alter table youtube_cache      enable row level security;

drop policy if exists bf_lectura on busquedas_fallidas;
create policy bf_lectura on busquedas_fallidas
    for select using (true);

drop policy if exists yt_lectura on youtube_cache;
create policy yt_lectura on youtube_cache
    for select using (true);

-- El registro de busquedas pasa solo por la funcion (security definer),
-- asi el cliente no puede escribir filas arbitrarias en la tabla.
grant execute on function registrar_busqueda_fallida(text, text, text) to anon, authenticated;
