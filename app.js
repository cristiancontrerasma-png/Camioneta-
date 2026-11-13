import {
  initializeFirestore, persistentLocalCache, collection, setDoc, doc, getDocs, getDocFromServer, query, where, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { fb } from "./fb.js";
import { horaDeFoto } from "./exif.js";
import { CHECKLIST, GRUPOS, RESPUESTAS, CHECKLIST_AVISO, contarChecklist, itemsConNo } from "./checklist.js";
import {
  auth, primerEstado, entrar, registrar, asegurarPerfil, validar, mensajeError, salir,
  CLAVE_INICIAL, CUENTAS_INICIALES, usuarioDe, ultimoUsuario, marcarCambioClave, debeCambiarClave, validarClaveNueva, cambiarClave,
} from "./cuenta.js";

const db = initializeFirestore(fb, { localCache: persistentLocalCache() });

const TURNOS = ["Turno A", "Turno B", "Turno C", "Turno D"];
const PANOS = [["frente", "Frente"], ["atras", "Atrás"], ["izq", "Lado izquierdo"], ["der", "Lado derecho"]];
const MINUTOS_MAX_FOTO_INICIO = 15; // antigüedad máxima de la foto del odómetro inicial
const MINUTOS_MAX_FOTO_FINAL = 5;   // tiempo máximo entre la foto del odómetro final y el cierre
const LADO_MAX_FOTO = 800;          // lado mayor de cada foto, en pixeles
const PESO_MAX_FOTO = 400000;      // tamaño máximo de cada foto ya comprimida (caracteres base64)
const MAX_RECORRIDO_KM = 500;       // sobre este recorrido se pide confirmar el km final
const KEY_ULTIMO_KM = "cam.ultimoKm";
const KEY_ULTIMO_TURNO = "cam.ultimoTurno";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtKm = (n) => Number(n || 0).toLocaleString("es-CL");
const hora = (iso) => new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
const fechaHora = (iso) => new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short", hour12: false });
const minutosDesde = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;
const conLimite = (promesa, ms) => Promise.race([promesa, new Promise((_, rej) => setTimeout(() => rej(new Error("tiempo agotado")), ms))]);

// ---------- Almacenamiento local (IndexedDB: las fotos no caben en localStorage) ----------
const base = new Promise((res, rej) => {
  const r = indexedDB.open("camioneta", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function leerLocal(clave) {
  const d = await base;
  return new Promise((res, rej) => {
    const q = d.transaction("kv").objectStore("kv").get(clave);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
// Guarda varias claves en una sola transacción (todo o nada).
async function guardarLocal(valores) {
  const d = await base;
  return new Promise((res, rej) => {
    const tx = d.transaction("kv", "readwrite");
    for (const [k, v] of Object.entries(valores)) tx.objectStore("kv").put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}
function avisarFalloLocal(err) {
  console.warn("No se pudo guardar en el celular:", err);
  $("#aviso").hidden = false;
}

let activo = null;      // turno en curso
let pendientes = [];    // turnos cerrados que aún no suben
let ultimo = JSON.parse(localStorage.getItem(KEY_ULTIMO_TURNO) ?? "null"); // último turno cerrado (sin fotos), para compartir de nuevo
let perfil = null;      // cuenta que está usando la app: { uid, nombre, rol }
// El turno en curso se guarda por cuenta: si otro chofer entra en el mismo teléfono, no ve ni pisa el turno ajeno.
const claveActivo = () => `activo:${perfil.uid}`;
const mios = () => pendientes.filter((p) => p.uid === perfil?.uid);

const guardarActivo = () => guardarLocal({ [claveActivo()]: activo }).catch(avisarFalloLocal);
const guardarPendientes = () => guardarLocal({ pendientes }).catch(avisarFalloLocal);

// ---------- Sesión y sincronización ----------
// "sesion" se cumple cuando hay una cuenta dentro; todo lo que usa la nube espera eso.
let sesionLista;
const sesion = new Promise((res) => { sesionLista = res; });

// Enlace público de un turno: turno.html?id=<uuid>
const enlaceTurno = (id) => new URL(`turno.html?id=${id}`, location.href).href;

// Sube fotos y registro de cada turno pendiente. Se llama al cerrar, al recuperar señal y cada minuto.
let sincronizando = false;
async function sincronizarTurnos() {
  if (!navigator.onLine || sincronizando || !mios().length) return;
  sincronizando = true;
  try {
    await sesion;
    for (const p of mios()) { // los de otra cuenta suben cuando esa persona vuelva a entrar
      try {
        p.urls ??= {};
        for (const f of p.fotos) {
          if (p.urls[f.nombre]) continue; // ya subida en un intento anterior
          // Cada foto es un documento propio en Firestore (plan gratuito, sin Storage).
          const r = doc(db, "fotos", `${p.id}_${f.nombre}`);
          try {
            await conLimite(setDoc(r, { turnoId: p.id, nombre: f.nombre, uid: auth.currentUser.uid, dataUrl: f.dataUrl, creadoEn: p.creadoEn }), 60000);
          } catch (err) {
            // Las reglas no permiten reescribir: si la foto ya quedó de un intento anterior, está lista.
            const ya = await getDocFromServer(r).catch(() => null);
            if (!ya?.exists()) throw err;
          }
          p.urls[f.nombre] = true;
          await guardarPendientes();
        }
        try {
          await conLimite(setDoc(doc(db, "turnos", p.id), { ...p.turno, uid: auth.currentUser.uid, fotos: p.fotos.map((f) => f.nombre), creadoEn: p.creadoEn }), 30000);
        } catch (err) {
          // Si el registro ya quedó en el servidor en un intento anterior, está listo.
          const ya = await getDocFromServer(doc(db, "turnos", p.id)).catch(() => null);
          if (!ya?.exists()) throw err;
        }
        pendientes = pendientes.filter((x) => x.id !== p.id);
        await guardarPendientes();
      } catch (err) {
        console.warn("Turno pendiente, se reintentará:", err);
      }
    }
  } finally {
    sincronizando = false;
    actualizarEstadoFin();
  }
}
window.addEventListener("online", sincronizarTurnos);
setInterval(sincronizarTurnos, 60000);

function actualizarEstadoFin() {
  const falta = ultimo && pendientes.some((p) => p.id === ultimo.id);
  $("#estado-fin").textContent = falta
    ? "El enlace del turno se activará cuando haya señal para subir las fotos. No borres los datos de la app."
    : "El enlace del turno ya está activo.";
  const n = mios().length;
  $("#pendientes").hidden = !n;
  $("#pendientes").textContent = n === 1 ? "Hay 1 turno esperando señal para subir." : `Hay ${n} turnos esperando señal para subir.`;
}

// Km de cierre del último turno: desde Firestore, o el último valor guardado en este celular.
async function ultimoKmCerrado() {
  try {
    await sesion;
    const snap = await conLimite(getDocs(query(collection(db, "cierres"), orderBy("cerradoEn", "desc"), limit(1))), 10000);
    if (!snap.empty) {
      const km = snap.docs[0].data().kmFinal;
      localStorage.setItem(KEY_ULTIMO_KM, JSON.stringify(km));
      return km;
    }
  } catch { /* sin conexión: usa el valor guardado */ }
  return JSON.parse(localStorage.getItem(KEY_ULTIMO_KM) ?? "null");
}

// Registra solo el km del cierre, sin chofer ni salidas: es lo único que otro chofer necesita (y puede) leer.
function guardarCierre(id, turno) {
  localStorage.setItem(KEY_ULTIMO_KM, JSON.stringify(turno.kmFinal));
  setDoc(doc(db, "cierres", id), {
    turno: turno.turno,
    cerradoEn: turno.cerradoEn,
    kmFinal: turno.kmFinal,
  }).catch((err) => console.warn("Cierre guardado localmente, se reintentará:", err));
}

// ---------- Vistas ----------
const VISTAS = ["vista-acceso", "vista-clave", "vista-espera", "vista-checklist", "vista-inicio", "vista-estado", "vista-cierre", "vista-salida", "vista-fin", "vista-mios"];
let vistaActual = "vista-inicio";
let origenSalida = "vista-estado";
function ir(id) {
  if (id === "vista-salida") origenSalida = vistaActual;
  for (const v of VISTAS) document.getElementById(v).hidden = v !== id;
  vistaActual = id;
  window.scrollTo(0, 0);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ir]");
  if (b) ir(b.dataset.ir);
});

// ---------- Fotos ----------
function leerFoto(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, LADO_MAX_FOTO / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      // Fotos livianas: cada una debe caber holgada en un documento de Firestore (máximo 1 MB).
      let calidad = 0.6;
      let data = c.toDataURL("image/jpeg", calidad);
      while (data.length > PESO_MAX_FOTO && calidad > 0.2) {
        calidad -= 0.1;
        data = c.toDataURL("image/jpeg", calidad);
      }
      if (data.length > PESO_MAX_FOTO) return reject(new Error("foto demasiado pesada"));
      resolve(data);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Inicio de turno ----------
$("#turno").innerHTML = `<option value="">Seleccionar</option>` + TURNOS.map((t) => `<option>${esc(t)}</option>`).join("");

function alertaKm(kmInicio, kmAnterior) {
  if (kmAnterior == null) return [];
  if (kmInicio > kmAnterior) return [`Hay ${fmtKm(kmInicio - kmAnterior)} km sin registrar desde el cierre anterior (${fmtKm(kmAnterior)}).`];
  if (kmInicio < kmAnterior) return [`El km inicial (${fmtKm(kmInicio)}) es menor que el cierre anterior (${fmtKm(kmAnterior)}).`];
  return [];
}

function renderInicio() {
  const f = $("#form-inicio");
  if (activo) {
    // Corrección de un turno ya iniciado: se conservan sus fotos.
    f.turno.value = activo.turno;
    f.kmInicio.value = activo.kmInicio;
  }
  f.chofer.value = perfil.nombre;
  $("#quien").textContent = `Sesión: ${perfil.nombre}`;
  $("#foto-inicio-ok").hidden = !activo?.fotos.inicio;
  $("#recompartir-ultimo").hidden = !ultimo || !!activo;
}

// La hora de inicio es la de captura de la foto del odómetro inicial, no la del botón Continuar.
let fotoInicioTmp = null;
$("#form-inicio").addEventListener("change", async (e) => {
  if (e.target.name !== "fotoInicio") return;
  const msg = $("#msg-inicio");
  msg.textContent = "";
  fotoInicioTmp = null;
  const file = e.target.files?.[0];
  if (!file) return;
  const h = await horaDeFoto(file);
  if (minutosDesde(h.hora) > MINUTOS_MAX_FOTO_INICIO) {
    e.target.value = "";
    msg.textContent = `Esa foto tiene más de ${MINUTOS_MAX_FOTO_INICIO} minutos. Toma una nueva del odómetro.`;
    return;
  }
  const dataUrl = await leerFoto(file).catch(() => null);
  if (!dataUrl) { e.target.value = ""; msg.textContent = "No se pudo leer la foto. Intenta de nuevo."; return; }
  fotoInicioTmp = { dataUrl, ...h };
});

$("#form-inicio").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $("#msg-inicio");
  msg.textContent = "";
  const turno = f.turno.value;
  const chofer = perfil.nombre;
  const kmInicio = Number(f.kmInicio.value);
  if (!turno || !chofer) { msg.textContent = "Selecciona el turno e indica el nombre del chofer."; return; }
  if (!Number.isInteger(kmInicio) || kmInicio <= 0) { msg.textContent = "Ingresa el kilometraje inicial."; return; }
  if (!fotoInicioTmp && !activo?.fotos.inicio) { msg.textContent = "Toma la foto del odómetro."; return; }
  const kmAnterior = await ultimoKmCerrado();

  activo = {
    ...(activo ?? { salidas: [], fotos: {}, paneles: {}, checklist: {}, checklistObs: "" }),
    conductor: `${turno} · ${chofer}`,
    turno,
    chofer,
    kmInicio,
    alertas: alertaKm(kmInicio, kmAnterior),
  };
  if (fotoInicioTmp) {
    activo.fotos.inicio = fotoInicioTmp.dataUrl;
    // La hora de inicio es la de la primera foto: si después se reemplaza la foto, la hora de inicio no cambia.
    if (!activo.fecha) {
      activo.fecha = fotoInicioTmp.hora;
      activo.inicioVerificado = fotoInicioTmp.verificada;
    }
  }
  fotoInicioTmp = null;
  f.fotoInicio.value = "";
  guardarActivo();
  if (volverACierre) {
    // Corrección hecha desde la pantalla de cierre: vuelve ahí sin perder lo ya ingresado.
    volverACierre = false;
    $("#km-inicio-txt").textContent = fmtKm(activo.kmInicio);
    $("#form-cierre").kmFinal.dispatchEvent(new Event("input", { bubbles: true }));
    ir("vista-cierre");
    return;
  }
  renderEstado();
  ir("vista-estado");
});

$("#recompartir-ultimo").addEventListener("click", () => { if (ultimo) compartir(ultimo); });

// ---------- Mis turnos: cada chofer ve solo los turnos cerrados desde su propio celular ----------
$("#ver-mios").addEventListener("click", async () => {
  const lista = $("#lista-mios");
  lista.innerHTML = `<p class="ayuda">Cargando…</p>`;
  ir("vista-mios");
  try {
    await sesion;
    const snap = await conLimite(getDocs(query(collection(db, "turnos"), where("uid", "==", auth.currentUser.uid))), 15000);
    const cerrados = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
    const esperando = mios().length ? `<p class="ayuda">${mios().length === 1 ? "1 turno espera" : mios().length + " turnos esperan"} señal para subir.</p>` : "";
    lista.innerHTML = esperando + (cerrados.map((t) => `
      <a class="card mio" href="turno.html?id=${esc(t.id)}">
        <strong>${fechaHora(t.fecha)} · ${esc(t.conductor)}</strong>
        <span>Km ${fmtKm(t.kmInicio)} → ${fmtKm(t.kmFinal)} · Recorrido ${fmtKm(t.recorrido)} km</span>
      </a>`).join("") || `<p class="ayuda">Aún no hay turnos cerrados desde este celular.</p>`);
  } catch {
    lista.innerHTML = `<p class="msg">No se pudieron cargar tus turnos. Revisa la señal e intenta de nuevo.</p>`;
  }
});

// ---------- Estado de la camioneta ----------
function renderEstado() {
  $("#panos").innerHTML = PANOS.map(([k, nombre]) => `
    <label class="pano ${activo.paneles[k] ? "listo" : ""}">
      ${activo.paneles[k] ? `<img src="${activo.paneles[k]}" alt="${nombre}">` : `<span class="vacio">Sin foto</span>`}
      <strong>${nombre}</strong>
      <input class="sr-only" type="file" accept="image/*" data-pano="${k}">
      <span class="btn-mini">${activo.paneles[k] ? "Repetir foto" : "Tomar foto"}</span>
    </label>`).join("");
  const al = $("#alertas-turno");
  al.hidden = !activo.alertas.length;
  al.textContent = activo.alertas.join(" ");

  // Combustible y revisión siempre reflejan el turno en curso (no lo que quedó en pantalla del turno anterior).
  const c = $("#combustible");
  const cargo = !!activo.combustible?.cargo;
  c.querySelector("[name=cargoCombustible]").checked = cargo;
  c.querySelector("[name=litros]").value = activo.combustible?.litros ?? "";
  c.querySelector("[name=fotoCombustible]").value = "";
  $("#carga-detalle").hidden = !cargo;
  $("#foto-combustible-ok").hidden = !activo.fotos.combustible;
  actualizarAvanceChecklist();
  $("#limpieza").querySelector("[name=limpieza]").checked = !!activo.limpieza;
  $("#msg-estado").textContent = "";
  renderSalidas();
}

$("#panos").addEventListener("change", async (e) => {
  const k = e.target.dataset.pano;
  if (!k) return;
  const data = await leerFoto(e.target.files?.[0]).catch(() => null);
  if (data) {
    activo.paneles[k] = data;
    guardarActivo();
    renderEstado();
  } else {
    $("#msg-estado").textContent = "No se pudo leer la foto. Intenta de nuevo.";
  }
});

$("#combustible").addEventListener("change", async (e) => {
  if (e.target.name === "cargoCombustible") {
    $("#carga-detalle").hidden = !e.target.checked;
    activo.combustible = { ...(activo.combustible ?? {}), cargo: e.target.checked };
  }
  if (e.target.name === "fotoCombustible") {
    activo.fotos.combustible = await leerFoto(e.target.files?.[0]).catch(() => null);
    $("#foto-combustible-ok").hidden = !activo.fotos.combustible;
  }
  guardarActivo();
});
$("#combustible").addEventListener("input", (e) => {
  if (e.target.name !== "litros") return;
  activo.combustible = { ...(activo.combustible ?? {}), litros: e.target.value };
  guardarActivo();
});

// La limpieza es 1 o 2 veces por semana: se anota solo cuando se hace y no es requisito para cerrar.
$("#limpieza").addEventListener("change", (e) => {
  activo.limpieza = e.target.checked;
  guardarActivo();
});

// ---------- Check list de la camioneta (obligatorio en cada turno) ----------
function renderChecklist() {
  const item = (it, i) => `
    <div class="item-ck ${activo.checklist[it.id] === "no" ? "con-no" : ""}">
      <span>${i + 1}. ${esc(it.texto)}</span>
      <div class="seg" role="radiogroup" aria-label="${esc(it.corto)}">
        ${Object.entries(RESPUESTAS).map(([v, n]) => `<label><input type="radio" name="ck-${it.id}" value="${v}" ${activo.checklist[it.id] === v ? "checked" : ""}><span>${n}</span></label>`).join("")}
      </div>
    </div>`;
  // Cuatro grupos desplegables: se abre solo el primero que tenga algo pendiente.
  $("#lista-checklist").innerHTML = GRUPOS.map((g, gi) => `
    <details class="grupo-ck" data-grupo="${gi}">
      <summary><span>${esc(g)}</span><span class="chip"></span></summary>
      ${CHECKLIST.map((it, i) => (it.grupo === gi ? item(it, i) : "")).join("")}
    </details>`).join("");
  $("#checklist-obs").value = activo.checklistObs ?? "";
  actualizarAvanceChecklist();
  abrirPendiente();
}
function abrirPendiente() {
  const grupos = [...document.querySelectorAll(".grupo-ck")];
  const pendiente = grupos.find((d) => contarChecklist(activo.checklist, Number(d.dataset.grupo)).falta);
  grupos.forEach((d) => { d.open = d === pendiente; });
}
function actualizarGrupos() {
  document.querySelectorAll(".grupo-ck").forEach((d) => {
    const c = contarChecklist(activo.checklist, Number(d.dataset.grupo));
    const chip = d.querySelector(".chip");
    chip.textContent = c.falta ? (c.falta === c.si + c.no + c.na + c.falta ? "Pendiente" : `Faltan ${c.falta}`) : c.no ? `${c.no} NO` : "✓ Listo";
    chip.className = `chip ${c.falta ? "pend" : c.no ? "no" : "ok"}`;
  });
  $("#aviso-no").hidden = !contarChecklist(activo.checklist).no;
}
function actualizarAvanceChecklist() {
  const c = contarChecklist(activo.checklist);
  const hechos = CHECKLIST.length - c.falta;
  const txt = c.falta ? `${hechos} de ${CHECKLIST.length} ítems respondidos.` : `Completo: ${c.si} SI · ${c.no} NO · ${c.na} N.A.`;
  $("#avance-checklist").textContent = txt;
  $("#checklist-estado").textContent = hechos ? txt : "Sin responder. Es obligatorio para cerrar el turno.";
  $("#abrir-checklist").textContent = c.falta ? "Completar check list" : "Revisar check list";
  actualizarGrupos();
}
$("#aviso-no").textContent = CHECKLIST_AVISO;
$("#abrir-checklist").addEventListener("click", () => { renderChecklist(); ir("vista-checklist"); });
$("#cerrar-checklist").addEventListener("click", () => { renderEstado(); ir("vista-estado"); });
$("#lista-checklist").addEventListener("change", (e) => {
  if (e.target.type !== "radio") return;
  const grupo = Number(e.target.closest(".grupo-ck").dataset.grupo);
  const faltaban = contarChecklist(activo.checklist, grupo).falta;
  activo.checklist[e.target.name.slice(3)] = e.target.value;
  e.target.closest(".item-ck").classList.toggle("con-no", e.target.value === "no");
  guardarActivo();
  actualizarAvanceChecklist();
  // Al completar un grupo se pliega y se abre el siguiente pendiente.
  if (faltaban && !contarChecklist(activo.checklist, grupo).falta) abrirPendiente();
});
// No hay botón de "marcar todo": cada ítem debe revisarse y responderse uno por uno.
$("#checklist-obs").addEventListener("input", (e) => {
  activo.checklistObs = e.target.value;
  guardarActivo();
});

let volverACierre = false;
$("#volver-inicio").addEventListener("click", () => { volverACierre = false; renderInicio(); ir("vista-inicio"); });
$("#corregir-desde-cierre").addEventListener("click", () => { volverACierre = true; renderInicio(); ir("vista-inicio"); });
$("#corregir-inicio-cierre").addEventListener("click", () => { renderInicio(); ir("vista-inicio"); });

// Lo que falta del estado de la camioneta para poder cerrar el turno.
function faltantesEstado() {
  const f = [];
  if (!activo.fotos.inicio) f.push("Foto del odómetro inicial");
  for (const [k, n] of PANOS) if (!activo.paneles[k]) f.push(`Foto panorámica: ${n}`);
  const ck = contarChecklist(activo.checklist);
  if (ck.falta) f.push(`Check list de la camioneta: ${ck.falta === CHECKLIST.length ? "sin responder" : "faltan " + ck.falta + " ítems por responder"}`);
  else if (ck.no && !(activo.checklistObs ?? "").trim()) f.push("Check list: explica en Observaciones los ítems marcados NO");
  if (activo.combustible?.cargo) {
    if (!(Number(activo.combustible.litros) > 0)) f.push("Litros de combustible cargados");
    if (!activo.fotos.combustible) f.push("Foto del medidor de combustible");
  }
  return f;
}
const listaFaltantes = (titulo, f) => `${titulo}\n${f.map((x) => "• " + x).join("\n")}`;

$("#continuar-estado").addEventListener("click", () => {
  const faltan = faltantesEstado();
  if (faltan.length) { $("#msg-estado").textContent = listaFaltantes("Para continuar falta:", faltan); return; }
  $("#msg-estado").textContent = "";
  renderCierre();
  ir("vista-cierre");
});

// ---------- Salidas de faena (en cualquier momento del turno) ----------
function renderSalidas() {
  const lista = activo?.salidas ?? [];
  document.querySelectorAll(".lista-salidas").forEach((el) => {
    el.innerHTML = lista.length
      ? lista.map((s) => `<div class="salida">${hora(s.hora)} · ${esc(s.motivo)} <span class="ayuda">(autorizó ${esc(s.autorizadaPor)})</span></div>`).join("")
      : `<p class="ayuda">Sin salidas de faena en este turno.</p>`;
  });
}

$("#form-salida").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $("#msg-salida");
  msg.textContent = "";
  if (!activo) return;
  const autorizadaPor = f.autorizadaPor.value;
  const motivo = f.motivo.value.trim();
  if (!autorizadaPor) { msg.textContent = "Sin autorización de un jefe no se puede salir de faena."; return; }
  if (!motivo) { msg.textContent = "Indica el motivo de la salida."; return; }
  activo.salidas.push({ hora: new Date().toISOString(), autorizadaPor, motivo });
  guardarActivo();
  f.reset();
  renderSalidas();
  ir(origenSalida);
});
$("#volver-salida").addEventListener("click", () => ir(origenSalida));

// ---------- Cierre ----------
let recorridoConfirmado = null;
function renderCierre() {
  // La foto final debe tomarse al cerrar: se descarta si no hay o si ya pasó el límite.
  // Si el chofer fue a corregir algo y volvió a tiempo, la foto final recién tomada se conserva.
  if (!activo.fotos.final || minutosDesde(activo.fotos.finalHora) > MINUTOS_MAX_FOTO_FINAL) {
    activo.fotos.final = null;
    activo.fotos.finalHora = null;
    guardarActivo();
    $("#form-cierre").fotoFinal.value = "";
  }
  $("#km-inicio-txt").textContent = fmtKm(activo.kmInicio);
  $("#recorrido-txt").textContent = "—";
  $("#msg-cierre").textContent = "";
  recorridoConfirmado = null;
  renderSalidas();
}

$("#form-cierre").addEventListener("input", (e) => {
  if (e.target.name !== "kmFinal") return;
  const d = Number(e.target.value) - activo.kmInicio;
  $("#recorrido-txt").textContent = e.target.value && d >= 0 ? `${fmtKm(d)} km` : "—";
});

$("#form-cierre").addEventListener("change", async (e) => {
  const msg = $("#msg-cierre");
  if (e.target.name === "fotoFinal") {
    msg.textContent = "";
    activo.fotos.final = null;
    activo.fotos.finalHora = null;
    const file = e.target.files?.[0];
    if (file) {
      const h = await horaDeFoto(file);
      if (minutosDesde(h.hora) > MINUTOS_MAX_FOTO_FINAL) {
        e.target.value = "";
        msg.textContent = `Esa foto tiene más de ${MINUTOS_MAX_FOTO_FINAL} minutos. Toma una nueva del odómetro final.`;
      } else {
        activo.fotos.final = await leerFoto(file).catch(() => null);
        activo.fotos.finalHora = h.hora;
        activo.finalVerificado = h.verificada;
        if (!activo.fotos.final) msg.textContent = "No se pudo leer la foto. Intenta de nuevo.";
      }
    }
  }
  if (e.target.name === "fotoNovedad") activo.fotos.novedad = await leerFoto(e.target.files?.[0]).catch(() => null);
  guardarActivo();
});

function textoCombustible(c) {
  if (!c?.cargo) return "sin carga";
  return `${c.litros ? c.litros + " L" : "litros no informados"}, foto del medidor en el enlace`;
}
function textoSalidas(t) {
  return (t.salidas || []).map((s) => `${hora(s.hora)} · ${s.motivo} (autorizó ${s.autorizadaPor})`).join(" | ");
}
function lineasChecklist(t) {
  const c = contarChecklist(t.checklist);
  const no = itemsConNo(t.checklist);
  return [
    `Check list (${CHECKLIST.length} ítems): ${c.si} SI · ${c.no} NO · ${c.na} N.A.`,
    ...(no.length ? [`❌ Con NO: ${no.join(", ")}`] : []),
    ...(t.checklistObs ? [`Obs. check list: ${t.checklistObs}`] : []),
  ];
}
// El mensaje de WhatsApp no lleva la marca "hora no verificada" (en iPhone saldría siempre);
// queda en la página del turno y en el CSV, para quien quiera auditar.

function resumen(t) {
  return [
    "🚚 OHLA Chile · Camioneta de Servicios Túnel",
    `Conductor: ${t.conductor}`,
    `Inicio de turno (foto odómetro): ${fechaHora(t.fecha)}`,
    `Km inicio: ${fmtKm(t.kmInicio)} · Km final: ${fmtKm(t.kmFinal)} · Recorrido: ${fmtKm(t.recorrido)} km`,
    `Término de turno (foto odómetro final): ${t.odometroFinal ? fechaHora(t.odometroFinal) : "sin foto"}`,
    ...lineasChecklist(t),
    ...(t.limpieza ? ["🧽 Limpieza: realizada en este turno"] : []),
    `Combustible: ${textoCombustible(t.combustible)}`,
    `Salidas de faena: ${textoSalidas(t) || "ninguna"}`,
    `Novedades: ${t.novedad || "sin novedades"}`,
    ...(t.alertas?.length ? [`⚠️ ${t.alertas.join(" ")}`] : []),
  ].join("\n");
}

// Debe llamarse directamente desde el clic (gesto del usuario) para que el navegador permita compartir.
function compartir(p) {
  const texto = `${resumen(p.turno)}\n🔗 Ver turno y fotos: ${enlaceTurno(p.id)}`;
  // Abre WhatsApp directo con el mensaje escrito: el chofer solo elige el grupo y toca enviar.
  const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
  const ventana = window.open(url, "_blank");
  if (!ventana) location.href = url; // si el navegador bloquea la ventana nueva, abre WhatsApp en esta misma
}

$("#form-cierre").addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $("#msg-cierre");
  msg.textContent = "";
  const kmFinal = Number(f.kmFinal.value);
  const novedad = f.novedad.value.trim();

  // No se cierra ni se genera el enlace si falta algún dato: se avisa todo lo que falta, de una vez.
  const faltan = faltantesEstado();
  if (!activo.fotos.final) faltan.push("Foto del odómetro final");
  if (f.kmFinal.value === "" || !Number.isInteger(kmFinal) || kmFinal < activo.kmInicio) faltan.push(`Kilometraje final (igual o mayor al inicial, ${fmtKm(activo.kmInicio)})`);
  if (faltan.length) { msg.textContent = listaFaltantes("No se puede cerrar el turno. Falta:", faltan); return; }

  const recorrido = kmFinal - activo.kmInicio;
  if (recorrido > MAX_RECORRIDO_KM && recorridoConfirmado !== kmFinal) {
    recorridoConfirmado = kmFinal;
    msg.textContent = `El recorrido sería de ${fmtKm(recorrido)} km. Revisa el km final; si es correcto, presiona de nuevo para cerrar.`;
    return;
  }
  if (minutosDesde(activo.fotos.finalHora) > MINUTOS_MAX_FOTO_FINAL) {
    activo.fotos.final = null;
    activo.fotos.finalHora = null;
    guardarActivo();
    f.fotoFinal.value = "";
    msg.textContent = `La foto del odómetro final tiene más de ${MINUTOS_MAX_FOTO_FINAL} minutos. Tómala de nuevo.`;
    return;
  }

  const cerradoEn = new Date().toISOString();
  const turno = {
    turno: activo.turno,
    chofer: activo.chofer,
    conductor: activo.conductor,
    fecha: activo.fecha,
    inicioVerificado: activo.inicioVerificado ?? false,
    kmInicio: activo.kmInicio,
    kmFinal,
    recorrido,
    salidas: activo.salidas,
    odometroFinal: activo.fotos.finalHora,
    finalVerificado: activo.finalVerificado ?? false,
    checklist: activo.checklist,
    checklistObs: (activo.checklistObs ?? "").trim(),
    limpieza: !!activo.limpieza,
    combustible: activo.combustible ?? null,
    novedad,
    alertas: activo.alertas,
    cerradoEn,
  };
  const fotos = [
    ["inicio", activo.fotos.inicio],
    ...PANOS.map(([k]) => [k, activo.paneles[k]]),
    ["final", activo.fotos.final],
    ["novedad", activo.fotos.novedad],
    ["combustible", turno.combustible?.cargo ? activo.fotos.combustible : null],
  ].filter(([, d]) => d).map(([nombre, dataUrl]) => ({ nombre, dataUrl }));

  const id = crypto.randomUUID();
  guardarCierre(id, turno);
  const pendiente = { id, uid: perfil.uid, turno, fotos, urls: {}, creadoEn: cerradoEn };
  ultimo = { id, uid: perfil.uid, turno };
  localStorage.setItem(KEY_ULTIMO_TURNO, JSON.stringify(ultimo));
  pendientes = [...pendientes, pendiente];
  activo = null;
  // Una sola transacción: el turno pasa de "en curso" a "pendiente de subir" sin duplicar las fotos.
  const guardado = guardarLocal({ pendientes, [claveActivo()]: null }).catch(avisarFalloLocal);

  compartir(ultimo);                    // primero, dentro del clic
  guardado.then(sincronizarTurnos);     // luego sube fotos y registro (si hay señal)
  actualizarEstadoFin();
  ir("vista-fin");
});

$("#recompartir").addEventListener("click", () => { if (ultimo) compartir(ultimo); });
$("#nuevo-turno").addEventListener("click", () => {
  $("#form-inicio").reset();
  $("#form-cierre").reset();
  renderInicio();
  sugerirKmInicial();
  ir("vista-inicio");
});

// ---------- Cuenta: entrar, crear cuenta, salir ----------
$("#form-acceso").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $("#msg-acceso");
  const crear = e.submitter?.value === "crear";
  const falta = validar(f.nombre.value, f.clave.value, crear);
  if (falta) { msg.textContent = falta; return; }
  const conClaveInicial = f.clave.value === CLAVE_INICIAL;
  msg.textContent = crear ? "Creando cuenta…" : "Entrando…";
  try {
    let user;
    if (crear) {
      user = await registrar(db, f.nombre.value, f.clave.value);
    } else {
      try {
        user = await entrar(db, f.nombre.value, f.clave.value);
      } catch (err) {
        // Usuarios fijos (Navaria1, Cerdaju2...): la primera vez basta con «Entrar» y la clave inicial; la cuenta se crea sola.
        const primeraVez = CUENTAS_INICIALES[usuarioDe(f.nombre.value)] && conClaveInicial && String(err?.code).includes("invalid-credential");
        if (!primeraVez) throw err;
        user = await registrar(db, f.nombre.value, f.clave.value).catch(() => { throw err; });
      }
    }
    f.reset();
    msg.textContent = "";
    if (conClaveInicial) marcarCambioClave(user.uid);
    await arrancar(user);
  } catch (err) {
    msg.textContent = mensajeError(err);
  }
});

