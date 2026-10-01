const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

const required = [
  'index.html',
  'admin.html',
  'reproductor.html',
  'canciones.js',
  'videos_disponibles.js'
];

// La tienda va en optional y no en required a proposito: si algun dia se quita,
// el despliegue del karaoke tiene que seguir pasando igual.
const optional = [
  'logo.png',
  // La web publica (karaokelatino.com). Va en optional como la tienda: si
  // algun dia se quita, el despliegue del karaoke tiene que pasar igual.
  'home.html',
  'resenas.html',
  'resenas-admin.html',
  'reservas-admin.html',
  'carteles_qr_sala_privada.html',
  'efectos_disponibles.js',
  'musica_cierre_disponible.js',
  'tienda.html',
  'tienda-admin.html',
  'qr-tienda.html'
];

// videos_disponibles.js lo genera "npm run actualizar" en la maquina donde
// estan los MP4, y viaja ya hecho en el repositorio. Aqui no hay carpeta de
// videos que mirar, asi que no hay nada que regenerar.

// Los efectos ya no se generan aqui: son los archivos que haya en efectos/,
// y los pone el operador en su maquina. Regenerarlos aqui recrearia los
// sinteticos y saldrian botones duplicados.

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error('Falta archivo de despliegue:', file);
    process.exit(1);
  }
}

const soundTouchNode = path.join(root, 'lib', 'soundtouch', 'SoundTouchNode.js');
const copyScript = path.join(root, 'scripts', 'copy-soundtouch-lib.js');

if (!fs.existsSync(soundTouchNode)) {
  if (!fs.existsSync(copyScript)) {
    console.error('Falta scripts/copy-soundtouch-lib.js o lib/soundtouch en el repo.');
    process.exit(1);
  }
  execSync('node scripts/copy-soundtouch-lib.js', { cwd: root, stdio: 'inherit' });
}

if (fs.existsSync(publicDir)) {
  fs.rmSync(publicDir, { recursive: true, force: true });
}
fs.mkdirSync(publicDir, { recursive: true });

// En el repo los archivos NO cambian de nombre: index.html sigue siendo la
// app, y los scripts y las pruebas la leen de ahi como siempre. Lo que cambia
// es el nombre con el que se PUBLICA.
//
// Hace falta porque en Vercel el archivo real gana sobre las reglas de
// reescritura: mientras exista public/index.html, "/" sirve ese archivo y la
// regla nunca llega a aplicarse. Asi que se publica la web en ese sitio y la
// app al lado, sin renombrar nada aqui dentro.
const publicarComo = {
  'home.html':  'index.html',     // la web publica queda en la raiz
  'index.html': 'karaoke.html'    // la app, en su propia direccion
};

for (const file of [...required, ...optional]) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(publicDir, publicarComo[file] || file));
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyDir(path.join(root, 'lib'), path.join(publicDir, 'lib'));

// Las fotos de la web. Si la carpeta no existe, no pasa nada: el karaoke no
// depende de ella y el despliegue tiene que seguir pasando igual.
const fotosDir = path.join(root, 'fotos');
if (fs.existsSync(fotosDir)) {
  copyDir(fotosDir, path.join(publicDir, 'fotos'));
}

// Faltaba: sin esto los efectos daban 404 en el deploy y solo sonaban en local.
const efectosDir = path.join(root, 'efectos');
if (fs.existsSync(efectosDir)) {
  copyDir(efectosDir, path.join(publicDir, 'efectos'));
  const n = fs.readdirSync(efectosDir).length;
  console.log(`Efectos copiados a public/efectos (${n} archivos)`);
} else {
  console.warn('Aviso: no hay efectos/ — el reproductor no tendra sonidos.');
}

console.log('Build OK: archivos copiados a public/');
