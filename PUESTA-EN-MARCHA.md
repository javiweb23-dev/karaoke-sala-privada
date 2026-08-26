# Puesta en marcha — YouTube y efectos nuevos

Los cambios están hechos y el sistema **sigue funcionando igual sin configurar nada**.
Todo lo de YouTube está apagado hasta que hagas los pasos 2 y 3.

---

## 1. Efectos nuevos (ya funciona, no requiere nada)

Se agregaron cuatro sonidos sintetizados: **gato, fracaso (trombón triste),
grillos y redoble**. Aparecen como botones nuevos en el admin.

Para regenerarlos o retocarlos:

```bash
npm run efectos:generar
```

Son audio original generado por código (`scripts/generar-efectos.js`), no
descargas. Eso importa para vender el sistema: los `.mp3` que ya tenías vienen
de terceros, estos cuatro son tuyos y no arrastran licencias.

Si algún sonido no te convence, dime cuál y lo ajusto — están hechos de
parámetros (tono, duración, filtros), no de un archivo fijo.

**De paso se arregló un fallo:** `efectos/` no se copiaba a `public/`, así que
en el deploy de Vercel los sonidos daban 404 y solo funcionaban en local.

---

## 2. Base de datos (una sola vez)

En Supabase → **SQL Editor** → **New query**, pega y ejecuta el contenido de:

```
sql/001-youtube-y-busquedas.sql
```

Crea `busquedas_fallidas`, `youtube_cache` y agrega cuatro columnas a
`Solicitudes`. Todo es aditivo: las filas que ya existen quedan como `local` y
se comportan exactamente igual que hoy.

Después de este paso ya funciona el **paso 1** (registro de lo que la gente
busca y no encuentra), aunque todavía no tengas API key de YouTube.

---

## 3. Clave de YouTube (para la búsqueda en vivo)

1. Entra a <https://console.cloud.google.com/>
2. Crea un proyecto → **APIs y servicios** → habilita **YouTube Data API v3**
3. **Credenciales** → **Crear credenciales** → **Clave de API**
4. Restringe la clave a *YouTube Data API v3* (importante)

En Vercel → tu proyecto → **Settings** → **Environment Variables**:

| Variable | Valor | Obligatoria |
|---|---|---|
| `YOUTUBE_API_KEY` | la clave del paso anterior | sí |
| `SUPABASE_URL` | `https://mefrjbmjfdphdqndpzcw.supabase.co` | sí |
| `SUPABASE_SERVICE_KEY` | la clave **secreta** de Supabase (no la publishable) | sí |
| `KARAOKE_REGION` | tu país en dos letras, ej. `VE` | no |
| `KARAOKE_CANALES_OK` | canales de karaoke buenos, separados por coma | no |

> La `SERVICE_KEY` solo vive en Vercel, nunca en el HTML. Es la que permite
> escribir el caché.

Vuelve a desplegar y listo.

---

## 4. El agente nocturno

Convierte lo que la gente no encontró en canciones listas del catálogo.

```bash
node scripts/resolver-faltantes.js --seco
```

`--seco` simula sin escribir nada: úsalo la primera vez para ver qué haría.
Cuando estés conforme, córrelo de verdad:

```bash
node scripts/resolver-faltantes.js --limite=20
```

Genera `canciones_youtube.js`. Ese archivo hay que subirlo con el próximo
deploy para que las canciones aparezcan en la lista de los clientes.

Necesita las mismas variables del paso 3 en tu terminal.

---

## 5. Control de sala (código en pantalla)

Resuelve lo del cliente de ayer pidiendo canciones desde su casa, sin GPS y sin
contraseñas.

**Cómo funciona:** el operador abre una sesión → aparece un código de 4 dígitos
en la TV → el cliente lo teclea una vez → puede pedir. Al cerrar la sesión,
todos los códigos mueren. El de ayer queda fuera solo.

El código **solo se puede ver estando en la sala**. Eso es el control: no hace
falta saber dónde está el cliente, solo que está aquí y ahora.

### Configuración

1. Ejecuta `sql/002-sesiones-de-sala.sql` en Supabase (igual que el paso 2)
2. En Vercel, agrega una variable más:

| Variable | Valor |
|---|---|
| `ADMIN_PIN` | invéntate un PIN (ej. `Karaoke2026!`) |

3. La primera vez que abras `admin.html` y `reproductor.html`, te pide el PIN.
   Queda guardado en ese dispositivo y no lo vuelve a pedir.

### Uso diario

- Entra un grupo → en el admin, **Abrir sesión** (puedes ponerle nombre: "Mesa 4")
- El código aparece solo en la pantalla de espera de la TV
- Se va el grupo → **Cerrar sesión**

**Es opcional.** Si no abres sesión, no se le pide código a nadie y todo
funciona exactamente como hoy. Puedes usarlo solo los días que te haga falta.

### Dónde se hace el control de verdad

No solo en el modal del celular (eso es la puerta), sino **en el reproductor**:
con sesión abierta, la TV solo reproduce canciones pedidas en esa sesión. Aunque
alguien lograra colar una solicitud, si no es de la sesión actual nunca suena.

Un detalle que ganas gratis: al cerrar la sesión, lo que quedó en cola de ese
grupo se limpia solo. No más restos de anoche.

### Lo que esto NO es

No es seguridad criptográfica. Un usuario técnico con la consola del navegador
abierta podría forzar una solicitud, porque el envío va directo a Supabase con
la clave publishable. Para el problema real — el cliente de ayer, el colado
casual — sobra. Para blindarlo de verdad hay que hacer que los pedidos pasen por
un endpoint que valide en el servidor, y eso es lo que toca cuando vendas a
varios locales (junto con `sala_id` y políticas RLS).

**Ojo con esto:** hoy `admin.html` no tiene ninguna autenticación. Cualquiera
con la URL controla tu reproductor. El `ADMIN_PIN` protege las sesiones, pero
no el resto de los botones. Vale la pena ponerle login antes de vender.

---

## Cuota: lo único que hay que vigilar

YouTube da **10.000 unidades al día gratis**:

- Una búsqueda nueva cuesta **101** → unas **99 búsquedas nuevas al día**
- Una búsqueda repetida cuesta **0** (sale del caché, dura 60 días)

Por eso el `--limite=20` del agente nocturno: deja ~80 para las búsquedas en
vivo del día. En una sala sola te sobra muchísimo.

**Cuando vendas a varios locales:** que cada local ponga su propia
`YOUTUBE_API_KEY`. La cuota es de ellos, es gratis, y tú no pagas nada.

---

## Lo que hay que tener claro

**El tono no funciona en canciones de YouTube.** No es un bug ni se puede
arreglar: el audio va dentro de un iframe de otro origen y jamás entra al
procesador de audio de la TV. Por eso:

- La pantalla muestra un aviso `▶ YouTube · sin ajuste de tono`
- Los botones de tono del admin se apagan solos durante esas canciones
- El cliente lo ve advertido antes de pedirla

Es la razón por la que YouTube es el **plan B**: tu archivo local siempre gana,
porque permite cambiar el tono y no depende del internet del local.

**Van a salir anuncios.** No se pueden saltar por código. Como YouTube solo
entra cuando el catálogo falla, deberían ser pocas canciones.

**Modera.** El filtro rechaza lo que no parece karaoke de verdad (incluidos los
videos oficiales del artista, que llevarían la voz original), pero el botón de
saltar del admin sigue siendo tu red de seguridad.
