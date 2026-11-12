// Check list de la camioneta que el chofer responde en cada turno (SI / NO / N.A.).
// Ítems, textos y orden del formulario oficial de OHLA Chile "Lista de Chequeo Camioneta"
// (CO-CL-1CL370-SS-PR-10-Anexo12, Rev. 1). Los grupos solo ordenan la pantalla; no cambian el orden oficial.
export const CHECKLIST_DOC = "Lista de Chequeo Camioneta · CO-CL-1CL370-SS-PR-10-Anexo12, Rev. 1";
export const CHECKLIST_AVISO = "Si algún desperfecto implica poner en riesgo la integridad física del usuario o terceros, el equipo debe ser dejado fuera de operación.";
export const GRUPOS = ["Motor y niveles", "Luces, señales y documentos", "Cabina", "Carrocería y emergencia"];
// id: no debe cambiar una vez en uso · corto: nombre breve para el resumen de WhatsApp y el CSV · texto: pregunta oficial
export const CHECKLIST = [
  { id: "motor", grupo: 0, corto: "Motor", texto: "¿El motor funciona correctamente?" },
  { id: "aceite", grupo: 0, corto: "Nivel de aceite", texto: "¿Nivel de aceite es el adecuado?" },
  { id: "hidraulico", grupo: 0, corto: "Líquido hidráulico", texto: "¿Nivel de líquido hidráulico es el adecuado?" },
  { id: "agua", grupo: 0, corto: "Nivel de agua", texto: "¿El nivel del agua es el adecuado?" },
  { id: "luces", grupo: 1, corto: "Luces", texto: "¿Las luces se encuentran en buen estado de funcionamiento?" },
  { id: "baliza", grupo: 1, corto: "Baliza", texto: "¿La baliza se encuentra en buenas condiciones?" },
  { id: "documentacion", grupo: 1, corto: "Documentación", texto: "¿La documentación del equipo se encuentra vigente (Rev. Téc., Permiso Circ., Seguro, etc.)?" },
  { id: "bocina", grupo: 1, corto: "Bocina", texto: "¿La bocina se encuentra en buenas condiciones?" },
  { id: "espejos", grupo: 2, corto: "Espejos", texto: "¿Los espejos están en buenas condiciones?" },
  { id: "vidrios", grupo: 2, corto: "Vidrios", texto: "¿Los vidrios del equipo se encuentran en buenas condiciones (sin piquetes ni trizaduras)?" },
  { id: "asiento", grupo: 2, corto: "Asiento", texto: "¿El asiento se encuentra en buenas condiciones?" },
  { id: "cinturon", grupo: 2, corto: "Cinturón de seguridad", texto: "¿El cinturón de seguridad se encuentra en buenas condiciones?" },
  { id: "instrumentos", grupo: 2, corto: "Instrumentos", texto: "¿Los instrumentos del equipo funcionan correctamente?" },
  { id: "frenomano", grupo: 2, corto: "Freno de mano", texto: "¿El freno de mano o bloqueo funciona adecuadamente?" },
  { id: "antivuelco", grupo: 3, corto: "Barra antivuelco", texto: "¿El estado de la barra antivuelco se encuentra en buenas condiciones?" },
  { id: "portalon", grupo: 3, corto: "Portalón", texto: "¿El portalón se encuentra en buenas condiciones y evita la caída del material?" },
  { id: "extintor", grupo: 3, corto: "Extintor", texto: "¿El equipo cuenta con extintor en buenas condiciones y fecha vigente de mantención?" },
  { id: "repuesto", grupo: 3, corto: "Neumático de repuesto", texto: "¿El equipo cuenta con neumático de repuesto?" },
  { id: "botiquin", grupo: 3, corto: "Botiquín y triángulos", texto: "¿El equipo cuenta con botiquín y triángulos de emergencia?" },
  { id: "alarma", grupo: 3, corto: "Alarma de retroceso", texto: "¿El equipo cuenta con alarma de retroceso?" },
  { id: "mantencion", grupo: 3, corto: "Mantención al día", texto: "¿El equipo cuenta con mantención al día?" },
];
export const RESPUESTAS = { si: "SI", no: "NO", na: "N.A." };

// Cuenta las respuestas de un check list (o de un grupo): { si, no, na, falta }.
export function contarChecklist(c, grupo = null) {
  const r = { si: 0, no: 0, na: 0, falta: 0 };
  for (const it of CHECKLIST) {
    if (grupo !== null && it.grupo !== grupo) continue;
    if (RESPUESTAS[c?.[it.id]]) r[c[it.id]]++; else r.falta++;
  }
  return r;
}
export const itemsConNo = (c) => CHECKLIST.filter((it) => c?.[it.id] === "no").map((it) => it.corto);
