-- OPCIONAL. Limpieza tras quitar la funcion de YouTube.
--
-- ⚠️ ESTO BORRA DATOS Y NO SE PUEDE DESHACER. ⚠️
--
-- No hace falta ejecutarlo: dejar estas tablas y columnas sin usar no rompe
-- nada ni consume nada apreciable. Correlo solo si quieres la base ordenada.
--
-- Lo que NO se toca a proposito:
--   - busquedas_fallidas  -> sigue en uso. Es la lista de canciones que tus
--                            clientes buscaron y no tenias: sirve para decidir
--                            que descargar. Nada que ver con YouTube.
--   - sesiones            -> el control de sala por codigo sigue funcionando.

-- Tablas que solo existian para YouTube.
drop table if exists youtube_cache;
drop table if exists videos_vetados;

-- Columnas que solo usaba el reproductor de YouTube.
-- sesion_id NO se toca: la usa el control de sala.
alter table "Solicitudes"
    drop column if exists fuente,
    drop column if exists video_id,
    drop column if exists respaldo_ids,
    drop column if exists duracion_seg;

-- La columna video_id de busquedas_fallidas tambien sobra ya: se llenaba con
-- el resultado de YouTube. El resto de la tabla sigue siendo util.
alter table busquedas_fallidas
    drop column if exists video_id,
    drop column if exists titulo_resuelto;
