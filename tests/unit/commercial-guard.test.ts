import { describe, expect, it } from "vitest";
import { checkCommercialClaims, moneyAmounts, parseAmount, type CommercialFacts } from "@/lib/commercial-guard";

const facts: CommercialFacts = {
  prices: [85000, 42000],
  stocks: [5, null],
  authorizedText: "Envíos a todo el país: llega en 72 horas hábiles. Envío gratis en compras mayores a $100.000. Promo de octubre: 10% de descuento pagando en efectivo.",
};
const ok = (t: string, f = facts) => checkCommercialClaims(t, f).ok;
const kinds = (t: string, f = facts) => checkCommercialClaims(t, f).violations.map((v) => v.kind);

describe("parseo de importes", () => {
  it("formatos argentinos e internacionales", () => {
    expect(parseAmount("85.000")).toBe(85000);
    expect(parseAmount("1.250,50")).toBe(1250.5);
    expect(parseAmount("85,000")).toBe(85000);
    expect(parseAmount("1,5")).toBe(1.5);
    expect(moneyAmounts("cuesta $85.000 o USD 90, y el otro 42 mil pesos")).toEqual([85000, 90, 42000]);
  });
});

describe("validación comercial (regresión S6 / P1-07): falsos negativos", () => {
  it("descuento inventado", () => expect(kinds("¡Te hago un 30% de descuento si comprás hoy!")).toContain("discount"));
  it("descuento sin número que la empresa no ofrece", () => expect(kinds("Te hago un precio especial.", { ...facts, authorizedText: "" })).toContain("discount"));
  it("precio inventado", () => expect(kinds("El taladro sale $79.990.")).toContain("amount"));
  it("te lo dejo en un importe que no existe", () => expect(kinds("Te lo dejo en $70.000 si cerramos ya.")).toContain("amount"));
  it("confirmación de venta", () => expect(kinds("¡Listo, compra cerrada!")).toContain("sale_confirmation"));
  it("reserva confirmada", () => expect(kinds("Tu pedido está confirmado, te lo reservé.")).toContain("sale_confirmation"));
  it("stock inventado", () => expect(kinds("Hay 12 unidades disponibles.")).toContain("stock"));
  it("disponibilidad sin stock informado", () => expect(kinds("Sí, está disponible.", { ...facts, stocks: [null] })).toContain("stock"));
  it("plazo de entrega no informado", () => expect(kinds("Te llega mañana sin problema.")).toContain("delivery"));
});

describe("validación comercial: falsos positivos (respuestas legítimas)", () => {
  it("precio del catálogo y stock real", () => expect(ok("El Taladro percutor 800W cuesta ARS 85.000 y hay 5 disponibles.")).toBe(true));
  it("múltiplo de un precio (2 unidades)", () => expect(ok("Dos taladros son $170.000.")).toBe(true));
  it("promo cargada por la empresa", () => expect(ok("Tenemos 10% de descuento pagando en efectivo.")).toBe(true));
  it("importe de una política (envío gratis)", () => expect(ok("El envío es gratis en compras mayores a $100.000.")).toBe(true));
  it("plazo informado por la empresa", () => expect(ok("Llega en 72 horas hábiles.")).toBe(true));
  it("negar descuentos es correcto", () => expect(ok("No tenemos descuentos en este momento, el precio es $85.000.")).toBe(true));
  it("medidas, modelos y potencias no son importes", () => expect(ok("La amoladora de 115mm y 850W es ideal; el modelo GWS-850 pesa 1,9 kg.")).toBe(true));
  it("cantidades y fechas", () => expect(ok("Para las 3 bolsas que necesitás el 15/11, consultame cualquier duda.")).toBe(true));
  it("porcentajes no comerciales", () => expect(ok("Es 100% de algodón y con garantía de 12 meses.")).toBe(true));
  it("sin stock (negación)", () => expect(ok("No hay stock de ese modelo por ahora.")).toBe(true));
  it("ofrecer reservar (subjuntivo, pregunta) no es confirmar", () => expect(ok("El taladro percutor cuesta $85.000. ¿Querés que te lo reserve?")).toBe(true));
  it("pedir confirmación al cliente no es confirmar la venta", () => expect(ok("¿Querés que te pase con un vendedor para confirmar la compra?")).toBe(true));
});
