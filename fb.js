// Inicialización compartida de Firebase (app + App Check opcional).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";

export const fb = initializeApp(firebaseConfig);

// App Check: solo deja pasar solicitudes que vienen de esta app. Se activa al poner la clave en firebase-config.js.
if (appCheckSiteKey) {
  try {
    initializeAppCheck(fb, { provider: new ReCaptchaV3Provider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
  } catch (err) {
    console.warn("App Check no se pudo iniciar:", err);
  }
}
