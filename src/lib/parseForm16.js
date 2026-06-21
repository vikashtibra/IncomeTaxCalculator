import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(" ") + "\n";
  }
  return text;
}

const numAfter = (text, labelPatterns) => {
  for (const re of labelPatterns) {
    const m = text.match(re);
    if (m) {
      const value = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(value)) return { value, raw: m[0].trim().slice(0, 140) };
    }
  }
  return null;
};

const NUM = `([\\d,]+(?:\\.\\d+)?)`;

export function parseForm16(text) {
  if (!text || text.replace(/\s/g, "").length < 50) {
    return { unreadable: true, fields: {}, warnings: [] };
  }

  const fields = {};
  const warnings = [];

  const gross = numAfter(text, [
    new RegExp(`Gross\\s*Salary[\\s\\S]{0,40}?${NUM}`, "i"),
    new RegExp(`Salary\\s*as\\s*per\\s*section\\s*17\\(1\\)[\\s\\S]{0,40}?${NUM}`, "i"),
  ]);
  if (gross) fields.gross = gross;

  const tds = numAfter(text, [
    new RegExp(`Total\\s*(?:amount\\s*of\\s*)?tax\\s*deduct(?:ed|ion)[\\s\\S]{0,60}?${NUM}`, "i"),
    new RegExp(`Total\\s*tax\\s*deposited[\\s\\S]{0,40}?${NUM}`, "i"),
  ]);
  if (tds) fields.tds = tds;

  const hra = numAfter(text, [
    new RegExp(`House\\s*Rent\\s*Allowance[\\s\\S]{0,40}?${NUM}`, "i"),
  ]);
  if (hra) fields.hra = hra;

  const c80 = numAfter(text, [
    new RegExp(`(?:Section\\s*)?80C[\\s\\S]{0,40}?${NUM}`, "i"),
  ]);
  if (c80) fields.c80 = c80;

  const name = text.match(/Name\s*(?:and\s*address\s*)?of\s*(?:the\s*)?Employee[\s\S]{0,60}?:?\s*([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z.]*){0,4})(?=\s+(?:PAN|TAN|Address|Employer|Designation|Father|DOB|Date|Assessment|Financial)\b|[:\n]|$)/i);
  if (name) fields.name = { value: name[1].trim(), raw: name[0].trim().slice(0, 140) };

  const pan = text.match(/PAN\s*(?:of\s*the\s*Employee)?\s*:?\s*([A-Z]{5}[0-9]{4}[A-Z])/i);
  if (pan) fields.pan = { value: pan[1], raw: pan[0].trim().slice(0, 140) };

  if (!fields.gross) warnings.push("Could not find Gross Salary - enter manually.");
  if (!fields.tds) warnings.push("Could not find Total TDS - enter manually.");

  return { unreadable: false, fields, warnings };
}
