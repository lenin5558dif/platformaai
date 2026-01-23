import pdf from "pdf-parse";
import Papa from "papaparse";
import mammoth from "mammoth";

export async function extractTextFromFile(params: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}) {
  const { buffer, mimeType, filename } = params;
  const lowerName = filename.toLowerCase();

  if (mimeType === "application/pdf" || lowerName.endsWith(".pdf")) {
    const data = await pdf(buffer);
    return data.text ?? "";
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? "";
  }

  if (
    mimeType === "text/csv" ||
    lowerName.endsWith(".csv")
  ) {
    const text = buffer.toString("utf-8");
    const parsed = Papa.parse(text.trim(), { skipEmptyLines: true });
    if (parsed.errors?.length) {
      return text;
    }
    return parsed.data.map((row: string[]) => row.join(", ")).join("\n");
  }

  return buffer.toString("utf-8");
}
