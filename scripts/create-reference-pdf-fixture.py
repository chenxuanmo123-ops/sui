"""Generate a two-page text PDF used only by the reference retrieval browser check."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
target = root / "tests/fixtures/reference-note.pdf"


def stream(text: str) -> bytes:
    body = ("BT /F1 12 Tf 50 720 Td (" + text + ") Tj ET").encode("ascii")
    return b"<< /Length " + str(len(body)).encode() + b" >>\nstream\n" + body + b"\nendstream"


objects = {
    1: b"<< /Type /Catalog /Pages 2 0 R >>",
    2: b"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    3: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    4: stream("Cover page. This page intentionally has no relevant detail."),
    5: b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    6: stream("Renewable electricity is measured in terawatt hours, abbreviated TWh. Missing values are not zero. The denominator includes reported records only."),
    7: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
}

header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
body, offsets = b"", {}
for number in range(1, 8):
    offsets[number] = len(header) + len(body)
    body += b"%d 0 obj\n" % number + objects[number] + b"\nendobj\n"
xref_offset = len(header) + len(body)
xref = b"xref\n0 8\n0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % offsets[number] for number in range(1, 8))
trailer = b"trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n" + str(xref_offset).encode() + b"\n%%EOF\n"
target.write_bytes(header + body + xref + trailer)
print(target)
