# Puesta en marcha

---

## Cómo agregar canciones nuevas

**Un solo comando.**

1. Nombra el MP4 así:  `ARTISTA - TITULO.mp4`
2. Cópialo a `videos_locales/`
3. Ábrelo en `canciones.xlsx` y ponle género e idioma (opcional)
4. Ejecuta:

```bash
npm run actualizar
```

Eso arma el catálogo, actualiza el Excel, hace commit y publica. Ya está.

La regla: **manda la carpeta**. Si el MP4 está, la canción entra. Si no está,
no entra. El Excel solo aporta género e idioma, así que es imposible borrar
canciones por tenerlo desactualizado.

Si una canción es de un artista nuevo, el comando te avisa de que quedó en
POP. Le pones el género en el Excel y vuelves a correrlo.
---


El sistema reproduce **solo tus videos descargados** de `videos_locales/`.
Hay dos funciones opcionales encima: efectos de sonido nuevos y control de sala
por código en pantalla.

---

## Qué descargar: sugerencias automáticas

```bash
npm run sugerencias
```

Para cada artista que **ya tienes**, busca sus canciones más populares que te
faltan y genera **`SUGERENCIAS.xlsx`**, listo para abrir en Excel.

Usa la API pública de Deezer (gratis, sin clave), que publica un ranking de
popularidad real. Las de ★★★★★ son himnos: empieza por esas.

Columnas de la hoja:

| Columna | Para qué |
|---|---|
| Artista / Canción | Lo que hay que buscar |
| Popularidad | ★ a ★★★★★, de un vistazo |
| Puntos | El número exacto, por si quieres ordenar fino |
| Ya tengo | Cuántas suyas hay en el catálogo |
| **Nombre para el archivo** | Cópialo tal cual al renombrar el MP4 |
| Ojo: en Deezer es | Solo si resolvió a otro nombre — ahí revisa |
| Descargada | Vacía, para que marques |

La fila de títulos viene congelada y con filtros: puedes ordenar por artista,
por popularidad, o filtrar los que ya descargaste, sin tocar nada.

Opciones útiles:

| Opción | Para qué |
|---|---|
| `--limite=60` | Cuántos artistas consultar por corrida |
| `--solo="GUACO"` | Un solo artista |
| `--max=10` | Cuántas sugerencias por artista (por defecto 6) |
| `--min=4` | Solo artistas de los que ya tengas 4+ canciones |

> Por defecto entran **todos** los artistas, incluidos los que solo tienen una
> canción tuya. Ahí está el mayor margen: tienes 440 artistas así.

Va guardando lo consultado, así que puedes cortarlo con Ctrl+C y relanzarlo:
sigue donde quedó. Cuando diga *"Quedan N artistas"*, vuelve a correr lo mismo.

### Si una lista no cuadra

A veces Deezer confunde artistas homónimos, y el equivocado puede tener **más
seguidores** que el que buscas (le pasó a Selena, Felipe Pirela y Kiara). Si ves
canciones que no reconoces bajo un artista, corrígelo en
[artistas-deezer.json](artistas-deezer.json):

1. Abre `https://api.deezer.com/search/artist?q=NOMBRE` en el navegador
2. Busca el artista correcto y copia su `id`
3. Añádelo al archivo: `"NOMBRE COMO LO TIENES": 12345`
4. Borra ese artista de `.cache-deezer.json` y vuelve a correr

Las líneas que dicen *"· en Deezer: otro nombre"* en el informe son las que
conviene revisar. La mayoría son aciertos (*Adolescent's Orquesta*, *Bob Marley
& The Wailers*), pero ahí es donde aparecen los errores.

---

## 1. Efectos nuevos (ya funciona, no requiere nada)

Cuatro sonidos añadidos a los cuatro que ya tenías: **gato, fracaso (trombón
triste), grillos y redoble**. Aparecen como botones en el admin.

Para regenerarlos:

```bash
npm run efectos:generar
```

Son audio original generado por código ([scripts/generar-efectos.js](scripts/generar-efectos.js)),
no descargas. Si algún sonido no te convence se puede ajustar: están hechos de
parámetros (tono, duración, filtros), no de un archivo fijo.

**Arreglo incluido:** `efectos/` no se copiaba a `public/`, así que en el deploy
los sonidos daban 404 y solo funcionaban en local.

---

## 2. Registro de búsquedas fallidas

Anota en silencio lo que tus clientes buscan y **no tienes**. El cliente no ve
nada distinto; a ti te queda una lista de qué vale la pena descargar, basada en
lo que te piden de verdad.

Además, al final de cada búsqueda aparece un botón discreto **💡 Sugerir una
canción**: se abre una línea de texto, ya rellenada con lo que estaban buscando,
y el cliente puede pedirte que la agregues.

