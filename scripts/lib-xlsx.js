// Escritor minimo de archivos .xlsx, sin dependencias.
//
// Un .xlsx es un ZIP con unos cuantos XML dentro. Se escribe a mano en vez de
// instalar una libreria: son 100 lineas y evita meterle al proyecto un paquete
// enorme del que despues hay que estar pendiente.
//
// Los datos van como "inline strings", que ahorra la tabla de cadenas
// compartidas y hace el archivo mas simple sin que Excel se queje.

const zlib = require('zlib');

// --------------------------------------------------------------------- ZIP

const TABLA_CRC = (() => {
    const tabla = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        tabla[n] = c;
    }
    return tabla;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
        c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ -1) >>> 0;
}

// ZIP con deflate. Excel acepta tambien sin comprimir, pero comprimido pesa
// una fraccion y el XML comprime muchisimo.
function crearZip(archivos) {
    const locales = [];
    const central = [];
    let offset = 0;

    for (const { nombre, datos } of archivos) {
        const nombreBuf = Buffer.from(nombre, 'utf8');
        const comprimido = zlib.deflateRawSync(datos);
        const crc = crc32(datos);

        const cabecera = Buffer.alloc(30);
        cabecera.writeUInt32LE(0x04034b50, 0);   // firma local
        cabecera.writeUInt16LE(20, 4);           // version necesaria
        cabecera.writeUInt16LE(0x0800, 6);       // nombres en UTF-8
        cabecera.writeUInt16LE(8, 8);            // metodo: deflate
        cabecera.writeUInt16LE(0, 10);           // hora
        cabecera.writeUInt16LE(0x2821, 12);      // fecha (fija, da igual)
        cabecera.writeUInt32LE(crc, 14);
        cabecera.writeUInt32LE(comprimido.length, 18);
        cabecera.writeUInt32LE(datos.length, 22);
        cabecera.writeUInt16LE(nombreBuf.length, 26);
        cabecera.writeUInt16LE(0, 28);           // sin campos extra

        locales.push(cabecera, nombreBuf, comprimido);

        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(0x02014b50, 0);        // firma de directorio
        dir.writeUInt16LE(20, 4);
        dir.writeUInt16LE(20, 6);
        dir.writeUInt16LE(0x0800, 8);
        dir.writeUInt16LE(8, 10);
        dir.writeUInt16LE(0, 12);
        dir.writeUInt16LE(0x2821, 14);
        dir.writeUInt32LE(crc, 16);
        dir.writeUInt32LE(comprimido.length, 20);
        dir.writeUInt32LE(datos.length, 24);
        dir.writeUInt16LE(nombreBuf.length, 28);
        dir.writeUInt32LE(0, 38);                // atributos externos
        dir.writeUInt32LE(offset, 42);           // donde empieza el local

        central.push(dir, nombreBuf);
        offset += cabecera.length + nombreBuf.length + comprimido.length;
    }

    const cuerpo = Buffer.concat(locales);
    const directorio = Buffer.concat(central);

    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    fin.writeUInt16LE(archivos.length, 8);
    fin.writeUInt16LE(archivos.length, 10);
    fin.writeUInt32LE(directorio.length, 12);
    fin.writeUInt32LE(cuerpo.length, 16);

    return Buffer.concat([cuerpo, directorio, fin]);
}

// -------------------------------------------------------------------- XLSX

function escaparXml(texto) {
    return String(texto == null ? '' : texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
        // Excel rechaza el archivo entero si aparece un caracter de control.
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

// 0 -> A, 25 -> Z, 26 -> AA
function letraColumna(indice) {
    let s = '';
    let n = indice;
    while (n >= 0) {
        s = String.fromCharCode((n % 26) + 65) + s;
        n = Math.floor(n / 26) - 1;
    }
    return s;
}

function celda(valor, fila, col) {
    const ref = `${letraColumna(col)}${fila}`;
    if (typeof valor === 'number' && isFinite(valor)) {
        return `<c r="${ref}"><v>${valor}</v></c>`;
    }
    const texto = escaparXml(valor);
    if (!texto) return `<c r="${ref}"/>`;
    // La cabecera (fila 1) va en negrita con el estilo 1.
    const estilo = fila === 1 ? ' s="1"' : '';
    return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`;
}

/**
 * Escribe un .xlsx de una sola hoja.
 *
 * @param {string[]} cabeceras  Titulos de columna.
 * @param {Array[]} filas       Filas de datos (numeros o texto).
 * @param {object} opciones     { nombreHoja, anchos }
 */
function crearXlsx(cabeceras, filas, opciones = {}) {
    const nombreHoja = escaparXml(opciones.nombreHoja || 'Hoja1');
    const anchos = opciones.anchos || [];

    const todas = [cabeceras, ...filas];
    const xmlFilas = todas.map((fila, i) => {
        const n = i + 1;
        const celdas = fila.map((v, j) => celda(v, n, j)).join('');
        return `<row r="${n}">${celdas}</row>`;
    }).join('');

    const cols = anchos.length
        ? '<cols>' + anchos.map((w, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
          ).join('') + '</cols>'
        : '';

    const ultimaCol = letraColumna(cabeceras.length - 1);
    const ultimaFila = todas.length;

    const hoja =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0">` +
// Fila de titulos congelada: al bajar por la lista se siguen viendo.
`<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
`</sheetView></sheetViews>
${cols}
<sheetData>${xmlFilas}</sheetData>` +
// Filtros en la cabecera: permite ordenar y filtrar sin tocar nada.
`<autoFilter ref="A1:${ultimaCol}${ultimaFila}"/>
</worksheet>`;

    const estilos =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`;

    const archivos = [
        {
            nombre: '[Content_Types].xml',
            datos: Buffer.from(
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`, 'utf8')
        },
        {
            nombre: '_rels/.rels',
            datos: Buffer.from(
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`, 'utf8')
        },
        {
            nombre: 'xl/workbook.xml',
            datos: Buffer.from(
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${nombreHoja}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`, 'utf8')
        },
        {
            nombre: 'xl/_rels/workbook.xml.rels',
            datos: Buffer.from(
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`, 'utf8')
        },
        { nombre: 'xl/styles.xml', datos: Buffer.from(estilos, 'utf8') },
        { nombre: 'xl/worksheets/sheet1.xml', datos: Buffer.from(hoja, 'utf8') }
    ];

    return crearZip(archivos);
}

module.exports = { crearXlsx };
