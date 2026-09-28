import { Resend } from "resend";
import type { OutboundEmail } from "./types.js";

export type ServiceEmailTransport = { send(message: OutboundEmail): Promise<{ id: string }> };

export function createResendTransport(config: { apiKey: string; from: string; replyTo: string }): ServiceEmailTransport {
  const resend = new Resend(config.apiKey);
  return {
    async send(message) {
      const { data, error } = await resend.emails.send({
        from: config.from, to: [message.to], replyTo: config.replyTo,
        subject: message.subject, html: message.html, text: message.text,
      }, { idempotencyKey: message.idempotencyKey });
      if (error || !data?.id) throw new Error(error?.message ?? "Resend returned no message ID");
      return { id: data.id };
    },
  };
}
