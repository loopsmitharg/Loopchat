/**
 * Catálogo de opciones visuales y su traducción a instrucciones. Cada selector de la interfaz
 * tiene un texto que llega realmente al modelo (lo que se ve en "Ver instrucciones efectivas").
 */
import type { AddressValue, AttitudeValue, EmojiValue, FormalityValue, InitiativeValue, LengthValue, SalesIntensityValue, StyleValue } from "./types";

export const ATTITUDE_LABELS: Record<AttitudeValue, string> = { serious: "Serio", friendly: "Amable", enthusiastic: "Entusiasta", calm: "Tranquilo", empathetic: "Empático", persuasive: "Persuasivo", technical: "Técnico" };
export const ATTITUDE_TEXT: Record<AttitudeValue, string> = {
  serious: "serio y sobrio",
  friendly: "amable y cordial",
  enthusiastic: "entusiasta (con energía positiva, sin exagerar)",
  calm: "tranquilo y paciente",
  empathetic: "empático: reconocé cómo se siente el cliente antes de resolver",
  persuasive: "persuasivo sin presionar: destacá beneficios reales",
  technical: "técnico y preciso",
};
/** Pares que se contradicen: se conserva el primero elegido y se explica. */
export const INCOMPATIBLE_ATTITUDES: [AttitudeValue, AttitudeValue][] = [
  ["serious", "enthusiastic"],
  ["calm", "enthusiastic"],
];

export const FORMALITY_TEXT: Record<FormalityValue, string> = {
  very_formal: "Muy formal: lenguaje cuidado, sin coloquialismos.",
  formal: "Formal y respetuoso.",
  professional_warm: "Profesional y cercano.",
  informal: "Informal y amistoso.",
  very_informal: "Muy informal y relajado, como entre conocidos (sin groserías).",
};
export const ADDRESS_TEXT: Record<AddressValue, string> = { vos: "Tratá al cliente de vos (español rioplatense).", tu: "Tratá al cliente de tú.", usted: "Tratá al cliente de usted." };
export const LENGTH_TEXT: Record<LengthValue, string> = {
  very_short: "Respuestas muy breves: una o dos oraciones.",
  short: "Respuestas breves: máximo 3 oraciones.",
  medium: "Respuestas de hasta 5 oraciones.",
  long: "Respuestas completas cuando haga falta (hasta 8 oraciones), sin relleno.",
};
export const EMOJI_TEXT: Record<EmojiValue, string> = {
  none: "No uses emojis.",
  few: "Como mucho un emoji ocasional.",
  moderate: "Podés usar algunos emojis (uno o dos por mensaje).",
  free: "Podés usar emojis con naturalidad.",
};
export const INITIATIVE_LABELS: Record<InitiativeValue, string> = { reactive: "Reactivo", consultive: "Consultivo", proactive: "Proactivo" };
export const INITIATIVE_TEXT: Record<InitiativeValue, string> = {
  reactive: "Respondé lo que el cliente pregunta, sin proponer temas nuevos.",
  consultive: "Hacé preguntas útiles para entender mejor lo que necesita (de a una).",
  proactive: "Cuando corresponda, proponé el siguiente paso concreto (sin presionar).",
};
export const SALES_LABELS: Record<SalesIntensityValue, string> = { none: "Sin intención comercial", consultive: "Consultiva", moderate: "Comercial moderada", sales: "Orientada a ventas", intensive: "Comercial intensiva" };
export const SALES_TEXT: Record<SalesIntensityValue, string> = {
  none: "No ofrezcas productos ni intentes vender.",
  consultive: "Ofrecé productos solo si el cliente muestra interés o lo pide.",
  moderate: "Si viene al caso, mencioná productos o servicios relacionados que puedan servirle.",
  sales: "Buscá activamente entender la necesidad y avanzar hacia una compra, con recomendaciones concretas.",
  intensive: "Orientate a cerrar la venta: recomendá con claridad y proponé avanzar, siempre dentro de los límites de la empresa y respetando si el cliente no quiere.",
};
export const STYLE_LABELS: Record<StyleValue, string> = { direct: "Directo", conversational: "Conversacional", explanatory: "Explicativo", technical: "Técnico", persuasive: "Persuasivo", empathetic: "Empático" };
export const STYLE_TEXT: Record<StyleValue, string> = {
  direct: "Estilo directo: andá al punto.",
  conversational: "Estilo conversacional y natural.",
  explanatory: "Estilo explicativo: aclará el porqué cuando ayude.",
  technical: "Estilo técnico: usá términos precisos y pasos concretos.",
  persuasive: "Estilo persuasivo: destacá beneficios reales y verificables.",
  empathetic: "Estilo empático: validá la situación del cliente.",
};

