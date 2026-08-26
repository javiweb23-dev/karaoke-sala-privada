-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
--
-- Registro de lo que la gente busca y NO encuentra.
--
-- Es la tabla mas util del sistema para decidir que descargar: dice que
-- canciones te piden de verdad, con datos de clientes reales en lugar de
-- suposiciones. El cliente no ve nada distinto; se anota en silencio.
--
-- Para consultarla, en Supabase > Table Editor > busquedas_fallidas,
-- ordenando por "veces" de mayor a menor.

create table if not exists busquedas_fallidas (
    id              bigserial primary key,
    consulta        text        not null,          -- lo que escribio el cliente
    consulta_norm   text        not null unique,   -- sin acentos, mayusculas
    nombre_usuario  text,
    veces           integer     not null default 1,
    estado          text        not null default 'pendiente',
        -- pendiente | descargada | descartada
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

-- El registro pasa solo por la funcion (security definer), asi el navegador
-- no puede escribir filas arbitrarias en la tabla.
alter table busquedas_fallidas enable row level security;

drop policy if exists bf_lectura on busquedas_fallidas;
create policy bf_lectura on busquedas_fallidas
    for select using (true);

grant execute on function registrar_busqueda_fallida(text, text, text) to anon, authenticated;
