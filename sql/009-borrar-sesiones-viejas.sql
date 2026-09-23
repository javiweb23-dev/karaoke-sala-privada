-- OPCIONAL. Para poder borrar sesiones viejas sin pelearse con la base.
--
-- El problema
-- -----------
-- Cada fila de Solicitudes apunta a su sesion. Si se borra la sesion, esas
-- filas se quedarian apuntando al vacio, asi que Postgres no deja:
--
--   Key (id)=(5) is still referenced from table Solicitudes
--
-- Y hace bien. Una solicitud sin sesion fue justo lo que rompio la noche del
-- 19: habia 724 filas sueltas de mayo a agosto que se colaban en la cola de
-- todas las noches y hacian que a los clientes repetidos no les tocara nunca.
--
-- La solucion
-- -----------
-- Decirle que al borrar una sesion borre tambien sus canciones. Tiene sentido:
-- la lista de lo que se canto esa noche no significa nada sin la noche.
--
-- ⚠️ OJO: a partir de aqui, borrar una sesion borra en silencio todo lo que se
-- pidio en ella. Es lo que quieres para limpiar pruebas viejas, pero no hay
-- vuelta atras.
--
-- Lo que NO se hace a proposito: poner sesion_id en null al borrar. Eso seria
-- volver a fabricar exactamente el fallo del 19.

alter table "Solicitudes"
    drop constraint if exists "Solicitudes_sesion_id_fkey";

alter table "Solicitudes"
    add constraint "Solicitudes_sesion_id_fkey"
    foreign key (sesion_id)
    references sesiones (id)
    on delete cascade;


-- ---------------------------------------------------------------------------
-- Si prefieres no cambiar nada del esquema
-- ---------------------------------------------------------------------------
-- Borra primero las canciones de esa sesion y despues la sesion. Cambiando el
-- 5 por el numero que quieras:
--
--   delete from "Solicitudes" where sesion_id = 5;
--   delete from sesiones where id = 5;
--
-- O varias de golpe:
--
--   delete from "Solicitudes" where sesion_id in (5, 6, 7);
--   delete from sesiones where id in (5, 6, 7);


-- ---------------------------------------------------------------------------
-- Antes de borrar, mirar que te llevas por delante
-- ---------------------------------------------------------------------------
--   select s.id,
--          s.nombre_grupo,
--          s.abierta_en,
--          count(q.id) as canciones
--     from sesiones s
--     left join "Solicitudes" q on q.sesion_id = s.id
--    group by s.id, s.nombre_grupo, s.abierta_en
--    order by s.id;
