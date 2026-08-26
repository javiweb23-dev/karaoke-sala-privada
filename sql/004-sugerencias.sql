-- Ejecutar una sola vez en Supabase (SQL Editor > New query > Run).
-- Depende de 001-busquedas-fallidas.sql.
--
-- Distingue lo que el cliente ESCRIBIO a proposito ("sugerencia") de lo que
-- simplemente busco y no aparecio ("busqueda"). Las dos cosas van a la misma
-- lista porque sirven para lo mismo —decidir que descargar— pero una
-- sugerencia es una señal mucho mas fuerte: alguien se tomo la molestia.

alter table busquedas_fallidas
    add column if not exists origen text not null default 'busqueda';
        -- busqueda | sugerencia

create index if not exists busquedas_fallidas_por_origen
    on busquedas_fallidas (origen, veces desc);

-- Se reemplaza la funcion añadiendo p_origen. Tiene valor por defecto, asi
-- que las llamadas antiguas de 3 parametros siguen funcionando igual.
create or replace function registrar_busqueda_fallida(
    p_consulta text,
    p_norm     text,
    p_usuario  text default null,
    p_origen   text default 'busqueda'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_norm is null or length(trim(p_norm)) < 3 then
        return;  -- ignora ruido de teclado
    end if;

    insert into busquedas_fallidas (consulta, consulta_norm, nombre_usuario, origen)
    values (
        trim(p_consulta),
        trim(p_norm),
        p_usuario,
        case when p_origen = 'sugerencia' then 'sugerencia' else 'busqueda' end
    )
    on conflict (consulta_norm) do update
        set veces          = busquedas_fallidas.veces + 1,
            actualizada_en = now(),
            -- Una sugerencia manda sobre una busqueda: si alguien la escribio
            -- a proposito, la fila entera pasa a contar como sugerencia.
            origen = case
                        when p_origen = 'sugerencia' then 'sugerencia'
                        else busquedas_fallidas.origen
                     end;
end;
$$;

grant execute on function registrar_busqueda_fallida(text, text, text, text) to anon, authenticated;
