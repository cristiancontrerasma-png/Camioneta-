// Cuentas de la app: registro corto con nombre y clave de 6 números (sin correo).
// Por dentro Firebase necesita un correo, así que se arma uno a partir del nombre. No se envía nada a ese correo.
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, signOut, onAuthStateChanged,
  reauthenticateWithCredential, EmailAuthProvider, setPersistence, browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { fb } from "./fb.js";

export const auth = getAuth(fb);
// La sesión dura solo mientras la app está abierta: al cerrarla y volver a entrar, pide usuario y clave de nuevo.
const sesionCorta = setPersistence(auth, browserSessionPersistence).catch(() => {});
const KEY_ULTIMO_USUARIO = "cam.ultimoUsuario";
// Último nombre con que se entró en este teléfono, para no tener que escribirlo cada vez (la clave sí se pide siempre).
export const ultimoUsuario = () => localStorage.getItem(KEY_ULTIMO_USUARIO) ?? "";
const DOMINIO = "camioneta.example.com";
const KEY_PERFIL = "cam.perfil";
const KEY_CAMBIAR = "cam.debeCambiarClave";

// Cuentas con usuario fijo (administradores y jefes). El resto se registra con su nombre y apellido.
export const CUENTAS_INICIALES = {
  navaria1: "Ian Navarro",
  contrcr3: "Cristian Contreras",
  cerdaju2: "Julio Cerda",
  moyara2: "Raúl Moya",
};
// Cuentas que nacen con un rol sin pasar por la espera. Las reglas de Firestore solo lo aceptan para esos usuarios.
// Ian Navarro (Navaria1) queda como administrador apenas crea su cuenta, con acceso a todos los datos.
export const ROLES_INICIALES = { navaria1: "admin" };
// Clave de partida de esas cuentas. Quien entra con ella debe cambiarla antes de usar la app.
export const CLAVE_INICIAL = "123456";

export const limpiarNombre = (n) => String(n ?? "").trim().replace(/\s+/g, " ");
// "José  Pérez" y "jose perez" son la misma cuenta.
export const usuarioDe = (n) => limpiarNombre(n).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
// Correo interno de una cuenta. Cuando un administrador reinicia la clave de alguien, se crea una cuenta
// nueva para esa persona con el sufijo "-rN"; el número vigente está en reinicios/{usuario}.
export const correoVersion = (usuario, n) => `${usuario}${n ? `-r${n}` : ""}@${DOMINIO}`;
export const usuarioDeCorreo = (correo) => String(correo).split("@")[0].replace(/-r\d+$/, "");
export async function versionVigente(db, usuario) {
  try {
    const snap = await getDoc(doc(db, "reinicios", usuario));
    return snap.exists() ? Number(snap.data().n) || 0 : 0;
  } catch {
    return 0; // sin señal o sin permiso: se usa la cuenta original
  }
}
const correoDe = async (db, nombre) => correoVersion(usuarioDe(nombre), await versionVigente(db, usuarioDe(nombre)));

// Devuelve un texto con lo que falta, o "" si los datos sirven.
export function validar(nombre, clave, crear = false) {
  const u = usuarioDe(nombre);
  if (u.length < 3) return "Escribe tu usuario o tu nombre y apellido.";
  if (crear && !CUENTAS_INICIALES[u] && (u.split(".").length < 2 || u.length < 5)) return "Escribe tu nombre y apellido.";
  if (!/^\d{6}$/.test(clave)) return "La clave debe tener 6 números.";
  return "";
}

export const primerEstado = async () => {
  await sesionCorta;
  return new Promise((res) => { const fin = onAuthStateChanged(auth, (u) => { fin(); res(u); }); });
};
export const salir = () => signOut(auth);

export async function entrar(db, nombre, clave) {
  await sesionCorta;
  const user = (await signInWithEmailAndPassword(auth, await correoDe(db, nombre), clave)).user;
  localStorage.setItem(KEY_ULTIMO_USUARIO, limpiarNombre(nombre));
  return user;
}

