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

console.log('Build OK: archivos copiados a public/');
