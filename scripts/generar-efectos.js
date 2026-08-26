// Genera los efectos de sonido "divertidos" por sintesis, sin depender de
// archivos descargados. Todo lo que sale de aqui es audio original: se puede
// vender con el sistema sin problemas de licencia.
//
//   node scripts/generar-efectos.js
//
// Escribe WAV mono 44.1 kHz en efectos/. Los archivos estan en .gitignore,
// pero este script si se versiona: los efectos se regeneran en cualquier
// maquina (y en el build de Vercel) con un solo comando.

const fs = require('fs');
const path = require('path');

const SR = 44100;
const outDir = path.join(__dirname, '..', 'efectos');

// ---------------------------------------------------------------- utilidades

// Envolvente por tramos: puntos [posicion 0..1, valor]. Interpola lineal.
function env(puntos, t) {
  if (t <= puntos[0][0]) return puntos[0][1];
  for (let i = 0; i < puntos.length - 1; i++) {
    const [t0, v0] = puntos[i];
    const [t1, v1] = puntos[i + 1];
    if (t >= t0 && t <= t1) {
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * k;
    }
  }
  return puntos[puntos.length - 1][1];
}

// Biquad de la cookbook de RBJ. Recalcula coeficientes en cada muestra para
// poder barrer formantes (cuesta poco: son buffers de pocos segundos).
function creaBiquad() {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return function (x, tipo, f0, Q, sr) {
    const w0 = (2 * Math.PI * Math.min(f0, sr * 0.45)) / sr;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Q);

    let b0, b1, b2, a0, a1, a2;
    if (tipo === 'lowpass') {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (tipo === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else { // bandpass con ganancia unitaria en el pico
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }

    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2
            - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    return y;
  };
}

// Diente de sierra con banda limitada por PolyBLEP: sin alias metalico.
function sierraBLEP(fase, inc) {
  let v = 2 * fase - 1;
  if (fase < inc) {
    const t = fase / inc;
    v -= t + t - t * t - 1;
  } else if (fase > 1 - inc) {
    const t = (fase - 1) / inc;
    v -= t * t + t + t + 1;
  }
  return v;
}

function normaliza(buf, pico = 0.89) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max < 1e-9) return buf;
  const k = pico / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
  return buf;
}

// Rampas cortas en los bordes para que no truene al empezar o terminar.
function suavizaBordes(buf, ms = 6) {
  const n = Math.min(Math.floor((ms / 1000) * SR), Math.floor(buf.length / 2));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    buf[i] *= k;
    buf[buf.length - 1 - i] *= k;
  }
  return buf;
}

function escribeWav(nombre, buf) {
  const datos = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    datos.writeInt16LE(Math.round(v * 32767), i * 2);
  }

  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0);
  cab.writeUInt32LE(36 + datos.length, 4);
  cab.write('WAVE', 8);
  cab.write('fmt ', 12);
  cab.writeUInt32LE(16, 16);   // tamano del bloque fmt
  cab.writeUInt16LE(1, 20);    // PCM
  cab.writeUInt16LE(1, 22);    // mono
  cab.writeUInt32LE(SR, 24);
  cab.writeUInt32LE(SR * 2, 28);
  cab.writeUInt16LE(2, 32);
  cab.writeUInt16LE(16, 34);
  cab.write('data', 36);
  cab.writeUInt32LE(datos.length, 40);

  const destino = path.join(outDir, nombre);
  fs.writeFileSync(destino, Buffer.concat([cab, datos]));
  const seg = (buf.length / SR).toFixed(2);
  console.log(`  ${nombre.padEnd(16)} ${seg}s  ${(datos.length / 1024).toFixed(0)} KB`);
}

// ------------------------------------------------------------------ efectos

