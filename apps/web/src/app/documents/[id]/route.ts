import { getChildDocument } from "@dailylog/db/queries";
import { getServerSupabase } from "@/lib/supabase/server";

function safeName(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "document"}.pdf`;
}

function pdfText(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "-").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function demoPdf(title: string): Uint8Array {
  const stream = [
    "BT",
    "/F1 20 Tf",
    "72 720 Td",
    `(${pdfText(title)}) Tj`,
    "0 -34 Td",
    "/F1 11 Tf",
    "(Sunny Grove Early Learning - development record) Tj",
    "0 -22 Td",
    "(This seeded PDF verifies the Group 19 document flow.) Tj",
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  let document: Awaited<ReturnType<typeof getChildDocument>>;
  try {
    document = await getChildDocument(supabase, id);
  } catch {
    return new Response("Document not found", { status: 404 });
  }

  if (document.storage_path.startsWith("demo://")) {
    const bytes = demoPdf(document.title);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeName(document.title)}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(document.storage_path, 300);
  if (error || !data?.signedUrl) return new Response("Document unavailable", { status: 404 });
  return Response.redirect(data.signedUrl, 302);
}
