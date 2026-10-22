"""Generate format fixtures by faithfully converting the cached real OWID data.
Uses the committed real source fixture tests/fixtures/owid-China-2015-2022.csv.
These conversions are test artifacts, not a sample dataset bundled in the app.
"""
import csv, io, subprocess, sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.tools/python'))
from PIL import Image, ImageDraw
subprocess.run(['node','tests/create-import-fixtures.mjs'],cwd=root,check=True)
rows=[r for r in csv.reader(io.StringIO((root/'tests/fixtures/owid-China-2015-2022.csv').read_text(encoding='utf-8'))) if r]
def pdf(objects,filename):
    out=bytearray(b'%PDF-1.4\n');offsets=[0]
    for i,o in enumerate(objects,1):
        offsets.append(len(out));out.extend(f'{i} 0 obj\n'.encode()+o+b'\nendobj\n')
    xref=len(out);out.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for p in offsets[1:]:out.extend(f'{p:010d} 00000 n \n'.encode())
    out.extend(f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode());(root/'artifacts'/filename).write_bytes(out)
text=['BT /F1 13 Tf 40 660 Td (OWID real data subset - original values) Tj ET']
for r,row in enumerate(rows):
    for c,v in enumerate(row):text.append(f'BT /F1 10 Tf {40+c*180} {620-r*25} Td ({v}) Tj ET')
s='\n'.join(text).encode()
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 700] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',f'<< /Length {len(s)} >>\nstream\n'.encode()+s+b'\nendstream',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 700] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>']
pdf(objects,'owid-real-subset.pdf')
im=Image.new('RGB',(1600,1000),'white');draw=ImageDraw.Draw(im)
for r,row in enumerate(rows):
    for c,v in enumerate(row):draw.text((20+c*310,40+r*55),v,fill='black',font_size=18)
buf=io.BytesIO();im.save(buf,format='JPEG');j=buf.getvalue();stream=b'q 1000 0 0 700 0 0 cm /Im0 Do Q'
objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 700] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',f'<< /Type /XObject /Subtype /Image /Width 1600 /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {len(j)} >>\nstream\n'.encode()+j+b'\nendstream',f'<< /Length {len(stream)} >>\nstream\n'.encode()+stream+b'\nendstream']
pdf(objects,'owid-real-scan.pdf')
print('Created real OWID conversions: Excel, two-page text PDF, image-only PDF.')
