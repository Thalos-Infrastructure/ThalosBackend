import {
  AgreementCreatedData,
  AgreementFundedData,
  EvidenceSubmittedData,
  MilestoneApprovedData,
  DisputeOpenedData,
  DisputeResolvedData,
  AgreementCompletedData,
} from "../types/notification-data.types";
import { baseTemplate, formatWallet, formatAmount } from "./base.template";

export function agreementCreatedTemplate(data: AgreementCreatedData): string {
  const content = `
    <h2 style="color: #1a1a2e; margin: 0 0 16px;">New Agreement Created</h2>
    <p style="color: #4a4a68; margin: 0 0 24px;">
      A new agreement has been created and you have been added as a participant.
    </p>
    
    <div style="background: #f8f9fc; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
      <h3 style="color: #1a1a2e; margin: 0 0 12px; font-size: 18px;">${data.title}</h3>
      ${data.description ? `<p style="color: #6b6b80; margin: 0 0 16px;">${data.description}</p>` : ""}
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b6b80; width: 120px;">Amount:</td>
          <td style="padding: 8px 0; color: #1a1a2e; font-weight: 600;">${formatAmount(data.amount, data.asset)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Created by:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">${data.createdByName || formatWallet(data.createdByWallet)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Participants:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">${data.participantWallets.length} participant(s)</td>
        </tr>
      </table>
    </div>
    
    <p style="color: #4a4a68; margin: 0 0 24px;">
      The agreement is now pending funding. Once funded, work can begin on the agreed terms.
    </p>
    
    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}" 
       style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; 
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}

export function agreementFundedTemplate(data: AgreementFundedData): string {
  const content = `
    <h2 style="color: #1a1a2e; margin: 0 0 16px;">Agreement Funded</h2>
    <p style="color: #4a4a68; margin: 0 0 24px;">
      Great news! The agreement has been funded and is now active.
    </p>
    
    <div style="background: #f0fdf4; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #22c55e;">
      <h3 style="color: #1a1a2e; margin: 0 0 12px; font-size: 18px;">${data.title}</h3>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b6b80; width: 120px;">Amount:</td>
          <td style="padding: 8px 0; color: #16a34a; font-weight: 600;">${formatAmount(data.amount, data.asset)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Funded by:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">${data.fundedByName || formatWallet(data.fundedByWallet)}</td>
        </tr>
        ${data.transactionSignature ? `
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Transaction:</td>
          <td style="padding: 8px 0;">
            <a href="https://solscan.io/tx/${data.transactionSignature}" 
               style="color: #6366f1; text-decoration: none;">
              View on Solscan
            </a>
          </td>
        </tr>
        ` : ""}
      </table>
    </div>
    
    <p style="color: #4a4a68; margin: 0 0 24px;">
      Work can now begin. Funds are held securely in the smart contract escrow until milestones are approved.
    </p>
    
    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}" 
       style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; 
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}

export function evidenceSubmittedTemplate(data: EvidenceSubmittedData): string {
  const content = `
    <h2 style="color: #1a1a2e; margin: 0 0 16px;">Evidence Submitted</h2>
    <p style="color: #4a4a68; margin: 0 0 24px;">
      New evidence has been submitted for milestone review.
    </p>
    
    <div style="background: #fef3c7; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #f59e0b;">
      <h3 style="color: #1a1a2e; margin: 0 0 12px; font-size: 18px;">${data.agreementTitle}</h3>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b6b80; width: 120px;">Milestone:</td>
          <td style="padding: 8px 0; color: #1a1a2e; font-weight: 600;">#${data.milestoneIndex + 1} - ${data.milestoneDescription}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Submitted by:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">${data.submittedByName || formatWallet(data.submittedByWallet)}</td>
        </tr>
        ${data.evidenceDescription ? `
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Description:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">${data.evidenceDescription}</td>
        </tr>
        ` : ""}
      </table>
    </div>
    
    <p style="color: #4a4a68; margin: 0 0 24px;">
      Please review the submitted evidence and approve the milestone if the work meets the agreed requirements.
    </p>
    
    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}" 
       style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; 
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      Review Evidence
    </a>
  `;
  return baseTemplate(content);
}