/** Objetivos por rol (¿Qué tiene que lograr este chatbot?). */
export type GoalDef = { key: string; label: string; text: string };
export const BOT_GOALS: Record<string, GoalDef[]> = {
  receptionist: [
    { key: "identify_need", label: "Identificar la necesidad del cliente", text: "identificar qué necesita el cliente" },
    { key: "classify_intent", label: "Clasificar su intención", text: "clasificar su intención (compra, reclamo, soporte, turno, seguimiento)" },
    { key: "route_specialist", label: "Derivar al especialista adecuado", text: "que lo atienda el área correcta (la derivación la hace el sistema)" },
    { key: "basic_info", label: "Obtener información básica cuando sea necesaria", text: "obtener solo la información básica necesaria" },
    { key: "no_repeat", label: "Evitar preguntas repetidas", text: "no repetir preguntas ya respondidas" },
  ],
  sales: [
    { key: "understand_need", label: "Comprender qué busca el cliente", text: "comprender qué busca el cliente" },
    { key: "recommend_real", label: "Recomendar productos reales", text: "recomendar solo productos reales del catálogo" },
    { key: "answer_commercial", label: "Responder consultas comerciales", text: "responder consultas comerciales con datos verificados" },
    { key: "qualify", label: "Calificar interesados", text: "calificar al interesado (qué necesita, cuánto, para cuándo)" },
    { key: "create_opportunity", label: "Crear o actualizar oportunidades", text: "registrar la oportunidad cuando hay interés real" },
    { key: "advance_pipeline", label: "Avanzar oportunidades por el pipeline", text: "avanzar la oportunidad a la etapa que corresponda" },
    { key: "handoff_seller", label: "Derivar a un vendedor ante oportunidades relevantes", text: "pasar a un vendedor cuando el cliente está listo para comprar" },
  ],
  customer_service: [
    { key: "resolve", label: "Resolver consultas", text: "resolver la consulta del cliente" },
    { key: "register_claim", label: "Registrar reclamos", text: "registrar el reclamo con sus datos" },
    { key: "check_history", label: "Consultar antecedentes", text: "tener en cuenta los antecedentes del cliente" },
    { key: "identify_problem", label: "Identificar problemas", text: "identificar con precisión el problema" },
    { key: "create_case", label: "Crear tareas o casos cuando corresponda", text: "dejar una tarea o caso para el equipo cuando haga falta" },
    { key: "escalate", label: "Derivar situaciones complejas", text: "derivar a una persona las situaciones complejas" },
  ],
  support: [
    { key: "diagnose", label: "Diagnosticar el problema", text: "entender y diagnosticar el problema técnico" },
    { key: "guide_steps", label: "Guiar con pasos concretos", text: "guiar al cliente con pasos concretos, de a uno" },
    { key: "register_case", label: "Registrar el caso", text: "registrar el caso cuando no se resuelve" },
    { key: "escalate_tech", label: "Derivar lo que no se puede resolver", text: "derivar a un técnico lo que no se puede resolver por chat" },
  ],
  followup: [
    { key: "check_pending", label: "Consultar oportunidades pendientes", text: "tener presentes las oportunidades pendientes del cliente" },
    { key: "next_step", label: "Identificar el siguiente paso", text: "acordar el siguiente paso" },
    { key: "allowed_followups", label: "Realizar seguimientos permitidos por Meta", text: "hacer seguimientos solo dentro de la ventana de conversación permitida" },
    { key: "register_answers", label: "Registrar respuestas", text: "registrar las respuestas del cliente" },
    { key: "update_status", label: "Actualizar el estado comercial", text: "actualizar el estado comercial" },
    { key: "stop_if_unwanted", label: "Suspender seguimientos si el cliente no los quiere", text: "dejar de hacer seguimiento si el cliente no lo desea" },
  ],
  aftersales: [
    { key: "post_purchase", label: "Acompañar después de la compra", text: "acompañar al cliente después de la compra" },
    { key: "satisfaction", label: "Verificar satisfacción", text: "verificar que quedó conforme" },
    { key: "warranty", label: "Orientar sobre garantía y cambios", text: "orientar sobre garantía, cambios y devoluciones según las políticas" },
    { key: "escalate", label: "Derivar problemas", text: "derivar a una persona cuando haya un problema" },
  ],
  custom: [],
};
export function goalCatalog(role: string): GoalDef[] {
  return BOT_GOALS[role] ?? [];
}
export function allGoals(): GoalDef[] {
  const seen = new Map<string, GoalDef>();
  for (const list of Object.values(BOT_GOALS)) for (const g of list) if (!seen.has(g.key)) seen.set(g.key, g);
  return [...seen.values()];
}

export const AI_HANDOFF_TEXT: Record<string, { label: string; text: string }> = {
  complex_complaint: { label: "Reclamo complejo", text: "el reclamo es complejo o el cliente está muy disconforme" },
  out_of_scope: { label: "Consulta fuera de su especialidad", text: "la consulta está fuera de tu especialidad" },
  needs_authorization: { label: "Requiere autorización humana", text: "el cliente pide algo que requiere autorización de una persona (excepciones, devoluciones especiales, descuentos)" },
};

export const METRIC_LABELS: Record<string, string> = {
  handled: "Consultas atendidas",
  resolved: "Consultas resueltas",
  opportunities: "Oportunidades generadas",
  qualified: "Oportunidades calificadas",
  transfers: "Transferencias realizadas",
  handoffs: "Derivadas a personas",
  resolution_time: "Tiempo de resolución",
  verified_actions: "Acciones comerciales verificadas",
  ai_usage: "Consumo de IA",
};
