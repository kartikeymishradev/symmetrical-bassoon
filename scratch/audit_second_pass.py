import os
import re
import json

workspace = r"C:\Users\HP\.gemini\antigravity\scratch\health-wellness-consultation"

forbidden_terms = ["aryan", "tiwari", "two-expert", "joint consultation", "b.pharm", "pgimer"]

print("=== 1. FORBIDDEN TERMS AUDIT ===")
found_issues = 0
for root, dirs, files in os.walk(workspace):
    if ".git" in root or "node_modules" in root:
        continue
    for f in files:
        if f.endswith(('.html', '.js', '.css', '.json', '.txt', '.xml', '.md')):
            fpath = os.path.join(root, f)
            with open(fpath, 'r', encoding='utf-8', errors='ignore') as file:
                content = file.read()
                for term in forbidden_terms:
                    matches = re.findall(rf'\b{re.escape(term)}\b', content, re.IGNORECASE)
                    if matches:
                        print(f"FAILED: Found '{term}' in {os.path.relpath(fpath, workspace)}")
                        found_issues += 1

if found_issues == 0:
    print("PASSED: Zero forbidden terms found!")

print("\n=== 2. JSON-LD VALIDATION ===")
json_ld_errors = 0
for root, dirs, files in os.walk(workspace):
    if ".git" in root:
        continue
    for f in files:
        if f.endswith('.html'):
            fpath = os.path.join(root, f)
            with open(fpath, 'r', encoding='utf-8') as file:
                content = file.read()
                matches = re.findall(r'<script type="application/ld\+json">(.*?)</script>', content, re.DOTALL)
                for idx, match in enumerate(matches):
                    try:
                        data = json.loads(match.strip())
                        print(f"PASSED: Valid JSON-LD in {os.path.relpath(fpath, workspace)} (block {idx+1})")
                    except Exception as e:
                        print(f"FAILED: Invalid JSON-LD in {os.path.relpath(fpath, workspace)} (block {idx+1}): {e}")
                        json_ld_errors += 1

print("\n=== 3. SEO & METADATA AUDIT ===")
html_files = ["index.html", "blog.html", "blog/hypertension-high-blood-pressure.html", "404.html"]
for hf in html_files:
    fpath = os.path.join(workspace, hf)
    if not os.path.exists(fpath):
        print(f"FAILED: {hf} missing!")
        continue
    with open(fpath, 'r', encoding='utf-8') as file:
        content = file.read()
        title = re.search(r'<title>(.*?)</title>', content)
        desc = re.search(r'<meta name="description" content="(.*?)">', content)
        canonical = re.search(r'<link rel="canonical" href="(.*?)">', content)
        og_title = re.search(r'<meta property="og:title" content="(.*?)">', content)
        twitter_card = re.search(r'<meta name="twitter:card" content="(.*?)">', content)
        
        print(f"File: {hf}")
        print(f"  Title: {title.group(1) if title else 'MISSING'}")
        print(f"  Meta Desc: {desc.group(1) if desc else 'MISSING'}")
        print(f"  Canonical: {canonical.group(1) if canonical else 'MISSING'}")
        print(f"  OG Title: {og_title.group(1) if og_title else 'MISSING'}")
        print(f"  Twitter Card: {twitter_card.group(1) if twitter_card else 'MISSING'}")

print("\n=== AUDIT COMPLETE ===")
