import { issueEmailVerificationToken } from "@/lib/email-verification";
import { sendEmailVerificationEmail } from "@/lib/unisender";

export async function deliverEmailVerification(params: {
  userId: string;
  email: string;
}) {
  const token = await issueEmailVerificationToken({
    userId: params.userId,
    email: params.email,
  });

  await sendEmailVerificationEmail({
    email: params.email,
    verificationUrl: token.verificationUrl,
  });

  return token;
}
