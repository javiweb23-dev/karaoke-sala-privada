-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
-- Depende de 002-sesiones-de-sala.sql y 006-cerrar-permisos.sql.
--
-- QUE PASO DE VERDAD CON CADA CANCION
--
-- El problema
-- -----------
-- "completada" queria decir cuatro cosas a la vez, y no habia forma de
-- separarlas mirando la tabla:
--
--   1. sono entera
--   2. NO CARGO y la TV la salto en nueve decimas de segundo
--   3. alguien le dio al boton de saltar del panel
--   4. seguia en la cola cuando se cerro la sala (al cerrar se marcan todas
--      como completadas para que el panel no muestre restos de anoche)
--
-- El caso 2 es el que duele: el cliente ve su cancion anunciada en la
-- pantalla, no suena, y la noche sigue. Si el operador no esta delante en ese
-- momento, nadie se entera nunca. Paso el 2 de octubre con una de Mabel
-- (CARLOS ALFREDO - SOLO EN MI CUARTO, 23:10): quedo apuntada como cantada y
-- diez minutos despues hubo que volver a pedirla.
--
-- El caso 4 pasa todas las noches llenas. El sabado 10 de octubre la sala
-- cerro a la 1:40 con 15 canciones todavia en cola, y las 15 quedaron
-- apuntadas como si se hubieran cantado.
--
-- Lo que se hace
-- --------------
-- NO se toca "estado". El reparto de turnos cuenta las completadas para saber
-- a quien le toca cantar, y cambiarle los valores a esa columna seria rehacer
-- el reparto entero. Se añade al lado una columna que dice que paso de verdad,
-- y asi lo que ya funciona sigue funcionando igual.

alter table "Solicitudes"
    add column if not exists resultado    text,
    add column if not exists detalle      text,
    add column if not exists terminada_en timestamptz;

comment on column "Solicitudes".resultado is
    'sonada | fallada | saltada | sin_sonar_cierre. Nulo en lo de antes de octubre de 2026.';
comment on column "Solicitudes".detalle is
    'Por que fallo, cuando fallo. Lo escribe la TV.';
comment on column "Solicitudes".terminada_en is
    'Cuando dejo de estar en pantalla. Es la hora en que SONO, no en que se pidio.';

-- Solo estos cuatro valores. La columna sirve para contar, asi que mas vale
-- que un fallo de escritura salte aqui y no ensucie el recuento en silencio.
alter table "Solicitudes"
    drop constraint if exists solicitudes_resultado_valido;
alter table "Solicitudes"
    add constraint solicitudes_resultado_valido
    check (resultado is null
           or resultado in ('sonada', 'fallada', 'saltada', 'sin_sonar_cierre'));

-- El detalle lo escribe el navegador de la TV, y con la clave publica a la
-- vista cualquiera podria mandar un texto enorme. Doscientos caracteres
-- sobran para "no cargo: timeout media".
alter table "Solicitudes"
    drop constraint if exists solicitudes_detalle_corto;
alter table "Solicitudes"
    add constraint solicitudes_detalle_corto
    check (detalle is null or length(detalle) <= 200);

-- Para poder preguntar "que paso en la sesion 38" sin recorrer la tabla.
create index if not exists solicitudes_resultado_por_sesion
    on "Solicitudes" (sesion_id, resultado);

-- ---------------------------------------------------------------------------
-- Permisos
--
-- 006-cerrar-permisos.sql dejo el update del navegador limitado A UNA SOLA
-- COLUMNA a proposito: asi, aunque alguien fuerce un update con la clave
-- publica, no puede cambiarle el cantante ni la cancion a una solicitud
-- ajena. Eso se mantiene. Solo se suman las tres columnas nuevas, que es lo
-- que la TV necesita escribir para dejar constancia.
-- ---------------------------------------------------------------------------
revoke update on "Solicitudes" from anon, authenticated;
grant  update (estado, resultado, detalle, terminada_en)
    on "Solicitudes" to anon, authenticated;

-- ---------------------------------------------------------------------------
-- PARA MIRARLO DESPUES DE UNA NOCHE
--
--   select resultado, count(*)
--     from "Solicitudes"
--    where sesion_id = 38
--    group by resultado;
--
-- Las que el cliente vio anunciadas y no sonaron:
--
--   select nombre_usuario, cancion_info, detalle, terminada_en
--     from "Solicitudes"
--    where sesion_id = 38 and resultado = 'fallada'
--    order by terminada_en;
--
-- Lo que se quedo sin cantar por cerrar la sala:
--
--   select nombre_usuario, cancion_info
--     from "Solicitudes"
--    where sesion_id = 38 and resultado = 'sin_sonar_cierre';
-- ---------------------------------------------------------------------------
