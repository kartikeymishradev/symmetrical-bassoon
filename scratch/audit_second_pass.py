import os
import re
import json

workspace = r"C:\Users\HP\.gemini\antigravity\scratch\health-wellness-consultation"

forbidden_domains = [
    "revahealth.vercel.app",
    "revahealth.com",
    "www.revahealth.com",
    "revahealth.in",
    "localhost:3000",
    "127.0.0.1"
]

print("=== 1. OLD DOMAIN SEARCH ===")
found_issues = 0
for root, dirs, files in os.walk(workspace):
    if ".git" in root or "node_modules" in root:
        continue
    for f in files:
        if f.endswith(('.html', '.js', '.css', '.json', '.txt', '.xml', '.md')):
            fpath = os.path.join(root, f)
            with open(fpath, 'r', encoding='utf-8', errors='ignore') as file:
                content = file.read()
                for dom in forbidden_domains:
                    matches = re.findall(rf'{re.escape(dom)}', content, re.IGNORECASE)
                    if matches:
                        print(f"FAILED: Found '{dom}' in {os.path.relpath(fpath, workspace)}")
                        found_issues += 1

if found_issues == 0:
    print("PASSED: Zero obsolete domain references found!")

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

print("\n=== 3. PRODUCTION DOMAIN SEO AUDIT ===")
html_files = ["index.html", "blog.html", "blog/hypertension-high-blood-pressure.html", "404.html"]
for hf in html_files:
    fpath = os.path.join(workspace, hf)
    if not os.path.exists(fpath):
        print(f"FAILED: {hf} missing!")
        continue
    with open(fpath, 'r', encoding='utf-8') as file:
        content = file.read()
        canonical = re.search(r'<link rel="canonical" href="(.*?)">', content)
        og_url = re.search(r'<meta property="og:url" content="(.*?)">', content)
        
        print(f"File: {hf}")
        print(f"  Canonical: {canonical.group(1) if canonical else 'MISSING'}")
        print(f"  OG URL: {og_url.group(1) if og_url else 'MISSING'}")

print("\n=== AUDIT COMPLETE ===")
