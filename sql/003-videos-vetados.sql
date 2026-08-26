-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
--
-- POR QUE EXISTE ESTO:
--
-- La API de YouTube marca como embeddable=true videos que luego, al
-- reproducirlos, dan error 150 ("el dueño no permite embeberlo"). Es tipico
-- de musica con sello discografico detras. No hay ningun campo que lo avise
-- por adelantado: solo se descubre al intentarlo en la TV.
--
-- Como no se puede predecir, se aprende. Cuando un video falla asi, el
-- reproductor lo apunta aqui y no se vuelve a ofrecer nunca mas. El sistema
-- mejora solo con cada noche de uso.

create table if not exists videos_vetados (
    video_id   text        primary key,
    motivo     text,
    consulta   text,                       -- que buscaban cuando aparecio
    creado_en  timestamptz not null default now()
);

create index if not exists videos_vetados_recientes
    on videos_vetados (creado_en desc);

-- Solo la clave secreta (los endpoints) toca esta tabla: el navegador no
-- tiene por que leerla ni escribirla.
alter table videos_vetados enable row level security;
revoke all on videos_vetados from anon, authenticated;
