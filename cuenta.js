// Cuentas de la app: registro corto con nombre y clave de 6 números (sin correo).
// Por dentro Firebase necesita un correo, así que se arma uno a partir del nombre. No se envía nada a ese correo.
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { fb } from "./fb.js";

export const auth = getAuth(fb);
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
const correoDe = (n) => `${usuarioDe(n)}@${DOMINIO}`;

// Devuelve un texto con lo que falta, o "" si los datos sirven.
export function validar(nombre, clave, crear = false) {
  const u = usuarioDe(nombre);
  if (u.length < 3) return "Escribe tu usuario o tu nombre y apellido.";
  if (crear && !CUENTAS_INICIALES[u] && (u.split(".").length < 2 || u.length < 5)) return "Escribe tu nombre y apellido.";
  if (!/^\d{6}$/.test(clave)) return "La clave debe tener 6 números.";
  return "";
}

export const primerEstado = () => new Promise((res) => { const fin = onAuthStateChanged(auth, (u) => { fin(); res(u); }); });
export const salir = () => signOut(auth);

export async function entrar(nombre, clave) {
  return (await signInWithEmailAndPassword(auth, correoDe(nombre), clave)).user;
}

export async function registrar(db, nombre, clave) {
  const user = (await createUserWithEmailAndPassword(auth, correoDe(nombre), clave)).user;
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
      const usuario = String(user.email).split("@")[0];
      const nombre = local?.nombre ?? CUENTAS_INICIALES[usuario] ?? usuario.split(".").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      const rol = ROLES_INICIALES[usuario] ?? "pendiente";
      await setDoc(ref, { nombre, rol, creadoEn: new Date().toISOString() });
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
export async function cambiarClave(nueva) {
  await updatePassword(auth.currentUser, nueva);
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
