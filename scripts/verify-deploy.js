const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

const required = [
  'index.html',
  'admin.html',
  'reproductor.html',
  'canciones.js'
];

const optional = ['logo.png', 'carteles_qr_sala_privada.html'];

for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error('Falta archivo de despliegue:', file);
    process.exit(1);
  }
}

if (fs.existsSync(publicDir)) {
  fs.rmSync(publicDir, { recursive: true, force: true });
}
fs.mkdirSync(publicDir, { recursive: true });

for (const file of [...required, ...optional]) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(publicDir, file));
  }
}

const libDir = path.join(publicDir, 'lib');
fs.mkdirSync(libDir, { recursive: true });

const processorCandidates = [
  path.join(root, 'lib', 'soundtouch-processor.js'),
  path.join(root, 'node_modules', '@soundtouchjs', 'audio-worklet', '.dist', 'soundtouch-processor.js')
];

let processorCopied = false;
for (const src of processorCandidates) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(libDir, 'soundtouch-processor.js'));
    processorCopied = true;
    break;
  }
}

if (!processorCopied) {
  console.error('Falta soundtouch-processor.js (ejecuta: npm install)');
  process.exit(1);
}

console.log('Build OK: archivos copiados a public/');
