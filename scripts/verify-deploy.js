const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = [
  'index.html',
  'admin.html',
  'reproductor.html',
  'canciones.js',
  'vercel.json'
];

for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    console.error('Falta archivo de despliegue:', file);
    process.exit(1);
  }
}

console.log('Archivos estáticos verificados en la raíz del proyecto.');
