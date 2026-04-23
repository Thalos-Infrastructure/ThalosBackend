/**
 * Base email template with consistent styling for all Thalos notifications
 */
export function baseTemplate(content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thalos Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f7;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="width: 100%; max-width: 600px; border-collapse: collapse;">
          <!-- Header -->
          <tr>
            <td style="padding: 24px 32px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px 12px 0 0;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td>
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: white; letter-spacing: -0.5px;">
                      Thalos
                    </h1>
                    <p style="margin: 4px 0 0; font-size: 14px; color: rgba(255,255,255,0.8);">
                      Trustless Agreements on Solana
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 32px; background: white; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
              ${content}
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; text-align: center;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #6b6b80;">
                This is an automated notification from Thalos Platform.
              </p>
              <p style="margin: 0 0 16px; font-size: 12px; color: #9ca3af;">
                You received this email because you are a participant in an agreement on Thalos.
              </p>
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <a href="https://thalosplatform.xyz" style="color: #6366f1; text-decoration: none; font-size: 12px; margin: 0 8px;">Website</a>
                    <span style="color: #d1d5db;">|</span>
                    <a href="https://thalosplatform.xyz/dashboard" style="color: #6366f1; text-decoration: none; font-size: 12px; margin: 0 8px;">Dashboard</a>
                    <span style="color: #d1d5db;">|</span>
                    <a href="https://thalosplatform.xyz/settings" style="color: #6366f1; text-decoration: none; font-size: 12px; margin: 0 8px;">Settings</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 16px 0 0; font-size: 11px; color: #9ca3af;">
                &copy; ${new Date().getFullYear()} Thalos. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Format a wallet address for display (truncated)
 */
export function formatWallet(wallet: string): string {
  if (!wallet || wallet.length < 10) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

/**
 * Format an amount with asset symbol
 */
export function formatAmount(amount: string, asset: string): string {
  const numAmount = parseFloat(amount);
  const formatted = numAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
  return `${formatted} ${asset}`;
}
