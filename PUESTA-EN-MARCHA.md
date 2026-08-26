# Puesta en marcha

---

## Cómo agregar canciones nuevas

**El archivo `plantillacanciones.xlsx` NO se usa.** Es un resto de un método
viejo; ningún script lo lee. Puedes ignorarlo o borrarlo.

El método real son tres pasos:

**1.** Nombra el MP4 exactamente así, con espacio-guion-espacio en medio:

```
ARTISTA - TITULO.mp4
```

Ejemplo: `PALITO ORTEGA - LA FELICIDAD.mp4`

**2.** Cópialo a la carpeta `videos_locales/`

**3.** Ejecuta:

```bash
npm run videos:index
```

Eso hace dos cosas: lee los nombres de archivo y agrega al catálogo
(`canciones.js`) las canciones que aún no estaban, y regenera el índice
`videos_disponibles.js` que el reproductor usa para encontrar cada archivo.

El género y el idioma se adivinan solos: si ya tienes otras canciones de ese
artista, copia las de ellas; si es un artista nuevo, pone `POP` y deduce el
idioma por las palabras del título. Si alguna queda mal clasificada, edita esa
línea en `canciones.js` a mano.

**Después haz commit y push**, para que `canciones.js` llegue al celular de tus
clientes. Los MP4 **no** se suben al repositorio (pesan 131 GB): se quedan en tu
máquina, que es donde corre el reproductor.

> El separador ` - ` es obligatorio. Si el nombre no lo tiene, la canción entra
> como artista "VARIOS" y con el nombre completo de archivo como título.

---


El sistema reproduce **solo tus videos descargados** de `videos_locales/`.
Hay dos funciones opcionales encima: efectos de sonido nuevos y control de sala
por código en pantalla.

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
