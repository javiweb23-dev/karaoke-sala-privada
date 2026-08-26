// Logica compartida de busqueda y seleccion de karaokes en YouTube.
//
// La usan dos cosas distintas y por eso vive aparte:
//   - api/buscar-youtube.js   (en vivo, cuando un cliente no encuentra su tema)
//   - scripts/resolver-faltantes.js (de madrugada, para que no haya que buscar en vivo)
//
// El prefijo _ evita que Vercel lo publique como endpoint.

const DIAS_CACHE = 60;
const MIN_SEG = 95;      // menos que esto no es una cancion completa
const MAX_SEG = 600;     // mas que esto suele ser un mix o un concierto
const UMBRAL_ACEPTABLE = 60;

// Canales que casi siempre suben karaoke de verdad. Este es el filtro mas
// efectivo de todos: vale la pena ir agregando los que funcionen bien
// (por env KARAOKE_CANALES_OK, sin tocar codigo).
const CANALES_CONFIABLES = [
    'sing king',
    'karafun',
    'karaoke version',
    'zzang karaoke',
    'stingray karaoke'
];

const PISTAS_BUENAS = [
    'KARAOKE', 'INSTRUMENTAL', 'PISTA', 'PLAYBACK', 'CON LETRA',
    'SING ALONG', 'SINGALONG', 'VERSION KARAOKE', 'MINUS ONE'
];

// Subconjunto que por si solo basta para creer que es un karaoke.
// "CON LETRA" queda fuera a proposito: en español tambien lo usan los videos
// de letra con la voz original encima, que no sirven para cantar.
const PISTAS_FUERTES = [
    'KARAOKE', 'INSTRUMENTAL', 'PISTA', 'PLAYBACK',
    'SING ALONG', 'SINGALONG', 'VERSION KARAOKE', 'MINUS ONE'
];

const PISTAS_MALAS = [
    'COVER', 'EN VIVO', 'LIVE', 'REACTION', 'REACCION', 'TUTORIAL',
    'COMO CANTAR', 'CLASE', 'LECCION', 'ENTREVISTA', 'BEHIND THE SCENES',
    'MAKING OF', 'TRAILER', 'EPISODIO', 'PODCAST', 'MIX', 'MEGAMIX',
    'ENGANCHADOS', 'FULL ALBUM', 'ALBUM COMPLETO', 'GREATEST HITS',
    'VIDEO OFICIAL', 'OFFICIAL VIDEO', 'AUDIO OFICIAL', 'OFFICIAL AUDIO',
    'VIDEO CLIP', 'VIDEOCLIP', 'LYRIC VIDEO'
];

// Palabras que delatan un canal de karaoke aunque no este en la lista blanca.
const CANAL_SUENA_A_KARAOKE = ['karaoke', 'pista', 'instrumental', 'playback', 'sing'];

