-- Ejecutar en Supabase (SQL Editor > New query > Run).
-- MEJOR CON LA SALA VACIA: durante un segundo se recrean los permisos.
--
-- POR QUE:
-- Se comprobo con la clave publica que esta a la vista en el HTML, y con ella
-- cualquiera podia BORRAR la cola entera de un solo pedido HTTP, o cambiar
-- cualquier campo de cualquier solicitud. Un DELETE sobre Solicitudes
-- respondia 204 (permitido).
--
-- QUE SE PERMITE A PARTIR DE AHORA (comprobado contra lo que usa cada pagina):
--   Solicitudes         leer, insertar, y actualizar SOLO la columna estado
--   canciones_populares  leer, insertar, y actualizar SOLO total_pedidos
--   portadas_cache       leer e insertar
--   Borrar:              NADIE. Ninguna pagina borra nada.
--
-- Los endpoints de /api usan la clave secreta (service_role), que se salta
-- todo esto: cerrar sesiones y limpiar la cola siguen funcionando igual.

-- ---------------------------------------------------------------- Solicitudes

alter table "Solicitudes" enable row level security;

drop policy if exists sol_leer      on "Solicitudes";
drop policy if exists sol_insertar  on "Solicitudes";
drop policy if exists sol_actualizar on "Solicitudes";

create policy sol_leer       on "Solicitudes" for select using (true);
create policy sol_insertar   on "Solicitudes" for insert with check (true);
create policy sol_actualizar on "Solicitudes" for update using (true) with check (true);

-- Sin politica de delete, RLS ya lo bloquea. El revoke es el cinturon ademas
-- de los tirantes, por si algun dia se activa una politica por error.
revoke delete on "Solicitudes" from anon, authenticated;

-- El reproductor solo necesita marcar la cancion como completada. Limitando
-- la columna, aunque alguien fuerce un update no puede cambiar el cantante ni
-- la cancion de una solicitud ajena.
revoke update on "Solicitudes" from anon, authenticated;
grant  update (estado) on "Solicitudes" to anon, authenticated;

-- ------------------------------------------------------- canciones_populares

alter table canciones_populares enable row level security;

drop policy if exists pop_leer       on canciones_populares;
drop policy if exists pop_insertar   on canciones_populares;
drop policy if exists pop_actualizar on canciones_populares;

create policy pop_leer       on canciones_populares for select using (true);
create policy pop_insertar   on canciones_populares for insert with check (true);
create policy pop_actualizar on canciones_populares for update using (true) with check (true);

revoke delete on canciones_populares from anon, authenticated;
revoke update on canciones_populares from anon, authenticated;
grant  update (total_pedidos) on canciones_populares to anon, authenticated;

-- ------------------------------------------------------------ portadas_cache

alter table portadas_cache enable row level security;

drop policy if exists por_leer     on portadas_cache;
drop policy if exists por_insertar on portadas_cache;

create policy por_leer     on portadas_cache for select using (true);
create policy por_insertar on portadas_cache for insert with check (true);

-- Aqui solo se lee y se escribe una vez por cancion: nada mas hace falta.
revoke update, delete on portadas_cache from anon, authenticated;

-- ---------------------------------------------------------------------------
-- SI ALGO SE ROMPE, esto lo deja como estaba (todo permitido otra vez):
--
--   alter table "Solicitudes" disable row level security;
--   alter table canciones_populares disable row level security;
--   alter table portadas_cache disable row level security;
--   grant all on "Solicitudes", canciones_populares, portadas_cache to anon;
-- ---------------------------------------------------------------------------
