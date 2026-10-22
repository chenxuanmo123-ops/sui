"""Independent standard-library calculation; no application SQL reused."""
from pathlib import Path
import csv,hashlib,json,collections
root=Path(__file__).resolve().parents[1]
raw=(root/'tests/fixtures/uci-online-shoppers.csv').read_bytes()
assert hashlib.sha256(raw).hexdigest()=='b3055ee355f59134d851d32641183cb4a8b45def7124d2f50442a042f358e0d9'
rows=list(csv.DictReader(raw.decode('utf-8').splitlines()))
result={'rows':len(rows),'sha256':hashlib.sha256(raw).hexdigest(),'numerator':sum(r['Revenue']=='TRUE' for r in rows),'denominator':sum(r['Revenue'] in ('TRUE','FALSE') for r in rows),'groups':{}}
for field in ['VisitorType','TrafficType','Month','Weekend']:
 values=collections.defaultdict(lambda:{'numerator':0,'denominator':0,'excluded':0,'rowIds':[]})
 for i,r in enumerate(rows):
  v=values[r[field]];v['numerator']+=r['Revenue']=='TRUE';v['denominator']+=r['Revenue'] in ('TRUE','FALSE');v['excluded']+=r['Revenue'] not in ('TRUE','FALSE');v['rowIds'].append(i+2)
 for v in values.values():v['value']=v['numerator']/v['denominator']*100 if v['denominator'] else None
 result['groups'][field]=dict(values)
out=root/'artifacts/real-ecommerce-acceptance';out.mkdir(exist_ok=True)
(out/'independent-python-oracle.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print('VERIFIED',len(rows),result['numerator'],result['denominator'])