export function milestoneApprovedTemplate(data: MilestoneApprovedData): string {
  const content = `
    <h2 style="color: #1a1a2e; margin: 0 0 16px;">Milestone Approved</h2>
    <p style="color: #4a4a68; margin: 0 0 24px;">
      A milestone has been approved and payment has been released.
    </p>
    
    <div style="background: #f0fdf4; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #22c55e;">
      <h3 style="color: #1a1a2e; margin: 0 0 12px; font-size: 18px;">${data.agreementTitle}</h3>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b6b80; width: 120px;">Milestone:</td>
          <td style="padding: 8px 0; color: #1a1a2e; font-weight: 600;">#${data.milestoneIndex + 1} - ${data.milestoneDescription}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Amount:</td>
          <td style="padding: 8px 0; color: #16a34a; font-weight: 600;">${formatAmount(data.milestoneAmount, data.asset)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Approved by:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">${data.approvedByName || formatWallet(data.approvedByWallet)}</td>
        </tr>
      </table>
    </div>
    
    <p style="color: #4a4a68; margin: 0 0 24px;">
      The payment for this milestone has been automatically released from escrow.
    </p>
    
    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}" 
       style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; 
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}

export function disputeOpenedTemplate(data: DisputeOpenedData): string {
  const content = `
    <h2 style="color: #1a1a2e; margin: 0 0 16px;">Dispute Opened</h2>
    <p style="color: #4a4a68; margin: 0 0 24px;">
      A dispute has been opened on an agreement you are participating in.
    </p>
    
    <div style="background: #fef2f2; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #ef4444;">
      <h3 style="color: #1a1a2e; margin: 0 0 12px; font-size: 18px;">${data.agreementTitle}</h3>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b6b80; width: 120px;">Opened by:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">${data.openedByName || formatWallet(data.openedByWallet)}</td>
        </tr>
        ${data.milestoneDescription ? `
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Milestone:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">#${(data.milestoneIndex ?? 0) + 1} - ${data.milestoneDescription}</td>
        </tr>
        ` : ""}
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Reason:</td>
          <td style="padding: 8px 0; color: #dc2626; font-weight: 500;">${data.disputeReason}</td>
        </tr>
      </table>
    </div>
    
    <p style="color: #4a4a68; margin: 0 0 24px;">
      Funds in escrow are now frozen until the dispute is resolved. Both parties should work towards a resolution.
    </p>
    
    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}" 
       style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; 
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Dispute
    </a>
  `;
  return baseTemplate(content);
}

export function disputeResolvedTemplate(data: DisputeResolvedData): string {
  const content = `
    <h2 style="color: #1a1a2e; margin: 0 0 16px;">Dispute Resolved</h2>
    <p style="color: #4a4a68; margin: 0 0 24px;">
      The dispute has been resolved and funds have been distributed accordingly.
    </p>
    
    <div style="background: #f0fdf4; border-radius: 8px; padding: 20px; margin-bottom: 24px; border-left: 4px solid #22c55e;">
      <h3 style="color: #1a1a2e; margin: 0 0 12px; font-size: 18px;">${data.agreementTitle}</h3>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b6b80; width: 120px;">Resolution:</td>
          <td style="padding: 8px 0; color: #1a1a2e; font-weight: 600;">${data.resolution}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Resolved by:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">${data.resolvedByName || formatWallet(data.resolvedByWallet)}</td>
        </tr>
        ${data.releaseAmount ? `
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Released:</td>
          <td style="padding: 8px 0; color: #16a34a; font-weight: 600;">${formatAmount(data.releaseAmount, data.asset || "USDC")}</td>
        </tr>
        ` : ""}
        ${data.refundAmount ? `
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Refunded:</td>
          <td style="padding: 8px 0; color: #f59e0b; font-weight: 600;">${formatAmount(data.refundAmount, data.asset || "USDC")}</td>
        </tr>
        ` : ""}
      </table>
    </div>
    
    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}" 
       style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; 
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}

export function agreementCompletedTemplate(data: AgreementCompletedData): string {
  const completedDate = new Date(data.completedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const content = `
    <h2 style="color: #1a1a2e; margin: 0 0 16px;">Agreement Completed</h2>
    <p style="color: #4a4a68; margin: 0 0 24px;">
      Congratulations! The agreement has been successfully completed.
    </p>
    
    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); 
                border-radius: 8px; padding: 20px; margin-bottom: 24px; 
                border: 1px solid #86efac;">
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="font-size: 48px;">&#10003;</span>
      </div>
      
      <h3 style="color: #1a1a2e; margin: 0 0 12px; font-size: 18px; text-align: center;">${data.title}</h3>
      
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; color: #6b6b80; width: 120px;">Total Amount:</td>
          <td style="padding: 8px 0; color: #16a34a; font-weight: 600;">${formatAmount(data.totalAmount, data.asset)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #6b6b80;">Completed on:</td>
          <td style="padding: 8px 0; color: #1a1a2e;">${completedDate}</td>
        </tr>
      </table>
    </div>
    
    <p style="color: #4a4a68; margin: 0 0 24px;">
      All milestones have been approved and all payments have been released. Thank you for using Thalos!
    </p>
    
    <a href="https://thalosplatform.xyz/agreements/${data.agreementId}" 
       style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; 
              text-decoration: none; border-radius: 8px; font-weight: 600;">
      View Agreement
    </a>
  `;
  return baseTemplate(content);
}
