#!/usr/bin/env bash
# Meldet alle URLs aus der Live-Sitemap an IndexNow (Bing, Yandex, Seznam, Naver …; die ChatGPT-Suche baut auf Bing auf).
# Nach neuen oder geänderten Seiten ausführen, sobald sie live sind: scripts/indexnow.sh
# Der Schlüssel ist öffentlich (liegt als static/<KEY>.txt im Webroot) und kein Geheimnis.
set -euo pipefail
KEY=88dd60d029bddd12b3870107738d741f
HOST=verafides.ch
urls="$(curl -fsS "https://$HOST/sitemap.xml" | grep -oP '(?<=<loc>)[^<]+' | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')"
curl -fsS -o /dev/null -w "IndexNow: HTTP %{http_code} (200/202 = angenommen)\n" -X POST https://api.indexnow.org/indexnow \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"https://$HOST/$KEY.txt\",\"urlList\":$urls}"
