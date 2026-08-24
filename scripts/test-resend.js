/**
 * Ad-hoc Resend smoke test.
 *
 * Verifies three things at once:
 *   1. RESEND_API_KEY is valid
 *   2. The sender domain is verified in Resend
 *   3. Delivery actually works to the target inbox
 *
 * Run with env loaded:
 *   node --env-file-if-exists=/vercel/share/.env.project scripts/test-resend.js you@example.com
 */

const to = process.argv.slice(2).filter(Boolean);

if (to.length === 0) {
  console.error('Usage: node scripts/test-resend.js <email> [email2 ...]');
  process.exit(1);
}

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.error('[test-resend] RESEND_API_KEY is not set in the environment.');
  process.exit(1);
}

// Mirrors DEFAULT_FROM_EMAIL / DEFAULT_REPLY_TO in notifications.service.ts
const from = process.env.EMAIL_FROM || 'Thalos <notifications@thalosplatform.xyz>';
const replyTo = process.env.EMAIL_REPLY_TO || 'Thalos <no-reply@thalosplatform.xyz>';

console.log('[test-resend] key prefix :', apiKey.slice(0, 6) + '...');
console.log('[test-resend] from       :', from);
console.log('[test-resend] reply-to   :', replyTo);
console.log('[test-resend] to         :', to.join(', '));

const html = `
  <div style="font-family: system-ui, sans-serif; background:#0C1220; padding:32px; border-radius:12px;">
    <h2 style="color:#FFFFFF; margin:0 0 12px;">Resend is wired up correctly</h2>
    <p style="color:rgba(255,255,255,0.8); margin:0 0 20px;">
      This is a smoke test from the Thalos backend. If you are reading this, the
      API key is valid, the sender domain is verified, and delivery works.
    </p>
    <p style="color:rgba(255,255,255,0.55); margin:0; font-size:13px;">
      Sender: ${from}<br/>
      Sent at: ${new Date().toISOString()}
    </p>
  </div>
`;

async function main() {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: replyTo,
      subject: 'Thalos - Resend smoke test',
      html,
    }),
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(`[test-resend] FAILED (HTTP ${res.status})`);
    console.error('[test-resend] response:', JSON.stringify(body, null, 2));
    process.exit(1);
  }

  console.log('[test-resend] SUCCESS - message id:', body.id);
}

main().catch((err) => {
  console.error('[test-resend] unexpected error:', err.message);
  process.exit(1);
});
