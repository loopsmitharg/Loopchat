/** Plantilla inicial editable para empresas nuevas (context.md §4.2). */
export const DEFAULT_STAGE_TEMPLATE: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "IA atendiendo", kind: "open" },
  { name: "Requiere humano", kind: "open" },
  { name: "Cotizado", kind: "open" },
  { name: "Seguimiento", kind: "open" },
  { name: "Ganado", kind: "won" },
  { name: "Perdido", kind: "lost" },
];
