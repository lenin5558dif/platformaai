type MagicLinkPayload = {
  email: string;
  url: string;
};

export async function sendMagicLink({ email, url }: MagicLinkPayload) {
  const apiKey = process.env.UNISENDER_API_KEY;
  const senderEmail = process.env.UNISENDER_SENDER_EMAIL;
  const senderName = process.env.UNISENDER_SENDER_NAME ?? "PlatformaAI";

  if (!apiKey) {
    throw new Error("UNISENDER_API_KEY is not set");
  }

  if (!senderEmail) {
    throw new Error("UNISENDER_SENDER_EMAIL is not set");
  }

  const body = new URLSearchParams({
    api_key: apiKey,
    email,
    sender_name: senderName,
    sender_email: senderEmail,
    subject: "Вход в PlatformaAI",
    body: `Перейдите по ссылке для входа: ${url}`,
  });

  const response = await fetch("https://api.unisender.com/ru/api/sendEmail", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`UniSender error: ${text}`);
  }
}
