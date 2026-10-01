-- Ejecutar en Supabase (SQL Editor > New query > Run). Son dos lineas.
--
-- Por que
-- -------
-- La primera version de 012 pedia cuantas personas venian y guardaba el dato
-- como obligatorio. Despues se quito del formulario: caben hasta 14 y el
-- precio no depende de cuantos sean, asi que preguntarlo solo anadia un paso.
--
-- La tabla se quedo esperando ese dato y rechazaba cada reserva con
-- "null value in column personas". Esto la pone al dia.
--
-- La columna NO se borra: si algun dia se quiere volver a preguntar —por
-- ejemplo para saber cuantas sillas poner— esta ahi, vacia y lista.

alter table reservas alter column personas drop not null;

alter table reservas drop constraint if exists reservas_personas_validas;
