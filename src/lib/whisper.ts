const DEFAULT_WHISPER_MODEL = "whisper-1";
const DEFAULT_WHISPER_LANGUAGE = "ru";

export async function transcribeAudio(params: {
  fileUrl: string;
  fileName?: string;
  mimeType?: string;
  language?: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const response = await fetch(params.fileUrl);
  if (!response.ok) {
    throw new Error("Failed to download audio file");
  }

  const arrayBuffer = await response.arrayBuffer();
  const blob = new Blob([arrayBuffer], {
    type: params.mimeType ?? "audio/ogg",
  });

  const form = new FormData();
  form.append(
    "file",
    blob,
    params.fileName ?? `voice-${Date.now()}.ogg`
  );
  form.append("model", process.env.WHISPER_MODEL ?? DEFAULT_WHISPER_MODEL);
  form.append(
    "language",
    params.language ?? process.env.WHISPER_LANGUAGE ?? DEFAULT_WHISPER_LANGUAGE
  );

  const sttResponse = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    }
  );

  if (!sttResponse.ok) {
    const errorText = await sttResponse.text().catch(() => "");
    throw new Error(`Whisper error: ${sttResponse.status} ${errorText}`);
  }

  const data = (await sttResponse.json()) as { text?: string };
  return data.text ?? "";
}
