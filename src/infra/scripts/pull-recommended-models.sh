#!/usr/bin/env bash
# Pull curated Ollama models for AgentHub by tier: default | lightweight | balanced | quality | pro48 | all
# Catalog uses Western/open providers only (Meta, Mistral, Microsoft, Google, IBM, BigCode).
set -euo pipefail

TIER="${1:-default}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"

pull_model() {
  local name="$1"
  echo "→ Pulling ${name}..."
  curl -sf "${OLLAMA_HOST}/api/pull" -d "{\"name\":\"${name}\"}" >/dev/null
  echo "✓ ${name}"
}

case "${TIER}" in
  default)
    MODELS=(
      "gemma4:26b-mlx"
    )
    ;;
  lightweight)
    MODELS=(
      "llama3.2:3b"
      "gemma4:e4b"
      "phi3:3.8b"
    )
    ;;
  balanced)
    MODELS=(
      "llama3.1:8b"
      "gemma4:12b-mlx"
      "mistral:7b"
      "codellama:13b"
    )
    ;;
  quality)
    MODELS=(
      "gemma4:26b-mlx"
      "gemma4:31b-mlx"
      "codestral:22b"
      "phi4-reasoning:14b"
    )
    ;;
  pro48)
    # Tuned for 48GB Apple Silicon (e.g. M5 Pro) — no China-based models
    MODELS=(
      "gemma4:26b-mlx"
      "gemma4:31b-mlx"
      "codestral:22b"
      "devstral:24b"
      "phi4-reasoning:14b"
    )
    ;;
  all)
    MODELS=(
      "llama3.2:3b"
      "gemma4:e4b"
      "phi3:3.8b"
      "llama3.1:8b"
      "gemma4:12b-mlx"
      "mistral:7b"
      "mistral-nemo:12b"
      "codellama:13b"
      "granite-code:8b"
      "starcoder2:15b"
      "gemma4:26b-mlx"
      "gemma4:31b-mlx"
      "codestral:22b"
      "devstral:24b"
      "codellama:34b"
      "phi4-reasoning:14b"
      "granite-code:20b"
      "llama3.3:70b"
    )
    ;;
  *)
    echo "Usage: $0 [default|lightweight|balanced|quality|pro48|all]"
    echo ""
    echo "  default      AgentHub default — gemma4:26b-mlx"
    echo "  lightweight  ~4–8GB RAM  — llama3.2, gemma4:e4b, phi3"
    echo "  balanced     ~8–12GB RAM — llama3.1, gemma4:12b-mlx, mistral"
    echo "  quality      ~20GB+ RAM  — gemma4:26b-mlx, codestral, phi4-reasoning"
    echo "  pro48        ~48GB RAM   — gemma4 + coding specialists for M-series Pro/Max"
    echo "  all          full curated set"
    exit 1
    ;;
esac

echo "AgentHub — pulling ${TIER} local models from ${OLLAMA_HOST}"
echo ""

if ! curl -sf "${OLLAMA_HOST}/api/tags" >/dev/null; then
  echo "Ollama is not reachable at ${OLLAMA_HOST}"
  echo "Start infra first:  cd src && npm run infra:up"
  exit 1
fi

for model in "${MODELS[@]}"; do
  pull_model "${model}"
done

echo ""
echo "Done. Default: OLLAMA_MODEL=gemma4:26b-mlx — assign in Agents → Ollama → Model."