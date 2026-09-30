-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
--
-- Reseñas de clientes para la web publica (karaokelatino.com).
--
-- Como funciona
-- -------------
-- Javier le manda el link a quien ya vino. Esa persona escribe su nombre, las
-- estrellas, el texto y —si quiere— una foto. La reseña NO sale publicada:
-- entra como 'pendiente' y solo se ve en la web cuando el la aprueba desde
-- resenas-admin.html.
--
-- Por que con aprobacion
-- ----------------------
-- El link se reenvia solo. Basta que llegue a la persona equivocada para que
-- aparezca una groseria o una foto fea en la portada del negocio. Aprobar
-- cuesta un clic y evita tener que estar vigilando la web.
--
-- Nada de esto toca al karaoke. Es una tabla nueva y un bucket nuevo: si
-- mañana se borrara entero, la app de la sala seguiria funcionando igual.

create table if not exists resenas (
    id         bigserial   primary key,
    nombre     text        not null,
    texto      text        not null,
    estrellas  smallint    not null default 5,
    foto_url   text,                             -- null = sin foto, es opcional
    estado     text        not null default 'pendiente',
        -- pendiente | publicada | descartada
    creada_en  timestamptz not null default now(),

    constraint resenas_estrellas_validas check (estrellas between 1 and 5)
);

-- El home pide las publicadas ordenadas por fecha; con esto no recorre la
-- tabla entera cuando haya muchas.
create index if not exists resenas_publicadas
    on resenas (estado, creada_en desc);


-- ---------------------------------------------------------------------------
-- Escribir: solo por esta funcion
-- ---------------------------------------------------------------------------
-- Igual que en las demas tablas del proyecto. Asi el navegador no puede meter
-- filas a su antojo ni —sobre todo— marcarse una reseña como 'publicada'.
-- El estado lo pone el servidor y siempre es 'pendiente'.

create or replace function dejar_resena(
    p_nombre    text,
    p_texto     text,
    p_estrellas smallint default 5,
    p_foto      text     default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_nombre text := trim(coalesce(p_nombre, ''));
    v_texto  text := trim(coalesce(p_texto, ''));
begin
    -- Ruido de teclado: hace falta un nombre y algo que leer.
    if length(v_nombre) < 2 or length(v_texto) < 10 then
        return;
    end if;

    -- Se corta en el servidor, no en el navegador: quien llame a la funcion
    -- por su cuenta tampoco puede meter un texto de un megabyte.
    insert into resenas (nombre, texto, estrellas, foto_url)
    values (
        left(v_nombre, 40),
        left(v_texto, 600),
        greatest(1, least(5, coalesce(p_estrellas, 5))),
        left(nullif(trim(coalesce(p_foto, '')), ''), 400)
    );
end;
$$;

grant execute on function dejar_resena(text, text, smallint, text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Leer: solo las aprobadas
-- ---------------------------------------------------------------------------
-- Las pendientes no las ve nadie desde el navegador. El panel de aprobacion
-- las lee con la clave secreta a traves de /api, que se salta RLS.

alter table resenas enable row level security;

drop policy if exists resenas_lectura on resenas;
create policy resenas_lectura on resenas
    for select using (estado = 'publicada');

-- Cinturon ademas de los tirantes: sin politica de update ni delete, RLS ya
-- los bloquea, pero se revocan por si algun dia se activa una por error.
revoke insert, update, delete on resenas from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Las fotos
-- ---------------------------------------------------------------------------
-- Bucket publico: las fotos se ven en la web sin pedir permiso. Subir si se
-- permite a cualquiera, porque el formulario es publico; lo que protege al
-- negocio es que la resena no se publica hasta que Javier la apruebe, y una
-- foto suelta en el bucket no se ve en ninguna parte si su resena no salio.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'resenas', 'resenas', true,
    5242880,                                      -- 5 MB por foto
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
    set public             = true,
        file_size_limit    = 5242880,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists resenas_fotos_ver    on storage.objects;
drop policy if exists resenas_fotos_subir  on storage.objects;

create policy resenas_fotos_ver on storage.objects
    for select using (bucket_id = 'resenas');

create policy resenas_fotos_subir on storage.objects
    for insert with check (bucket_id = 'resenas');