// Cambio de clave. Dos casos: obligatorio (entró con la clave inicial) o voluntario (botón "Cambiar mi clave").
function mostrarCambioClave(obligatorio) {
  const f = $("#form-clave");
  f.reset();
  f.dataset.obligatorio = obligatorio ? "1" : "";
  $("#clave-intro").textContent = obligatorio
    ? "Entraste con la clave inicial. Antes de seguir, crea una clave propia de 6 números que solo tú conozcas."
    : "Escribe tu clave actual y luego la nueva, de 6 números.";
  $("#clave-actual-campo").hidden = obligatorio;   // la clave inicial ya se conoce
  $("#cancelar-clave").hidden = obligatorio;
  $("#msg-clave").textContent = "";
  ir("vista-clave");
}
$("#abrir-clave").addEventListener("click", () => mostrarCambioClave(false));
$("#cancelar-clave").addEventListener("click", () => ir("vista-inicio"));

$("#form-clave").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  const msg = $("#msg-clave");
  const obligatorio = f.dataset.obligatorio === "1";
  const actual = obligatorio ? CLAVE_INICIAL : f.actual.value;
  if (!actual) { msg.textContent = "Escribe tu clave actual."; return; }
  const falta = validarClaveNueva(f.nueva.value, f.repetida.value) || (f.nueva.value === actual ? "La clave nueva debe ser distinta de la actual." : "");
  if (falta) { msg.textContent = falta; return; }
  msg.textContent = "Guardando…";
  try {
    await cambiarClave(actual, f.nueva.value);
    f.reset();
    msg.textContent = "";
    if (obligatorio) { await arrancar(auth.currentUser); return; }
    $("#msg-inicio").textContent = "Clave cambiada. Úsala la próxima vez que entres.";
    ir("vista-inicio");
  } catch (err) {
    const c = err?.code ?? "";
    msg.textContent = c.includes("invalid-credential") || c.includes("wrong-password") ? "La clave actual no es correcta." : mensajeError(err);
  }
});

