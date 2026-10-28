"""Independent check of the UCI Bike Sharing day.csv figures.

Reads the file supplied on the command line and computes the same descriptive
quantities the app reports, using only the Python standard library. The CSV is
treated as data; this script lives outside the extracted archive directory.
"""

import csv
import math
import sys
from collections import defaultdict

path = sys.argv[1]
rows = []
with open(path, newline="", encoding="utf-8") as handle:
    for row in csv.DictReader(handle):
        rows.append(row)

numeric = ["temp", "atemp", "hum", "windspeed", "casual", "registered", "cnt"]
missing = sum(1 for row in rows for key in numeric if row[key].strip() == "")

by_month = defaultdict(list)
for row in rows:
    by_month[row["dteday"][:7]].append(float(row["cnt"]))

by_season = defaultdict(list)
for row in rows:
    by_season[row["season"]].append(float(row["cnt"]))

by_year = defaultdict(float)
for row in rows:
    by_year[row["dteday"][:4]] += float(row["cnt"])

def mean(values):
    return sum(values) / len(values)

def median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2

def pearson(xs, ys):
    mx, my = mean(xs), mean(ys)
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    return cov / math.sqrt(vx * vy)

print("rows", len(rows))
print("dates", rows[0]["dteday"], rows[-1]["dteday"])
print("missing_numeric_cells", missing)
print("cnt_sum", int(sum(float(row["cnt"]) for row in rows)))
print("cnt_min_max", int(min(float(row["cnt"]) for row in rows)), int(max(float(row["cnt"]) for row in rows)))
print("cnt_monthly_sum")
for key in sorted(by_month):
    values = by_month[key]
    print(key, int(sum(values)), median(values))
print("season_sum_median_mean")
for key in sorted(by_season):
    values = by_season[key]
    print(key, len(values), int(sum(values)), median(values), round(mean(values), 3))
print("year_sum", {k: int(v) for k, v in sorted(by_year.items())})
print("pearson_temp_cnt", round(pearson(
    [float(row["temp"]) for row in rows],
    [float(row["cnt"]) for row in rows],
), 6))
print("pearson_hum_cnt", round(pearson(
    [float(row["hum"]) for row in rows],
    [float(row["cnt"]) for row in rows],
), 6))
