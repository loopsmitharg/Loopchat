import "server-only";
import nodemailer from "nodemailer";
import { db } from "../db";
import { devMailOutbox } from "../db/schema";
import { log } from "../log";

export type Mail = { to: string; subject: string; text: string };

/**
 * Envío de emails transaccionales. Con SMTP_URL usa SMTP estándar.
 * Sin SMTP_URL (solo desarrollo/test) guarda el email en `dev_mail_outbox`.
 * En producción sin SMTP lanza error: nunca fingir envío.
 */
export async function sendMail(mail: Mail) {
  const smtp = process.env.SMTP_URL;
  if (smtp) {
    const transport = nodemailer.createTransport(smtp);
    await transport.sendMail({ from: process.env.MAIL_FROM ?? "Loopchat <no-reply@localhost>", to: mail.to, subject: mail.subject, text: mail.text });
    log.info("mail.sent", { to: mail.to.replace(/(.).+@/, "$1***@"), subject: mail.subject });
    return { delivered: true as const };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("SMTP_URL no configurado: no se puede enviar email en producción");
  }
  await db.insert(devMailOutbox).values({ to: mail.to, subject: mail.subject, body: mail.text });
  log.info("mail.dev_outbox", { subject: mail.subject });
  return { delivered: false as const };
}
