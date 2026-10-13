import { GoogleGenAI } from "@google/genai";
import * as XLSX from "xlsx";
import { writeServiceLog } from "@/lib/service-log";
import { qualityConfig } from "@/lib/translation-quality/config";

const TEXT_LIMIT = 60_000;

const READ_PROMPT = [
  "Transcribe all readable text in this file exactly as written, in its original language.",
  "Keep headings, numbered steps, list items, warnings, and line breaks.",
  "Do not translate, summarise, explain, or add anything. Reply with the text only.",
  "If there is no readable text, reply with an empty message.",
].join(" ");

export type ExtractedText = {
  text: string;
  method: "plain" | "docx" | "excel" | "gemini";
};

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function tidy(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, TEXT_LIMIT);
}

/** A .docx file is a zip; the words live in word/document.xml. */
function readDocx(buffer: Buffer): string {
  const archive = XLSX.CFB.read(buffer, { type: "buffer" });
  const index = (archive.FullPaths as string[]).findIndex((p) => p.endsWith("word/document.xml"));
  if (index < 0) throw new Error("This Word file has no document text.");
  const content = archive.FileIndex[index]?.content;
  if (!content) throw new Error("This Word file has no document text.");
  const xml = Buffer.from(content as Uint8Array).toString("utf8");
  return decodeXml(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
  );
}

/** Every non-empty row, cells separated by tabs. Sheet names head each sheet when there are several. */
function readWorkbook(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const several = workbook.SheetNames.length > 1;
  return workbook.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(workbook.Sheets[name], {
      header: 1,
      defval: "",
      blankrows: false,
    });
    const lines = rows
      .map((row) => row.map((cell) => String(cell ?? "").trim()).join("\t").replace(/\t+$/, ""))
      .filter((line) => line.trim());
    return several && lines.length ? [`${name}`, ...lines].join("\n") : lines.join("\n");
  })
    .filter(Boolean)
    .join("\n\n");
}

async function readWithGemini(buffer: Buffer, mime: string, name: string): Promise<string> {
  const config = qualityConfig();
  if (!config.geminiApiKey) {
    throw new Error("Reading images and PDFs needs GEMINI_API_KEY. Type the text instead.");
  }
  const started = Date.now();
  try {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const response = await ai.models.generateContent({
      model: config.geminiModel,
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: mime, data: buffer.toString("base64") } }, { text: READ_PROMPT }],
        },
      ],
      config: { maxOutputTokens: 16384 },
    });
    const text = (response.text ?? "").trim();
    await writeServiceLog({
      source: "gemini",
      ok: true,
      message: "Read text from file",
      durationMs: Date.now() - started,
      input: `${name} (${mime}, ${buffer.length} bytes)`,
      output: text,
      metadata: { model: config.geminiModel, purpose: "extraction" },
    });
    return text;
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Could not read the file.";
    const message = raw.split(config.geminiApiKey).join("[redacted]").slice(0, 240);
    await writeServiceLog({
      source: "gemini",
      ok: false,
      message: "Read text from file failed",
      durationMs: Date.now() - started,
      input: `${name} (${mime}, ${buffer.length} bytes)`,
      error: message,
      metadata: { model: config.geminiModel, purpose: "extraction" },
    });
    throw new Error(message);
  }
}

/**
 * Reads the words out of an upload so they can be reviewed and translated like typed text.
 * Images and PDFs go to Gemini; Excel, Word, and plain text files are read here.
 */
export async function extractFileText(
  buffer: Buffer,
  mime: string,
  name: string
): Promise<ExtractedText> {
  const lower = name.toLowerCase();
  if (mime.startsWith("text/") || /\.(txt|csv|md)$/.test(lower)) {
    return { text: tidy(buffer.toString("utf8")), method: "plain" };
  }
  if (/\.(xlsx|xls)$/.test(lower) || /spreadsheet|ms-excel/.test(mime)) {
    return { text: tidy(readWorkbook(buffer)), method: "excel" };
  }
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return { text: tidy(readDocx(buffer)), method: "docx" };
  }
  if (mime.startsWith("image/") || mime === "application/pdf" || lower.endsWith(".pdf")) {
    const type = mime || "application/pdf";
    return { text: tidy(await readWithGemini(buffer, type, name)), method: "gemini" };
  }
  throw new Error("Upload an image, PDF, Excel, Word (.docx), or text file, or type the text instead.");
}
