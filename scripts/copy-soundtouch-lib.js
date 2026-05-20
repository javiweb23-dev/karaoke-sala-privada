const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copySoundTouchLib(destLibDir) {
  const stDist = path.join(root, 'node_modules', '@soundtouchjs', 'audio-worklet', '.dist');
  if (!fs.existsSync(stDist)) {
    console.error('Ejecuta npm install (@soundtouchjs/audio-worklet)');
    process.exit(1);
  }

  const stModuleDir = path.join(destLibDir, 'soundtouch');
  fs.mkdirSync(stModuleDir, { recursive: true });

  for (const f of ['SoundTouchNode.js', 'constants.js']) {
    copyFile(path.join(stDist, f), path.join(stModuleDir, f));
  }

  copyFile(
    path.join(stDist, 'soundtouch-processor.js'),
    path.join(destLibDir, 'soundtouch-processor.js')
  );
}

copySoundTouchLib(path.join(root, 'lib'));
console.log('lib/soundtouch listo');
