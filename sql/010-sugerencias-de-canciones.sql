-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
--
-- Las sugerencias de canciones se van a su propia tabla.
--
-- Por que
-- -------
-- Hasta ahora compartian tabla con las busquedas sin resultado, separadas
-- solo por una columna "origen". El problema es que busquedas_fallidas tiene
-- unique (consulta_norm): si tres personas BUSCAN "Aguanile" y una la SUGIERE,
-- las cuatro caen en la misma fila. El contador queda mezclado y el origen se
-- pierde, cuando son justo las dos cosas que interesa distinguir.
--
-- Y son señales distintas:
--   - Una busqueda sin resultado es gratis. La deja cualquiera sin querer, y
--     por eso hay mucha: dice lo que la gente espera encontrar.
--   - Una sugerencia cuesta. Hay que abrir el formulario y escribirla. Pocas,
--     pero cada una vale por muchas busquedas.
--
-- busquedas_fallidas se queda como esta y sigue funcionando igual. La columna
-- origen se deja donde esta: ya no se usara para nada nuevo, pero borrarla
-- perderia el dato de las que ya estan marcadas.

create table if not exists sugerencias_canciones (
    id             bigserial   primary key,
    texto          text        not null,
    texto_norm     text        not null unique,   -- sin acentos, en mayusculas
    nombre_usuario text,
    sesion_id      bigint,
    veces          integer     not null default 1,
    estado         text        not null default 'pendiente',
        -- pendiente | descargada | descartada
    creada_en      timestamptz not null default now(),
    actualizada_en timestamptz not null default now()
);

create index if not exists sugerencias_canciones_ranking
    on sugerencias_canciones (estado, veces desc);

-- Como en las demas tablas: se escribe solo por esta funcion, asi el
-- navegador no puede meter filas arbitrarias.
--
-- La normalizacion la hace el cliente, que ya tiene sinAcentos(), para no
-- depender de la extension unaccent de Postgres. Igual que en 001.
create or replace function sugerir_cancion(
    p_texto   text,
    p_norm    text,
    p_usuario text   default null,
    p_sesion  bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Ruido de teclado: hace falta algo que se pueda buscar.
    if p_norm is null or length(trim(p_norm)) < 3 then
        return;
    end if;

    insert into sugerencias_canciones (texto, texto_norm, nombre_usuario, sesion_id)
    values (trim(p_texto), trim(p_norm), p_usuario, p_sesion)
    on conflict (texto_norm) do update
        set veces          = sugerencias_canciones.veces + 1,
            actualizada_en = now(),
            -- Se queda el primero que la pidio: es a quien hay que avisarle
            -- cuando la cancion ya este.
            nombre_usuario = coalesce(sugerencias_canciones.nombre_usuario,
                                      excluded.nombre_usuario);
end;
$$;

alter table sugerencias_canciones enable row level security;

drop policy if exists sug_lectura on sugerencias_canciones;
create policy sug_lectura on sugerencias_canciones
    for select using (true);

grant execute on function sugerir_cancion(text, text, text, bigint) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Mudanza de lo que ya estaba marcado como sugerencia
-- ---------------------------------------------------------------------------
-- Se copian a la tabla nueva y se dejan en la vieja como busqueda normal, que
-- es lo que pasaron a ser: la fila mezclaba las dos cosas y no hay forma de
-- saber cuantas de esas "veces" fueron sugerencia.

insert into sugerencias_canciones (texto, texto_norm, nombre_usuario, creada_en)
select consulta, consulta_norm, nombre_usuario, creada_en
  from busquedas_fallidas
 where origen = 'sugerencia'
    on conflict (texto_norm) do nothing;

update busquedas_fallidas
   set origen = 'busqueda'
 where origen = 'sugerencia';
