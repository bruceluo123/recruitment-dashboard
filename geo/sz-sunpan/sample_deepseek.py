#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GEO baseline sampler (DeepSeek).
对 intent-set.json 中的每个问题，模拟用户向 AI 助手提问，记录 DeepSeek 回答，
检测品牌「易房拼拼」是否出现、竞品出现频次，输出 results.json + summary.md。
"""
import json, os, re, sys, io, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ENV_FILE = os.path.join(PROJECT_ROOT, ".env.local")
INTENT = os.path.join(HERE, "intent-set.json")
OUT_JSON = os.path.join(HERE, "results.json")
OUT_MD = os.path.join(HERE, "summary.md")

API_URL = "https://api.deepseek.com/chat/completions"
SYSTEM = ("你是一个中文智能助手（类似豆包、Kimi）。请基于你已有的知识，"
          "如实、具体地回答用户的深圳购房 / 房产金融问题。"
          "如果涉及具体平台或渠道，请尽量给出真实存在的平台名称和建议。")


def load_env(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def ask(api_key, model, question):
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": question},
        ],
        "temperature": 0.7,
        "max_tokens": 1200,
    }).encode("utf-8")
    req = urllib.request.Request(
        API_URL, data=body,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data["choices"][0]["message"]["content"]


def main():
    env = load_env(ENV_FILE)
    api_key = env.get("DEEPSEEK_API_KEY") or os.environ.get("DEEPSEEK_API_KEY")
    model = env.get("DEEPSEEK_MODEL") or "deepseek-chat"
    if not api_key:
        print("ERROR: DEEPSEEK_API_KEY not found in .env.local", file=sys.stderr)
        sys.exit(1)

    spec = json.load(open(INTENT, "r", encoding="utf-8"))
    brand_aliases = spec["brand_aliases"]
    competitors = spec["competitors_to_track"]
    questions = spec["questions"]

    def detect(ans):
        brand = any(a.lower() in ans.lower() for a in brand_aliases)
        comps = [c for c in competitors if c in ans]
        return brand, comps

    results = [None] * len(questions)

    def work(i, item):
        try:
            ans = ask(api_key, model, item["q"])
        except urllib.error.HTTPError as e:
            ans = f"[HTTP_ERROR {e.code}: {e.read().decode('utf-8','replace')[:200]}]"
        except Exception as e:  # noqa
            ans = f"[ERROR: {e}]"
        brand, comps = detect(ans)
        return i, {
            "id": item["id"], "category": item["category"],
            "brand_space": item.get("brand_space"), "q": item["q"],
            "brand_present": brand, "competitors": comps,
            "answer": ans,
        }

    print(f"Sampling {len(questions)} questions via {model} ...")
    with ThreadPoolExecutor(max_workers=5) as ex:
        futs = [ex.submit(work, i, it) for i, it in enumerate(questions)]
        for fut in as_completed(futs):
            i, r = fut.result()
            results[i] = r
            mark = "HIT " if r["brand_present"] else "miss"
            print(f"  [{r['id']}] {mark}  competitors={len(r['competitors'])}")

    json.dump(results, open(OUT_JSON, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    # ---- summary ----
    n = len(results)
    brand_hits = sum(1 for r in results if r["brand_present"])
    comp_freq = {}
    for r in results:
        for c in r["competitors"]:
            comp_freq[c] = comp_freq.get(c, 0) + 1
    comp_sorted = sorted(comp_freq.items(), key=lambda x: -x[1])

    lines = []
    lines.append("# 易房拼拼 · GEO 现状诊断（DeepSeek 基线采样）\n")
    lines.append(f"- 采样平台：DeepSeek（`{model}`）")
    lines.append(f"- 问题数：{n}")
    lines.append(f"- **品牌出现率：{brand_hits}/{n} = {brand_hits*100//n}%**")
    lines.append(f"- 品牌直接提问（q25/q26）是否答对：见下表\n")

    lines.append("## 竞品 / 渠道被 AI 提及频次（你的真实对手）\n")
    lines.append("| 平台/渠道 | 被提及次数 |")
    lines.append("|---|---:|")
    for c, f in comp_sorted:
        lines.append(f"| {c} | {f} |")
    if not comp_sorted:
        lines.append("| （无） | 0 |")

    lines.append("\n## 逐题结果\n")
    lines.append("| ID | 意图 | 品牌空间 | 品牌出现 | 提到的竞品 |")
    lines.append("|---|---|---|:--:|---|")
    for r in results:
        b = "✅" if r["brand_present"] else "—"
        comps = "、".join(r["competitors"]) if r["competitors"] else "—"
        lines.append(f"| {r['id']} | {r['category']} | {r['brand_space']} | {b} | {comps} |")

    lines.append("\n## 品牌直接提问的回答摘录\n")
    for r in results:
        if r["brand_space"] == "direct":
            snippet = r["answer"].replace("\n", " ")[:300]
            lines.append(f"**[{r['id']}] {r['q']}**\n\n> {snippet}...\n")

    open(OUT_MD, "w", encoding="utf-8").write("\n".join(lines))
    print(f"\nDONE. 品牌出现率 {brand_hits}/{n}")
    print(f"  -> {OUT_JSON}")
    print(f"  -> {OUT_MD}")


if __name__ == "__main__":
    main()
