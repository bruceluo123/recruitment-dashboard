import paramiko, sys, io, posixpath
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

SITE = r"D:\projects\recruitment-dashboard\yifangpinpin-web\site-src"
ADMIN = r"D:\projects\recruitment-dashboard\yifangpinpin-web\admin-src"
REMOTE = "/home/admin/yifangpinpin"

# (local_base, local_filename, remote_rel_or_abs)
FILES = [
  # --- C 端贷款模块（新增）---
  (SITE, "loan.ts",                 "src/lib/loan.ts"),
  (SITE, "m-loan-page.tsx",         "src/app/m/loan/page.tsx"),
  (SITE, "m-loan-detail-page.tsx",  "src/app/m/loan/[id]/page.tsx"),
  (SITE, "m-loan-apply-page.tsx",   "src/app/m/loan/apply/page.tsx"),
  (SITE, "loan-actions.ts",         "src/app/m/loan/actions.ts"),
  (SITE, "m-loan-success-page.tsx", "src/app/m/loan/apply/success/page.tsx"),
  # --- 入口统一（改动）---
  (SITE, "page.tsx",                "src/app/page.tsx"),
  (SITE, "m-page.tsx",              "src/app/m/page.tsx"),
  (SITE, "m-detail-page.tsx",       "src/app/m/p/[id]/page.tsx"),
  # --- 后台贷款页（新增 + 改动）---
  (ADMIN, "loan-products-page.tsx",      "src/app/admin/loan-products/page.tsx"),
  (ADMIN, "loan-applications-page.tsx",  "src/app/admin/loan-applications/page.tsx"),
  (ADMIN, "components/AdminSidebar.tsx", "src/components/admin/AdminSidebar.tsx"),
  (ADMIN, "layout.tsx",                  "src/app/admin/layout.tsx"),
  # --- 样式追加（先上传到 /tmp，再幂等 append 到 globals.css）---
  (SITE, "loan-append.css",         "/tmp/loan-append.css"),
]

t = paramiko.Transport(("47.106.113.136", 22)); t.start_client(timeout=30)
t.auth_password("root", "Aa88845899")
sftp = paramiko.SFTPClient.from_transport(t)

def ensure(d):
    parts = d.strip("/").split("/"); cur = ""
    for p in parts:
        cur += "/" + p
        try: sftp.stat(cur)
        except IOError: sftp.mkdir(cur)

for base, fn, rel in FILES:
    remote = rel if rel.startswith("/") else posixpath.join(REMOTE, rel)
    ensure(posixpath.dirname(remote))
    sftp.put(posixpath.join(base, fn), remote)
    print("uploaded", fn, "->", remote)

sftp.close(); t.close()
print("DONE")
