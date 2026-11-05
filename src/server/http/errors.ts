export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const unauthorized = () => new AppError(401, "unauthorized", "Necesitás iniciar sesión.");
export const forbidden = (msg = "No tenés permiso para esta acción.") => new AppError(403, "forbidden", msg);
/** Se usa también para recursos de otra empresa: nunca revelar existencia. */
export const notFound = (msg = "No encontrado.") => new AppError(404, "not_found", msg);
export const badRequest = (msg: string, details?: Record<string, unknown>) =>
  new AppError(400, "bad_request", msg, details);
export const conflict = (msg: string, details?: Record<string, unknown>) => new AppError(409, "conflict", msg, details);
export const quotaExceeded = (msg: string, details?: Record<string, unknown>) =>
  new AppError(402, "quota_exceeded", msg, details);
export const policyBlocked = (msg: string, details?: Record<string, unknown>) =>
  new AppError(422, "policy_blocked", msg, details);
export const tooLarge = (msg = "El contenido supera el tamaño permitido.") => new AppError(413, "payload_too_large", msg);
export const tooMany = () => new AppError(429, "rate_limited", "Demasiados intentos. Probá de nuevo en un minuto.");
export const upstream = (msg: string, details?: Record<string, unknown>) =>
  new AppError(502, "upstream_error", msg, details);