**Configuración:** ejecuta en Supabase → SQL Editor → New query → Run:

1. [sql/001-busquedas-fallidas.sql](sql/001-busquedas-fallidas.sql)
2. [sql/004-sugerencias.sql](sql/004-sugerencias.sql)

**Para consultarla:** Supabase → Table Editor → `busquedas_fallidas`, ordenando
por la columna `veces` de mayor a menor. Arriba están las más pedidas.

La columna `origen` distingue las dos señales:

| `origen` | Qué significa |
|---|---|
| `sugerencia` | Alguien la escribió a propósito para pedírtela |
| `busqueda` | La buscaron y no apareció |

Las `sugerencia` son la señal fuerte: alguien se tomó la molestia de escribirla.
Empieza por esas cuando decidas qué descargar.

---

## 3. Control de sala por código

Evita que quien vino ayer siga pidiendo canciones desde su casa, sin GPS y sin
contraseñas para el cliente.

**Cómo funciona:** abres una sesión → sale un código de 4 dígitos en la TV → el
cliente lo teclea una vez → puede pedir. Al cerrar la sesión, ese código muere.

El código **solo se ve estando en la sala**. Eso es el control: no hace falta
saber dónde está el cliente, solo que está ahí.

### Configuración

1. Ejecuta [sql/002-sesiones-de-sala.sql](sql/002-sesiones-de-sala.sql) en Supabase
2. En Vercel → Settings → Environment Variables, con **Production** marcado:

| Variable | Valor |
|---|---|
| `ADMIN_PIN` | el que elijas tú |
| `SUPABASE_URL` | `https://mefrjbmjfdphdqndpzcw.supabase.co` |
| `SUPABASE_SERVICE_KEY` | la clave **secreta** de Supabase (`sb_secret_...`) |

3. **Deployments → ⋯ → Redeploy.** Las variables no se aplican sin esto.

### Los tres valores que se teclean (no los confundas)

| Quién | Dónde | Qué escribe |
|---|---|---|
| Tú | Reproductor (TV) | El `ADMIN_PIN` |
| Tú | Admin (tu celular) | El `ADMIN_PIN` |
| Los clientes | Su celular | Los 4 números de la TV |

El PIN es el mismo en la TV y en el admin, y **no cambia nunca** en el día a
día. Los 4 números **se generan solos** cada vez que abres sesión: no tocas
Vercel para eso.

Cada dispositivo guarda el PIN por separado (el admin está en `vercel.app` y el
reproductor en `localhost`, y para el navegador son sitios distintos).

### Uso diario

- Entra un grupo → admin → **Abrir sesión** (puedes ponerle nombre: "Mesa 4")
- Se va el grupo → **Cerrar sesión**

**Es opcional.** Sin sesión abierta no se le pide código a nadie y todo funciona
como siempre. Úsalo los días que haga falta.

### Dónde se hace el control de verdad

En el reproductor: con sesión abierta, la TV solo reproduce lo pedido en esa
sesión. Al cerrarla, lo que quedó en cola se limpia solo.

No es seguridad criptográfica: un usuario técnico con la consola del navegador
podría forzar una solicitud, porque el envío va directo a Supabase con la clave
publishable. Para el problema real —el cliente de ayer, el colado casual— sobra.

**Ojo:** `admin.html` no tiene login. Cualquiera con la URL controla tu
reproductor. El `ADMIN_PIN` protege las sesiones, no los demás botones.

---

## 4. Tienda de refrigerios

Hielo, refrescos, vasos, helados. La piden sobre todo las personas que están en
el área y **no vienen a cantar**, así que la tienda funciona con la sala cerrada,
sin código y sin sesión.

Cuando alguien confirma el pedido te llega un mensaje a Telegram, al mismo chat
donde recibes las alertas del operador, con la lista, quién pidió y desde dónde.

### Configuración

1. Ejecuta [sql/011-tienda.sql](sql/011-tienda.sql) en Supabase (SQL Editor →
   New query → Run). Crea las tablas, el bucket de fotos y cuatro productos de
   prueba.
2. En Vercel → Settings → Environment Variables, con **Production** marcado,
   agrega **una sola variable nueva**:

| Variable | Valor |
|---|---|
| `TIENDA_PIN` | la clave del menú. **Distinta de `ADMIN_PIN`** |

3. **Deployments → ⋯ → Redeploy.** Las variables no se aplican sin esto.

Las demás ya las tienes: `ADMIN_PIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID`.

**Por qué una clave aparte:** el `ADMIN_PIN` lo tiene quien maneje la consola
esa noche. No es lo mismo dejar que alguien pause una canción que dejarle
cambiar los precios. Con `TIENDA_PIN` el menú solo lo toca quien tú decidas, y
entrar al admin no da acceso. Mientras no la configures, el panel de productos
no abre y te lo dice en pantalla.