$("#revisar").addEventListener("click", async () => {
  $("#msg-espera").textContent = "Revisando…";
  await arrancar(auth.currentUser);
});

$("#salir").addEventListener("click", async () => {
  await salir();
  location.reload(); // vuelve a la pantalla de entrada con todo limpio
});

// ---------- Arranque ----------
async function arrancar(user) {
  $("#salir").hidden = false;
  if (debeCambiarClave(user.uid)) { mostrarCambioClave(true); return; } // la clave inicial no sirve para usar la app
  try {
    perfil = await asegurarPerfil(db, user);
  } catch {
    $("#msg-acceso").textContent = "No se pudo cargar tu cuenta. Revisa la señal e intenta de nuevo.";
    ir("vista-acceso");
    return;
  }
  $("#salir").hidden = false;
  if (perfil.rol === "pendiente") {
    // Cuenta recién creada: no entra a la app hasta que un administrador la autorice.
    $("#msg-espera").textContent = `${perfil.nombre}: tu cuenta está creada, pero todavía no está autorizada.`;
    ir("vista-espera");
    return;
  }
  try {
    activo = (await leerLocal(claveActivo())) ?? null;
    pendientes = (await leerLocal("pendientes")) ?? [];
  } catch (err) { avisarFalloLocal(err); }
  if (ultimo && ultimo.uid !== perfil.uid) ultimo = null; // "compartir de nuevo" es solo para quien cerró ese turno
  sesionLista();
  $("#salir").hidden = false;
  $("#link-jefes").hidden = !["jefe", "admin"].includes(perfil.rol);

  renderInicio();
  actualizarEstadoFin();
  if (activo) { renderEstado(); ir("vista-estado"); } else { ir("vista-inicio"); }

  sincronizarTurnos();
  sugerirKmInicial();
}

// El km inicial se llena solo con el km de cierre del turno anterior. El chofer lo compara con el odómetro
// y lo corrige si no coincide (en ese caso queda la alerta de km sin registrar).
async function sugerirKmInicial() {
  const km = await ultimoKmCerrado();
  $("#km-anterior").textContent = km == null
    ? "Primer turno: no hay cierre anterior. Escribe el km que marca el odómetro."
    : `Cierre del turno anterior: ${fmtKm(km)} km. Ya viene puesto; corrígelo solo si el odómetro marca otro valor.`;
  const campo = $("#form-inicio").kmInicio;
  if (km != null && !activo && campo.value === "") campo.value = km;
}

const usuarioInicial = await primerEstado();
if (usuarioInicial) {
  await arrancar(usuarioInicial);
} else {
  // Siempre se pide la clave al abrir la app; el nombre queda puesto para no escribirlo cada vez.
  $("#form-acceso").nombre.value = ultimoUsuario();
  ir("vista-acceso");
  if (ultimoUsuario()) $("#form-acceso").clave.focus();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