function norm(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitizeEnv(value) {
    if (!value || typeof value !== 'string') return '';
    let v = value.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

// "PT4M13S" -> 253
function duracionASegundos(iso) {
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''));
    if (!m) return 0;
    return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

function canalesConfiables() {
    const extra = sanitizeEnv(process.env.KARAOKE_CANALES_OK);
    const lista = CANALES_CONFIABLES.slice();
    if (extra) {
        for (const c of extra.split(',')) {
            const v = c.trim().toLowerCase();
            if (v) lista.push(v);
        }
    }
    return lista;
}

// El "cerebro" de la seleccion. A proposito NO es un modelo de lenguaje:
// esto corre en 0 ms, es gratis y da siempre el mismo resultado. Un LLM aqui
// solo agregaria latencia mientras el cliente espera con el microfono.
function puntuar(video, consultaNorm, confiables) {
    const titulo = norm(video.titulo);
    const canal = String(video.canal || '').toLowerCase();
    let puntos = 0;
    const motivos = [];

    const canalConfiable = confiables.some((c) => canal.includes(c));
    const canalSuenaAKaraoke = CANAL_SUENA_A_KARAOKE.some((c) => canal.includes(c));
    const tituloSuenaAKaraoke = PISTAS_FUERTES.some((p) => titulo.includes(p));

    // Regla dura, antes de puntuar nada: si NADA indica que es un karaoke, se
    // descarta. Sin esto el video oficial del artista se cuela por popularidad
    // y el cliente termina cantando encima de la voz original.
    if (!canalConfiable && !canalSuenaAKaraoke && !tituloSuenaAKaraoke) {
        return { puntos: -999, motivos: ['no parece karaoke'] };
    }

    if (canalConfiable) {
        puntos += 60;
        motivos.push('canal confiable');
    } else if (canalSuenaAKaraoke) {
        puntos += 25;
        motivos.push('canal de karaoke');
    }

    if (titulo.includes('KARAOKE')) {
        puntos += 50;
        motivos.push('titulo dice karaoke');
    }

    for (const p of PISTAS_BUENAS) {
        if (p !== 'KARAOKE' && titulo.includes(p)) {
            puntos += 18;
            motivos.push(p.toLowerCase());
            break;
        }
    }

    for (const p of PISTAS_MALAS) {
        if (titulo.includes(p)) {
            // "COVER" no descalifica si ademas dice karaoke explicitamente.
            if (titulo.includes('KARAOKE')) puntos -= 10;
            else puntos -= 45;
            motivos.push('penalizado: ' + p.toLowerCase());
            break;
        }
    }

    // Que el titulo tenga que ver con lo que pidieron.
    const palabras = consultaNorm.split(' ').filter((p) => p.length > 2);
    if (palabras.length) {
        const aciertos = palabras.filter((p) => titulo.includes(p)).length;
        const cobertura = aciertos / palabras.length;
        puntos += Math.round(cobertura * 45);
        if (cobertura < 0.5) motivos.push('coincide poco con lo pedido');
    }

    if (video.duracion >= MIN_SEG && video.duracion <= MAX_SEG) {
        puntos += 15;
    } else {
        puntos -= 60;
        motivos.push('duracion rara');
    }

    // Popularidad como desempate, en escala logaritmica para que un video de
    // 50 millones no aplaste a uno de 200.000 que puede ser mejor karaoke.
    if (video.vistas > 0) {
        puntos += Math.min(20, Math.round(Math.log10(video.vistas) * 3));
    }

    if (video.hd) puntos += 5;

    return { puntos, motivos };
}

// Esta es la unica llamada que cuesta 100 unidades de cuota.
async function buscarEnYouTube(consulta, apiKey, region) {
    const params = new URLSearchParams({
        key: apiKey,
        part: 'snippet',
        q: `${consulta} karaoke`,
        type: 'video',
        videoEmbeddable: 'true',      // filtro clave: si no deja embeber, no sirve
        videoSyndicated: 'true',
        maxResults: '20',
        safeSearch: 'moderate',
        regionCode: region,
        relevanceLanguage: 'es'
    });

    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const data = await res.json();

    if (!res.ok) {
        const err = new Error(data?.error?.message || 'Error de la API de YouTube');
        err.motivo = data?.error?.errors?.[0]?.reason || 'desconocido';
        err.status = res.status;
        throw err;
    }

    return (data.items || [])
        .filter((it) => it.id && it.id.videoId)
        .map((it) => ({
            videoId: it.id.videoId,
            titulo: it.snippet.title,
            canal: it.snippet.channelTitle,
            miniatura: it.snippet.thumbnails?.medium?.url || ''
        }));
}

// Segunda pasada: 1 unidad de cuota y nos dice lo que search.list no dice —
// duracion real, si sigue siendo publico y si esta bloqueado en el pais.
// Es lo que evita que un video muerto llegue a la pantalla del local.
async function detallarVideos(ids, apiKey, region) {
    const mapa = new Map();
    if (!ids.length) return mapa;

    const params = new URLSearchParams({
        key: apiKey,
        part: 'contentDetails,status,statistics',
        id: ids.slice(0, 50).join(',')
    });

    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    const data = await res.json();
    if (!res.ok) return mapa;

    for (const it of data.items || []) {
        const restriccion = it.contentDetails?.regionRestriction;
        const bloqueado =
            (restriccion?.blocked || []).includes(region) ||
            (restriccion?.allowed && !restriccion.allowed.includes(region));

        mapa.set(it.id, {
            duracion: duracionASegundos(it.contentDetails?.duration),
            hd: it.contentDetails?.definition === 'hd',
            vistas: Number(it.statistics?.viewCount) || 0,
            embebible: it.status?.embeddable === true,
            publico: it.status?.privacyStatus === 'public',
            bloqueado: Boolean(bloqueado)
        });
    }
    return mapa;
}

// Busca, valida y devuelve los mejores candidatos ya ordenados.
async function resolverKaraoke(consulta, { apiKey, region, maxCandidatos = 4 }) {
    const consultaNorm = norm(consulta);
    const crudos = await buscarEnYouTube(consulta, apiKey, region);
    if (crudos.length === 0) return [];

    const detalles = await detallarVideos(crudos.map((v) => v.videoId), apiKey, region);
    const confiables = canalesConfiables();

    return crudos
        .map((v) => {
            const d = detalles.get(v.videoId);
            if (!d) return null;
            if (!d.embebible || !d.publico || d.bloqueado) return null;
            if (d.duracion < MIN_SEG || d.duracion > MAX_SEG) return null;

            const completo = { ...v, ...d };
            const { puntos, motivos } = puntuar(completo, consultaNorm, confiables);
            return { ...completo, puntos, motivos };
        })
        .filter(Boolean)
        // Umbral: mas vale decir "no la encontre" que poner cualquier cosa
        // en la pantalla grande de una sala privada.
        .filter((v) => v.puntos >= UMBRAL_ACEPTABLE)
        .sort((a, b) => b.puntos - a.puntos)
        .slice(0, maxCandidatos);
}

module.exports = {
    DIAS_CACHE,
    MIN_SEG,
    MAX_SEG,
    UMBRAL_ACEPTABLE,
    norm,
    sanitizeEnv,
    duracionASegundos,
    canalesConfiables,
    puntuar,
    buscarEnYouTube,
    detallarVideos,
    resolverKaraoke
};
