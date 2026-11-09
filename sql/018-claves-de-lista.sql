-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
--
-- LAS CLAVES DE /lista
--
-- Para que
-- --------
-- A quien reserva se le manda un enlace a mikaraokelatino.com/lista con una
-- clave. Ahi ve el catalogo completo, igual que en la sala, y si le falta
-- alguna cancion la pide con antelacion para tenerla lista esa noche.
--
-- La clave la crea Javier a mano aqui mismo y la borra cuando pasa el evento.
-- No caduca sola a proposito: una fila menos es mas facil de entender que una
-- fecha que nadie recuerda haber puesto.
--
-- Por que con clave y no abierto
-- ------------------------------
-- El catalogo en crudo (canciones.js) ya es publico y no pasa nada: nadie
-- monta un karaoke leyendo un archivo de codigo. Lo que si tiene valor para
-- un competidor es la PAGINA: buscable, con caratulas, lista para proyectar.
-- Eso es lo que la clave protege.

create table if not exists claves_lista (
    id        bigserial   primary key,
    clave     text        not null unique,
    nota      text,                    -- "Reserva sabado 15 - Marieta"
    creada_en timestamptz not null default now()
);

comment on column claves_lista.nota is
    'De quien es esta clave. Sale en las sugerencias, para saber a que reserva avisarle.';

-- ---------------------------------------------------------------------------
-- La tabla NO se lee desde el navegador. Si se pudiera, cualquiera pediria la
-- lista entera de claves y se acabo el control. Solo se puede PREGUNTAR por
-- una clave concreta, a traves de esta funcion.
-- ---------------------------------------------------------------------------
create or replace function validar_clave_lista(p_clave text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nota text;
begin
    if p_clave is null or length(trim(p_clave)) < 3 then
        return null;
    end if;

    -- Se devuelve la nota de la clave. Cadena vacia = la clave existe pero no
    -- tiene nota. Nulo = no existe.
    select coalesce(nota, '')
      into v_nota
      from claves_lista
     where upper(trim(clave)) = upper(trim(p_clave));

    return v_nota;
end;
$$;

alter table claves_lista enable row level security;

-- Sin politicas de lectura: ni con RLS ni sin el se puede listar la tabla.
revoke all on claves_lista from anon, authenticated;
grant execute on function validar_clave_lista(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- COMO SE USA
--
-- Crear una clave para una reserva:
--
--   insert into claves_lista (clave, nota)
--   values ('MARIETA15', 'Reserva sabado 15 de noviembre - Marieta');
--
-- Ver las que hay activas:
--
--   select clave, nota, creada_en from claves_lista order by creada_en desc;
--
-- Borrarla despues del evento:
--
--   delete from claves_lista where clave = 'MARIETA15';
--
-- Las sugerencias que dejen llegan a sugerencias_canciones con la nota en la
-- columna nombre_usuario, asi sabes de que reserva vino cada peticion:
--
--   select texto, nombre_usuario, veces, creada_en
--     from sugerencias_canciones
--    where estado = 'pendiente'
--    order by creada_en desc;
-- ---------------------------------------------------------------------------