// 1. Maullido. Sierra con contorno de tono "me-ow" y tres formantes que
//    barren de /i/ a /a/ a /u/, que es lo que hace que se lea como un gato
//    y no como un sintetizador quejandose.
function gato() {
  const dur = 0.85;
  const n = Math.floor(dur * SR);
  const buf = new Float32Array(n);

  const f1 = creaBiquad();
  const f2 = creaBiquad();
  const f3 = creaBiquad();
  const nasal = creaBiquad();

  let fase = 0;

  for (let i = 0; i < n; i++) {
    const t = i / n;

    // Contorno de tono: sube rapido, cae largo. Con vibrato leve.
    const vib = 1 + 0.022 * Math.sin(2 * Math.PI * 5.5 * (i / SR));
    const f0 = env([[0, 520], [0.12, 880], [0.35, 810], [1, 430]], t) * vib;

    const inc = f0 / SR;
    fase += inc;
    if (fase >= 1) fase -= 1;
    let s = sierraBLEP(fase, inc);

    // Formantes: /i/ -> /a/ -> /u/
    const F1 = env([[0, 330], [0.30, 800], [0.65, 620], [1, 360]], t);
    const F2 = env([[0, 2100], [0.30, 1250], [0.65, 1000], [1, 780]], t);
    const F3 = env([[0, 2900], [1, 2600]], t);

    s = f1(s, 'bandpass', F1, 7, SR) * 1.0
      + f2(s, 'bandpass', F2, 9, SR) * 0.55
      + f3(s, 'bandpass', F3, 11, SR) * 0.22;

    // La /m/ inicial: arranca tapado y se abre.
    s = nasal(s, 'lowpass', env([[0, 700], [0.10, 5200], [1, 4200]], t), 0.8, SR);

    const amp = env([[0, 0], [0.05, 1], [0.45, 0.92], [0.8, 0.5], [1, 0]], t);
    buf[i] = s * amp;
  }

  return suavizaBordes(normaliza(buf));
}

// 2. Trombon triste: cuatro notas descendentes, la ultima se desinfla.
//    El "wah" sale del barrido del lowpass, no del tono.
function tromboneTriste() {
  const notas = [
    { hz: 233.1, dur: 0.34 },
    { hz: 207.7, dur: 0.34 },
    { hz: 185.0, dur: 0.34 },
    { hz: 174.6, dur: 0.95 }
  ];

  const total = notas.reduce((s, x) => s + x.dur, 0) + 0.1;
  const buf = new Float32Array(Math.floor(total * SR));

  let cursor = 0;
  notas.forEach((nota, idx) => {
    const ultima = idx === notas.length - 1;
    const n = Math.floor(nota.dur * SR);
    const lp = creaBiquad();
    const cuerpo = creaBiquad();
    let fase = 0;

    for (let i = 0; i < n; i++) {
      const t = i / n;

      // Cada nota cae un poco; la ultima se desploma un tono entero.
      const caida = ultima
        ? env([[0, 1], [0.45, 0.985], [1, 0.80]], t)
        : env([[0, 1.03], [0.25, 1], [1, 0.972]], t);
      const vib = 1 + (ultima ? 0.012 : 0.006) * Math.sin(2 * Math.PI * 5 * (i / SR));
      const f0 = nota.hz * caida * vib;

      const inc = f0 / SR;
      fase += inc;
      if (fase >= 1) fase -= 1;
      let s = sierraBLEP(fase, inc);

      // "Wah": el filtro se abre al atacar y se cierra al soltar.
      const corte = ultima
        ? env([[0, 700], [0.10, 2100], [0.55, 1400], [1, 480]], t)
        : env([[0, 620], [0.12, 1900], [1, 900]], t);
      s = lp(s, 'lowpass', corte, 2.6, SR);
      s = cuerpo(s, 'bandpass', 520, 1.1, SR) * 0.6 + s * 0.8;

      const amp = ultima
        ? env([[0, 0], [0.06, 1], [0.5, 0.85], [1, 0]], t)
        : env([[0, 0], [0.07, 1], [0.75, 0.9], [1, 0.05]], t);

      const pos = cursor + i;
      if (pos < buf.length) buf[pos] += s * amp * 0.85;
    }

    cursor += n;
  });

  return suavizaBordes(normaliza(buf));
}

