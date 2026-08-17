$env:TG_PROXY = '127.0.0.1:23182'
$env:HTTP_PROXY = 'http://127.0.0.1:23182'
$env:HTTPS_PROXY = 'http://127.0.0.1:23182'
$env:NODE_USE_ENV_PROXY = '1'
$env:NODE_NO_WARNINGS = '1'

Set-Location -LiteralPath 'D:\projects\recruitment-dashboard'
& node scripts/tg-delivery-worker.mjs >> artifacts/tg-delivery-worker.log 2>&1
exit $LASTEXITCODE
