// Lee la hora de captura (EXIF DateTimeOriginal) de una foto JPEG.
// Devuelve milisegundos (hora local del celular) o null si la foto no trae ese dato.
export function leerFechaExif(view) {
  if (view.byteLength < 12 || view.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) return null;
    const marca = view.getUint8(p + 1);
    const largo = view.getUint16(p + 2);
    if (marca === 0xe1 && view.getUint32(p + 4) === 0x45786966) return fechaTiff(view, p + 10); // "Exif"
    if (marca === 0xda) return null; // comienzan los datos de imagen
    p += 2 + largo;
  }
  return null;
}

function fechaTiff(view, t) {
  const le = view.getUint16(t) === 0x4949;
  const u16 = (o) => view.getUint16(o, le);
  const u32 = (o) => view.getUint32(o, le);
  const texto = (o, n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(o + i)); return s; };
  // Devuelve el desplazamiento de la entrada de una etiqueta dentro de un directorio.
  const buscar = (dir, etiqueta) => {
    const n = u16(dir);
    for (let i = 0; i < n; i++) {
      const e = dir + 2 + i * 12;
      if (u16(e) === etiqueta) return e;
    }
    return null;
  };
  const fecha = (dir, etiqueta) => {
    const e = buscar(dir, etiqueta);
    if (e == null) return null;
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(texto(t + u32(e + 8), 19));
    if (!m) return null;
    const ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    return Number.isNaN(ms) ? null : ms;
  };
  const ifd0 = t + u32(t + 4);
  const punteroExif = buscar(ifd0, 0x8769);
  if (punteroExif != null) {
    const sub = t + u32(punteroExif + 8);
    const f = fecha(sub, 0x9003) ?? fecha(sub, 0x9004); // DateTimeOriginal, DateTimeDigitized
    if (f != null) return f;
  }
  return null;
}

// Hora de una foto: la de captura si la foto la trae (verificada), o la de modificación del archivo.
export async function horaDeFoto(file) {
  const ahora = Date.now();
  let exif = null;
  try {
    exif = leerFechaExif(new DataView(await file.slice(0, 262144).arrayBuffer()));
  } catch { /* archivo ilegible o EXIF dañado: se trata como no verificada */ }
  if (exif != null && exif <= ahora + 5 * 60000) return { hora: new Date(Math.min(exif, ahora)).toISOString(), verificada: true };
  const mod = file.lastModified || ahora;
  return { hora: new Date(Math.min(mod, ahora)).toISOString(), verificada: false };
}