// 3. Grillos: el silencio incomodo despues de una cancion regular.
//    Dos grillos desfasados + cama de ruido nocturno muy baja.
function grillos() {
  const dur = 3.4;
  const n = Math.floor(dur * SR);
  const buf = new Float32Array(n);

  // Cama de ambiente: ruido filtrado, apenas audible.
  const amb = creaBiquad();
  for (let i = 0; i < n; i++) {
    buf[i] = amb(Math.random() * 2 - 1, 'bandpass', 1800, 0.7, SR) * 0.012;
  }

  // Un grillo = rafaga de 4 pulsos cortos, repetida con su propio ritmo.
  function grillo(hz, periodo, offset, ganancia) {
    const pulsos = 4;
    const durPulso = 0.016;
    const gapPulso = 0.020;

    for (let inicio = offset; inicio < dur - 0.2; inicio += periodo) {
      for (let p = 0; p < pulsos; p++) {
        const t0 = inicio + p * (durPulso + gapPulso);
        const desde = Math.floor(t0 * SR);
        const largo = Math.floor(durPulso * SR);

        for (let i = 0; i < largo; i++) {
          const t = i / largo;
          const pos = desde + i;
          if (pos >= n) break;

          // Tono agudo con un armonico, envolvente de campana.
          const fase = (2 * Math.PI * hz * i) / SR;
          const s = Math.sin(fase) + 0.35 * Math.sin(2 * fase);
          const amp = Math.pow(Math.sin(Math.PI * t), 1.5);
          buf[pos] += s * amp * ganancia;
        }
      }
    }
  }

  grillo(4600, 0.62, 0.15, 0.5);
  grillo(5200, 0.71, 0.42, 0.3);

  return suavizaBordes(normaliza(buf, 0.8), 25);
}

// 4. "Ba-dum-tss": el remate de chiste malo. Dos golpes de tom y platillo.
function redoble() {
  const dur = 1.6;
  const n = Math.floor(dur * SR);
  const buf = new Float32Array(n);

  // Tom: seno con caida rapida de tono + click de ataque.
  function tom(inicioSeg, hz0, hz1, largoSeg, ganancia) {
    const desde = Math.floor(inicioSeg * SR);
    const largo = Math.floor(largoSeg * SR);
    let fase = 0;

    for (let i = 0; i < largo; i++) {
      const t = i / largo;
      const pos = desde + i;
      if (pos >= n) break;

      const f0 = hz0 + (hz1 - hz0) * Math.pow(t, 0.35);
      fase += (2 * Math.PI * f0) / SR;

      const cuerpo = Math.sin(fase) * Math.exp(-4.5 * t);
      const click = (Math.random() * 2 - 1) * Math.exp(-90 * t) * 0.35;
      buf[pos] += (cuerpo + click) * ganancia;
    }
  }

  // Platillo: ruido con paso alto, cola larga y algo de brillo metalico.
  function platillo(inicioSeg, largoSeg, ganancia) {
    const desde = Math.floor(inicioSeg * SR);
    const largo = Math.floor(largoSeg * SR);
    const hp = creaBiquad();
    const metal = creaBiquad();

    for (let i = 0; i < largo; i++) {
      const t = i / largo;
      const pos = desde + i;
      if (pos >= n) break;

      const ruido = Math.random() * 2 - 1;
      let s = hp(ruido, 'highpass', 5200, 0.7, SR);
      s += metal(ruido, 'bandpass', 8600, 3.5, SR) * 0.4;

      const amp = Math.exp(-3.2 * t) * (1 - Math.exp(-260 * t));
      buf[pos] += s * amp * ganancia;
    }
  }

  tom(0.00, 220, 95, 0.20, 0.75);   // ba
  tom(0.20, 190, 82, 0.20, 0.75);   // dum
  platillo(0.40, 1.15, 0.85);       // tss

  return suavizaBordes(normaliza(buf));
}

// -------------------------------------------------------------------- salida

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log('Generando efectos en efectos/');
escribeWav('gato.wav', gato());
escribeWav('trombon.wav', tromboneTriste());
escribeWav('grillos.wav', grillos());
escribeWav('redoble.wav', redoble());
console.log('Listo.');
