#!/usr/bin/env bash
set -euo pipefail

PORT="${CODE_PORT:-37631}"
HOST="${PAIRING_HOST:-127.0.0.1}"
SERVICE_URL="https://${HOST}:${PORT}"

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

response="$(curl -sk -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  "${SERVICE_URL}/api/pairing-ticket")"

pairing_code="$(jq -r '.value // empty' <<<"${response}")"
expires_at="$(jq -r '.expiresAt // empty' <<<"${response}")"
payload="$(jq -r '.qrPayload // empty' <<<"${response}")"
advertised_url="$(jq -r '.serviceUrl // empty' <<<"${response}")"

if [[ -z "${pairing_code}" || -z "${payload}" ]]; then
  echo "error: failed to create pairing ticket" >&2
  echo "${response}" >&2
  exit 1
fi

echo "Pairing code: ${pairing_code}"
echo "Service URL: ${advertised_url}"
echo "Expires at: ${expires_at}"
echo

if command -v qrencode >/dev/null 2>&1; then
  qrencode -t ANSIUTF8 <<<"${payload}"
else
  cat <<'EOF'
qrencode is not installed, so terminal QR rendering is unavailable.
Install it first, for example:
  sudo apt install qrencode
Then rerun this script.

Raw pairing payload:
EOF
  echo "${payload}"
fi
