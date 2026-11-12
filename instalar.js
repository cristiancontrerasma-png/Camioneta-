// Aviso para instalar la app en el teléfono cuando se está usando desde el navegador.
(() => {
  const instalada = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const caja = document.getElementById("instalar");
  const texto = document.getElementById("instalar-txt");
  const boton = document.getElementById("instalar-btn");
  const cerrar = document.getElementById("instalar-cerrar");
  if (!caja) return;
  let aviso = null; // evento de instalación que entrega Chrome en Android

  const ua = navigator.userAgent;
  const esIOS = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const esAndroid = /android/i.test(ua);

  function mostrar() {
    if (instalada() || sessionStorage.getItem("cam.instalarCerrado")) { caja.hidden = true; return; }
    boton.hidden = !aviso;
    if (aviso) {
      texto.textContent = "Instala la app en este teléfono para abrirla desde la pantalla de inicio, también sin señal.";
    } else if (esIOS) {
      texto.textContent = /crios|fxios|edgios/i.test(ua)
        ? "Para instalar la app: abre este enlace en Safari, toca el botón Compartir (el cuadrado con la flecha hacia arriba) y elige «Agregar a inicio»."
        : "Para instalar la app: toca el botón Compartir (el cuadrado con la flecha hacia arriba), baja en la lista y elige «Agregar a inicio».";
    } else if (esAndroid) {
      texto.textContent = "Para instalar la app: abre el menú del navegador (los tres puntos ⋮, arriba a la derecha) y elige «Instalar app» o «Agregar a la pantalla principal».";
    } else {
      texto.textContent = "Para instalar la app en el teléfono: abre este enlace en el celular y usa «Agregar a la pantalla de inicio» desde el menú del navegador.";
    }
    caja.hidden = false;
  }

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); aviso = e; mostrar(); });
  window.addEventListener("appinstalled", () => { aviso = null; caja.hidden = true; });
  boton.addEventListener("click", async () => {
    if (!aviso) return;
    aviso.prompt();
    await aviso.userChoice.catch(() => {});
    aviso = null;
    mostrar();
  });
  // "Ahora no" lo oculta solo por esta vez: vuelve a aparecer la próxima vez que se abra.
  cerrar.addEventListener("click", () => { sessionStorage.setItem("cam.instalarCerrado", "1"); caja.hidden = true; });
  mostrar();
})();