export async function registrar(db, nombre, clave) {
  await sesionCorta;
  const user = (await createUserWithEmailAndPassword(auth, await correoDe(db, nombre), clave)).user;
  localStorage.setItem(KEY_ULTIMO_USUARIO, limpiarNombre(nombre));
  // Se recuerda el nombre por si el perfil no alcanza a guardarse (sin señal): se completa al volver a abrir.
  const visible = CUENTAS_INICIALES[usuarioDe(nombre)] ?? limpiarNombre(nombre);
  localStorage.setItem(KEY_PERFIL, JSON.stringify({ uid: user.uid, nombre: visible, rol: ROLES_INICIALES[usuarioDe(nombre)] ?? "pendiente" }));
  await asegurarPerfil(db, user);
  return user;
}

// Perfil del usuario: { uid, nombre, rol }, con rol "pendiente", "chofer", "jefe" o "admin".
// Toda cuenta nueva nace "pendiente": no puede usar la app hasta que un administrador la autorice.
// Lo lee de la nube; si no hay señal usa el guardado en el teléfono; si no existe, lo crea como pendiente.
export async function asegurarPerfil(db, user) {
  const guardado = JSON.parse(localStorage.getItem(KEY_PERFIL) ?? "null");
  const local = guardado?.uid === user.uid ? guardado : null;
  const ref = doc(db, "usuarios", user.uid);
  try {
    const snap = await getDoc(ref);
    let perfil;
    if (snap.exists()) {
      perfil = { uid: user.uid, nombre: snap.data().nombre, rol: snap.data().rol };
    } else {
      const usuario = usuarioDeCorreo(user.email);
      const nombre = local?.nombre ?? CUENTAS_INICIALES[usuario] ?? usuario.split(".").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      const rol = ROLES_INICIALES[usuario] ?? "pendiente";
      await setDoc(ref, { nombre, usuario, rol, creadoEn: new Date().toISOString() });
      perfil = { uid: user.uid, nombre, rol };
    }
    localStorage.setItem(KEY_PERFIL, JSON.stringify(perfil));
    return perfil;
  } catch (err) {
    if (local) return local;
    throw err;
  }
}

// Clave inicial: se marca la cuenta para que cambie la clave, aunque cierre y vuelva a abrir la app.
export const marcarCambioClave = (uid) => localStorage.setItem(KEY_CAMBIAR, uid);
export const debeCambiarClave = (uid) => localStorage.getItem(KEY_CAMBIAR) === uid;
export function validarClaveNueva(nueva, repetida) {
  if (!/^\d{6}$/.test(nueva)) return "La clave nueva debe tener 6 números.";
  if (nueva === CLAVE_INICIAL || /^(\d)\1{5}$/.test(nueva)) return "Elige una clave distinta de 123456 y que no sea un solo número repetido.";
  if (nueva !== repetida) return "Las dos claves no coinciden.";
  return "";
}
// Cambia la clave de quien está dentro. Pide la clave actual para confirmar que es la misma persona.
export async function cambiarClave(actual, nueva) {
  const u = auth.currentUser;
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, actual));
  await updatePassword(u, nueva);
  localStorage.removeItem(KEY_CAMBIAR);
}

export function mensajeError(err) {
  const c = err?.code ?? "";
  if (c.includes("requires-recent-login")) return "Por seguridad, sal y vuelve a entrar antes de cambiar la clave.";
  if (c.includes("email-already-in-use")) return "Ya existe una cuenta con ese nombre. Si es tuya, toca «Entrar». Si es de otra persona, agrega tu segundo apellido.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Nombre o clave incorrectos. Si aún no tienes cuenta, toca «Crear cuenta».";
  if (c.includes("too-many-requests")) return "Demasiados intentos. Espera unos minutos.";
  if (c.includes("network")) return "Sin señal. La primera vez se necesita conexión para entrar.";
  return "No se pudo entrar. Intenta de nuevo.";
}
