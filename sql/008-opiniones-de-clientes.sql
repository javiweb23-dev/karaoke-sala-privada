-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
--
-- Lo que los clientes quieren decirte y no cabe en ninguna otra parte.
--
-- Va aparte de busquedas_fallidas a proposito: ahi se anotan canciones que
-- alguien busco y no estaban, que es una cosa muy concreta. Aqui cabe
-- cualquier cosa: "el microfono 2 suena bajito", "pongan mas salsa vieja",
-- "la sala estaba fria". Texto libre, sin estructura.
--
-- Se leen solas al correr "npm run actualizar", que enseña las nuevas desde
-- la ultima vez que lo corriste.

create table if not exists opiniones_clientes (
    id             bigserial   primary key,
    texto          text        not null,
    nombre_usuario text,
    sesion_id      bigint,
    estado         text        not null default 'pendiente',
        -- pendiente | leida | descartada
    creada_en      timestamptz not null default now()
);

create index if not exists opiniones_clientes_recientes
    on opiniones_clientes (creada_en desc);

-- Se escribe solo por esta funcion (security definer), como en las otras dos
-- tablas: asi el navegador no puede meter filas arbitrarias ni tocar las que
-- ya estan.
create or replace function dejar_opinion(
    p_texto   text,
    p_usuario text   default null,
    p_sesion  bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_texto text := trim(p_texto);
begin
    -- Ruido de teclado: hace falta algo que de verdad se pueda leer.
    if v_texto is null or length(v_texto) < 4 then
        return;
    end if;

    -- Un limite generoso pero limite: sin esto alguien pega un libro entero.
    if length(v_texto) > 500 then
        v_texto := left(v_texto, 500);
    end if;

    insert into opiniones_clientes (texto, nombre_usuario, sesion_id)
    values (v_texto, p_usuario, p_sesion);
end;
$$;

alter table opiniones_clientes enable row level security;

-- Leer si; escribir solo por la funcion de arriba.
drop policy if exists op_lectura on opiniones_clientes;
create policy op_lectura on opiniones_clientes
    for select using (true);

grant execute on function dejar_opinion(text, text, bigint) to anon, authenticated;
