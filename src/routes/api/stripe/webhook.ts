import { createFileRoute } from "@tanstack/react-router";
import { verifyStripeWebhook } from "@/lib/server/stripe-webhook.server";
import { processDepositPayment } from "@/lib/server/deposit-payment-processor.server";

/**
 * POST /api/stripe/webhook — Stripe webhook receiver.
 *
 * Verifies the Stripe-Signature header against the exact raw request body
 * using the official Stripe SDK. The verified Stripe signature authenticates
 * this request — no browser login or Supabase session is required.
 *
 * For recognized events (checkout.session.completed,
 * checkout.session.async_payment_succeeded), the deposit payment processor
 * retrieves the Checkout Session and PaymentIntent from Stripe, validates all
 * identities and financial terms, and calls the atomic deposit recording RPC.
 * The RPC alone changes balances, reservation status, and capacity.
 */

/**
 * Exported for direct testing. The route handler delegates here so tests can
 * exercise the real handler without depending on the TanStack Vite server-route
 * transform.
 */
export async function handleStripeWebhookPost(request: Request): Promise<Response> {
  // Read the exact raw body — do not parse and re-serialize JSON before
  // signature verification.
  const rawPayload = await request.text();
  const signature = request.headers.get("Stripe-Signature");

  const result = await verifyStripeWebhook(rawPayload, signature);

  if (!result.ok) {
    // Fail closed: invalid signature, unconfigured, live-mode, or
    // malformed payloads all reject the webhook.
    if (result.reason === "unconfigured") {
      return new Response("Webhook processing temporarily unavailable.", {
        status: 503,
      });
    }
    return new Response("Invalid webhook.", { status: 400 });
  }

  if (result.kind === "ignored") {
    // Correctly signed but unsupported event — acknowledge.
    return Response.json({ received: true, ignored: true });
  }

  // Recognized event — process the deposit payment.
  const processingResult = await processDepositPayment(result.event);

  if (!processingResult.ok) {
    // Stripe/network/database failure, failed RPC, identity mismatch, or
    // malformed result — never acknowledge unrecorded payment as processed.
    return new Response("Payment processing failed.", { status: 503 });
  }

  if (processingResult.kind === "unpaid_ignored") {
    // A completed-but-unpaid Session: no payment RPC or confirmation.
    // Acknowledge and await a paid event.
    return Response.json({ received: true, unpaid: true });
  }

  if (processingResult.outcome === "review_required") {
    // Structured diagnostic warning — no payloads, customer details, secrets,
    // signatures, or Checkout URLs. This is not a staff notification system.
    console.warn("stripe.deposit.review_required", {
      eventId: processingResult.eventId,
      receiptId: processingResult.paymentId,
      reason: processingResult.reviewReason,
    });
    // Payment was durably recorded but requires staff review.
    // Do not claim reservation confirmation.
    return Response.json({
      received: true,
      review_required: true,
      receipt_id: processingResult.paymentId,
      event_id: processingResult.eventId,
      reason: processingResult.reviewReason,
    });
  }

  // Applied or already_processed — payment was durably recorded.
  return Response.json({ received: true, processed: true });
}

export const Route = createFileRoute("/api/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => handleStripeWebhookPost(request),
    },
  },
});
