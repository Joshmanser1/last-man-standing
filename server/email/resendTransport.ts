import type { OutboundEmail } from "./types.js";
import { ResendDeliveryError } from "./retryPolicy.js";

export type ServiceEmailTransport = { send(message: OutboundEmail): Promise<{ id: string }> };

export function createResendTransport(config: { apiKey: string; from: string; replyTo: string }): ServiceEmailTransport {
  return {
    async send(message) {
      let response: Response;
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
          body: JSON.stringify({
            from: config.from, to: [message.to], reply_to: config.replyTo,
            subject: message.subject, html: message.html, text: message.text,
          }),
        });
      } catch (error) {
        throw new ResendDeliveryError(error instanceof Error ? error.message : "Resend request failed", null, "application_error");
      }
      let data: { id?: string; name?: string; message?: string } | null = null;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok || !data?.id) throw new ResendDeliveryError(data?.message ?? "Resend returned no message ID",
        response.status, data?.name ?? "application_error", response.headers.get("retry-after"));
      return { id: data.id };
    },
  };
}