### Las páginas

| Página | Para quién | Clave |
|---|---|---|
| [tienda.html](tienda.html) | El cliente. Catálogo y carrito. | Ninguna |
| [tienda-admin.html](tienda-admin.html) | Productos, fotos y tasa. | `TIENDA_PIN` |
| [admin.html](admin.html) | Ya lo conoces. Ahora tiene **🛒 PEDIR COMIDA U OTROS**. | `ADMIN_PIN` |
| [qr-tienda.html](qr-tienda.html) | Cartel de un solo QR para colgar en el área. | Ninguna |

En la pantalla del PIN del admin hay además un botón **Comprar en la Tienda**:
es para quien escanea el QR del control remoto sin ser del staff y se quedaba
atascado pidiendo una clave que nadie le va a dar.

Al entrar a la tienda desde el panel, arriba sale **← Volver al panel del
operador** y no desaparece: sin eso, quien se mete a pedir algo deja de poder
controlar la música mientras tanto.

Los carteles: [qr-tienda.html](qr-tienda.html) es el de la tienda sola, para
imprimir o mandar por WhatsApp. El de siempre
([carteles_qr_sala_privada.html](carteles_qr_sala_privada.html)) también trae ya
la tarjeta **PEDIR REFRIGERIOS Y OTROS**.

### Agregar productos

Entra a `tienda-admin.html` con tu PIN → **+ NUEVO**. Nombre, descripción breve,
precio en dólares y la foto, que se reduce sola antes de subirse. Las flechas
▲▼ cambian el orden en que se ven, y el interruptor **Visible en la tienda**
oculta un producto sin borrarlo: para cuando se acaba el hielo y vuelve mañana.

### La tasa en bolívares

Los precios se guardan **en dólares**. Los bolívares son solo una referencia
que se calcula con la tasa del BCV, que se trae de internet sola.

Esas APIs no son oficiales y a veces se caen. Si eso pasa, la tienda **sigue
vendiendo**: muestra la última tasa que consiguió, o solo dólares. Y si la ves
mal, en `tienda-admin.html` marcas **Usar tasa manual**, escribes el número y
guardas. Mientras esté marcado, manda tu número y no se consulta internet.

Cada pedido guarda la tasa que se usó en ese momento, así el historial sigue
cuadrando aunque la tasa cambie después.

### Los avisos que se perdían

Pasaba que el primer aviso no llegaba y, al mandar el segundo, aparecían los
dos de golpe. Ocurría con los pedidos **y con el botón de llamar al operador**:
hubo una llamada que se perdió y tuvieron que repetirla.

La causa era una petición que se quedaba colgada. Vercel congela la función con
la conexión a medias y no la descongela hasta la siguiente llamada, y ahí salen
las dos juntas. Ahora cada intento tiene un límite de tiempo y, si falla, se
reintenta hasta tres veces con conexión nueva. Los dos avisos usan el mismo
código, así que el arreglo vale para ambos.

Si aun así un aviso no sale, el cliente lo ve en pantalla («el aviso automático
no salió, confírmalo con el personal») y **el pedido igual quedó guardado** en
Supabase: primero se guarda y después se avisa, nunca al revés.

### Dónde ver los pedidos

Supabase → Table Editor → `tienda_pedidos`, ordenando por `creado_en` de mayor
a menor. La columna `estado` empieza en `nuevo`; si te sirve llevar la cuenta,
cámbiala a `entregado` a mano.

### Qué NO toca del karaoke

Nada. Son tablas aparte (`tienda_productos`, `tienda_pedidos`, `tienda_config`),
páginas aparte y endpoints aparte. Si borras las tres tablas, el karaoke sigue
funcionando igual. Al final de `sql/011-tienda.sql` están las líneas para
quitarlo todo.

---

## La URL de Vercel en el reproductor

En [reproductor.html](reproductor.html) hay una constante:

```javascript
const URL_VERCEL = 'https://karaoke-sala-privada.vercel.app';
```

Hace falta porque el reproductor se abre con Live Server (`localhost`, para
llegar a `videos_locales/`) pero los endpoints `/api/*` viven en Vercel. Si
cambias de dominio, actualízala o el código de sala no aparecerá en la TV.

---

## Si alguna vez quitas también el control de sala

Las variables `YOUTUBE_API_KEY`, `KARAOKE_REGION` y `KARAOKE_CANALES_OK` ya no
se usan: puedes borrarlas de Vercel.

Y si quieres dejar la base de datos ordenada, hay un
[sql/003-quitar-youtube.sql](sql/003-quitar-youtube.sql) **opcional** que borra
las tablas y columnas que quedaron sin uso. No hace falta ejecutarlo — dejarlas
no rompe nada.
