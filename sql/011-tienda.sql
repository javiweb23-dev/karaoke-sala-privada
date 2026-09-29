-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
--
-- LA TIENDA. Nada que ver con el karaoke: son los refrigerios que pide la
-- gente del area, que muchas veces ni va a cantar. Por eso la tienda funciona
-- con la sala cerrada y no mira si hay sesion abierta ni pide codigo.
--
-- Nada de esto toca las tablas del karaoke. Si borras las tres tablas de aqui,
-- el karaoke sigue funcionando exactamente igual.
--
-- SEGURIDAD: el navegador NO entra aqui. Ni a leer. Todo pasa por los
-- endpoints /api/tienda-*.js, que usan la clave secreta, y los de gestion
-- exigen ademas el PIN del operador. Es mas estricto que el resto del
-- proyecto a proposito: aqui hay precios, y un precio que se pueda cambiar
-- desde el navegador es dinero regalado.

-- ------------------------------------------------------------------ productos

create table if not exists tienda_productos (
    id          bigserial   primary key,
    nombre      text        not null,
    descripcion text        not null default '',
    precio_usd  numeric(10,2) not null check (precio_usd >= 0),
    imagen_url  text,
    activo      boolean     not null default true,
    orden       integer     not null default 0,
    creado_en   timestamptz not null default now()
);

-- El orden lo decide el operador arrastrando en el panel. El id como segundo
-- criterio evita que dos productos con el mismo orden se intercambien de sitio
-- solos entre una carga y la siguiente.
create index if not exists tienda_productos_visibles
    on tienda_productos (activo, orden, id);

-- ------------------------------------------------------------------- pedidos

-- Las lineas se guardan en jsonb y CON EL PRECIO DE ESE MOMENTO, no como
-- referencia a tienda_productos. Si mañana sube la coca cola o borras un
-- producto, el pedido de anoche tiene que seguir diciendo lo que se cobro.
create table if not exists tienda_pedidos (
    id           bigserial   primary key,
    nombre       text        not null,
    ubicacion    text        not null,
    lineas       jsonb       not null,
        -- [{ producto_id, nombre, precio_usd, cantidad, subtotal_usd }]
    total_usd    numeric(10,2) not null,
    tasa_bs      numeric(14,4),
    total_bs     numeric(14,2),
    tasa_fuente  text,
        -- manual | dolarapi | erapi | cache | ninguna
    estado       text        not null default 'nuevo',
        -- nuevo | entregado | anulado
    creado_en    timestamptz not null default now()
);

create index if not exists tienda_pedidos_recientes
    on tienda_pedidos (creado_en desc);

-- -------------------------------------------------------------------- config

-- Una sola fila (id = 1). Existe por la tasa manual: las APIs del BCV no son
-- oficiales y se caen. Cuando eso pasa a mitad de la noche, el operador pone
-- la tasa a mano desde el panel y la tienda sigue vendiendo.
create table if not exists tienda_config (
    id               integer     primary key default 1 check (id = 1),
    usar_tasa_manual boolean     not null default false,
    tasa_manual      numeric(14,4),
    -- Ultima tasa que se logro traer de internet. Es el paracaidas: si las dos
    -- APIs fallan y no hay tasa manual, se muestra esta en vez de nada.
    tasa_cache       numeric(14,4),
    tasa_cache_en    timestamptz,
    actualizado_en   timestamptz not null default now()
);

insert into tienda_config (id) values (1) on conflict (id) do nothing;

-- --------------------------------------------------------------- permisos

-- Todo cerrado al navegador. La clave publica que esta a la vista en el HTML
-- no abre nada de la tienda: los precios solo se leen por /api.
alter table tienda_productos enable row level security;
alter table tienda_pedidos   enable row level security;
alter table tienda_config    enable row level security;

revoke all on tienda_productos from anon, authenticated;
revoke all on tienda_pedidos   from anon, authenticated;
revoke all on tienda_config    from anon, authenticated;

revoke all on sequence tienda_productos_id_seq from anon, authenticated;
revoke all on sequence tienda_pedidos_id_seq   from anon, authenticated;

-- ---------------------------------------------------------- fotos de productos

-- Bucket publico: las fotos se ven en la tienda sin login, como en cualquier
-- tienda. Lo que NO es publico es subir, y eso lo controla /api/tienda-admin.js
-- con el PIN.
insert into storage.buckets (id, name, public)
values ('tienda', 'tienda', true)
on conflict (id) do update set public = true;

-- Ver las fotos si; subirlas, cambiarlas o borrarlas solo con la clave
-- secreta desde el endpoint.
drop policy if exists tienda_fotos_ver on storage.objects;
create policy tienda_fotos_ver on storage.objects
    for select using (bucket_id = 'tienda');

-- ------------------------------------------------------- productos de arranque

-- Los cuatro de prueba. Cambialos, borralos o agrega los tuyos desde el panel
-- (tienda-admin.html). Se insertan solo si la tabla esta vacia, asi que volver
-- a ejecutar este archivo no duplica nada ni pisa lo que ya hayas editado.
insert into tienda_productos (nombre, descripcion, precio_usd, orden)
select * from (values
    ('Bolsa de hielo',    'Bolsa de hielo en cubos, lista para la cava.', 1.50, 1),
    ('Coca Cola 2 Lts',   'Refresco de 2 litros bien frio.',              3.00, 2),
    ('Vasos plasticos',   'Paquete de 25 vasos plasticos.',               2.00, 3),
    ('Helados',           'Helado individual. Consulta los sabores.',     1.00, 4)
) as nuevos(nombre, descripcion, precio_usd, orden)
where not exists (select 1 from tienda_productos);

-- ---------------------------------------------------------------------------
-- SI QUIERES QUITAR LA TIENDA POR COMPLETO:
--
--   drop table if exists tienda_pedidos;
--   drop table if exists tienda_productos;
--   drop table if exists tienda_config;
--   delete from storage.objects where bucket_id = 'tienda';
--   delete from storage.buckets where id = 'tienda';
--
-- El karaoke no se entera: no comparte ni una tabla con esto.
-- ---------------------------------------------------------------------------
