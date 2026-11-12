# Camioneta de Servicios Túnel · OHLA Chile: registro de turnos

App web (PWA) para registrar cada turno de la camioneta: odómetro inicial y final con foto, cuatro panorámicas, revisión rápida, carga de combustible, salidas de faena con autorización y novedades. Al cerrar, el chofer comparte al grupo de WhatsApp un resumen con el enlace del turno, donde se ven los datos y las fotos.

## Archivos
- `index.html`, `app.js`, `exif.js`, `checklist.js`, `cuenta.js`, `styles.css`: la app del chofer.
- `turno.html`: página pública de un turno (la que abre el enlace de WhatsApp).
- `admin.html`: página con ingreso por correo y contraseña. Los jefes (Raúl Moya, Julio Cerda) ven los turnos de todos, con filtros, estadísticas, gráficos y CSV. Los administradores (Ian Navarro, Cristian Contreras) además corrigen y borran.
- `fb.js`, `firebase-config.js`: conexión con Firebase.
- `firestore.rules`: reglas de seguridad.
- `sw.js`, `manifest.json`, íconos: instalación y uso sin señal.

## Logo y colores
- `logo.png` es el logo de OHLA Chile entregado por Cristian Contreras (recorte de una captura). Si la empresa entrega el archivo oficial en mejor calidad, reemplázalo con el mismo nombre.
- El azul corporativo (#133484) se midió desde ese logo. Está en la primera línea de `styles.css` (`--azul`); si el manual de marca indica otro código, cámbialo ahí.

## Cuentas y roles
- Cada persona crea su cuenta en la app con nombre y apellido y una clave de 6 números. No se pide correo.
- **Usuarios fijos** (administradores y jefes): `Navaria1` Ian Navarro, `Contrcr3` Cristian Contreras, `Cerdaju2` Julio Cerda, `Moyara2` Raúl Moya. Cada uno crea su cuenta escribiendo ese usuario con la clave inicial `123456`; la app lo obliga a cambiarla por una propia antes de continuar. Están definidos en `cuenta.js` (`CUENTAS_INICIALES`).
- Los choferes crean su cuenta con su nombre y apellido y la clave que elijan.
- **Excepción:** el usuario `Navaria1` (Ian Navarro) queda como administrador apenas crea su cuenta, sin espera. Ojo: quien registre ese usuario primero recibe ese rol, así que debe crearse cuanto antes.
- Toda cuenta nueva queda **pendiente**: no puede usar la app hasta que un administrador (Ian Navarro o Cristian Contreras) la autorice.
- **Chofer**: registra turnos y ve solo los suyos.
- Un administrador autoriza y asigna los roles en la página Jefes → «Usuarios y roles»: **chofer**, **jefe** (ve todo) o **administrador** (además corrige, borra y asigna roles).
- **Primer administrador:** regístrate en la app y luego, en la consola de Firebase → Firestore → `usuarios` → tu documento, cambia `rol` a `admin`. Desde ahí asignas a los demás.
- **Cambiar la clave:** cada persona puede cambiarla desde Inicio → «Cambiar mi clave», escribiendo la clave actual.
- **Clave olvidada:** un administrador abre Jefes → «Usuarios y roles» y toca «Reiniciar» junto a la persona. La clave vuelve a ser `123456` y la app le pide cambiarla al entrar. Por dentro se le crea una cuenta nueva con el mismo rol; sus turnos anteriores siguen visibles para jefes y administradores, pero ya no en su «Mis turnos».
- **Crear cuentas para otros:** en el mismo lugar, un administrador puede crear la cuenta de alguien con su rol y la clave inicial `123456`.

## Configurar Firebase (una sola vez)
1. Crea un proyecto en https://console.firebase.google.com.
2. **Authentication → Método de acceso:** activa solo **Correo electrónico/contraseña** (no actives Anónimo).
3. **Firestore Database:** créala en modo producción, región `southamerica-east1`.
4. No se usa Storage ni tarjeta: las fotos se guardan dentro de Firestore, en el plan gratuito (Spark).
5. **Configuración del proyecto → Tus apps → Web:** copia el objeto `firebaseConfig` en `firebase-config.js`.
6. **App Check (recomendado):** registra la app web con reCAPTCHA v3, pega la clave de sitio en `appCheckSiteKey` de `firebase-config.js` y, cuando la app ya esté funcionando, activa la exigencia ("Aplicar") para Firestore. Con esto solo la app publicada puede escribir.

## Publicarla
```bash
npm i -g firebase-tools
firebase login
firebase init hosting firestore   # carpeta pública: esta misma; sin reescritura SPA; usa los archivos de reglas existentes
firebase deploy
```

## Uso en el celular
- Abre la dirección en Safari (iPhone) o Chrome (Android). Si la app no está instalada, aparece un aviso con los pasos para instalarla (en Android, con un botón «Instalar app»). El aviso desaparece una vez instalada.
- La primera apertura necesita señal. Después la app abre sin señal y sube los turnos pendientes cuando la recupera.
- Las fotos se pueden tomar con la cámara o elegir de la galería.

## Reglas de la app
- **Hora de inicio y término:** es la hora de captura de la foto del odómetro (dato EXIF). Si la foto no trae ese dato, se usa la fecha del archivo y el resumen dice "hora no verificada".
- **Foto inicial:** no puede tener más de 15 minutos. **Foto final:** no más de 5 minutos al cerrar.
- **Km:** alerta si el km inicial no coincide con el cierre anterior. Si el recorrido supera 500 km, pide confirmar.
- **Quién ve qué:** cada chofer ve solo sus propios turnos ("Mis turnos", los cerrados desde su celular). Los jefes y los administradores ven los de todos. Del turno anterior, un chofer solo recibe el km de cierre.
- **Cierre completo:** el turno no se cierra ni se genera el enlace si falta algo (fotos, km final, litros y foto del medidor si hubo carga, check list incompleto, o con algún NO sin observación). La app lista todo lo que falta.
- **Check list de la camioneta:** obligatorio en cada turno. Cada ítem se responde SI, NO o N.A.; si hay algún NO, las observaciones son obligatorias. Son los 21 ítems del formulario oficial «Lista de Chequeo Camioneta» (CO-CL-1CL370-SS-PR-10-Anexo12, Rev. 1), en el mismo orden, agrupados en cuatro bloques desplegables. No hay botón para marcar todo: cada ítem se responde uno por uno. Están en `checklist.js`.
- **Limpieza:** se hace 1 o 2 veces por semana, así que no es requisito para cerrar. El chofer la marca solo el turno en que la hace; jefes y administradores ven cuántas hubo y la fecha de la última.
- **Salidas de faena:** en cualquier momento del turno, con autorizador y motivo.
- Estos valores están al inicio de `app.js`. Los turnos (A–D) están en `app.js` (`TURNOS`) y los autorizadores, en `index.html`.

## Espacio gratuito
- El plan gratuito de Firestore permite 1 GiB. Cada turno ocupa cerca de 1 MB (fotos de 800 px), así que a 4 turnos diarios alcanza para unos 6 meses.
- La página de administradores muestra el uso estimado y tiene el botón "Borrar turnos antiguos y sus fotos". Antes de borrar, exporta el CSV.
- El km del cierre más reciente nunca se borra.

## Límites conocidos
- La hora de la foto depende del reloj del celular; alguien que lo cambie a propósito puede burlar el control.
- Cualquiera con la dirección puede crear una cuenta, pero queda pendiente y sin acceso hasta que un administrador la autorice.
- El turno en curso y los pendientes viven en el celular. Si se borran los datos del sitio antes de subir, se pierden.
