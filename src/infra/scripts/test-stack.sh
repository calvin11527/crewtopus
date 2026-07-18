#!/usr/bin/env bash
###############################################################################
# AgentHub – End-to-end stack verification (k8s / docker)
###############################################################################
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:8080}"
PASS=0
FAIL=0

check() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "AgentHub Stack Tests"
echo "  Backend:  $BASE_URL"
echo "  Frontend: $FRONTEND_URL"
echo ""

echo "Infrastructure:"
check "Backend health" "curl -sf $BASE_URL/api/health | grep -q '\"status\":\"ok\"'"
check "Frontend UI" "curl -sf -o /dev/null -w '%{http_code}' $FRONTEND_URL/ | grep -q 200"
check "Frontend API proxy" "curl -sf $FRONTEND_URL/api/health | grep -q '\"status\":\"ok\"'"
check "Prometheus" "curl -sf http://localhost:9090/-/healthy | grep -q Healthy"
check "Grafana" "curl -sf http://localhost:3001/api/health | grep -q '\"database\": \"ok\"'"
check "Ollama" "curl -sf http://localhost:11434/api/tags"
check "Metrics endpoint" "curl -sf $BASE_URL/metrics | grep -q agenthub_"

echo ""
echo "API modules:"
check "Agents" "curl -sf $BASE_URL/api/agents | grep -q 'Mock Agent'"
check "Capabilities" "curl -sf $BASE_URL/api/capabilities | grep -q 'name'"
check "Workspaces" "curl -sf $BASE_URL/api/workspaces"
check "Workflows" "curl -sf $BASE_URL/api/workflows"
check "Supervisor status" "curl -sf $BASE_URL/api/supervisor/status"
check "Privacy policies" "curl -sf $BASE_URL/api/privacy/policies"
check "Audit log" "curl -sf $BASE_URL/api/audit?limit=5"
check "Audit stats" "curl -sf $BASE_URL/api/audit/stats"
check "Approvals" "curl -sf $BASE_URL/api/approval"
check "Proactive triggers" "curl -sf $BASE_URL/api/proactive/triggers"
check "Consensus sessions" "curl -sf $BASE_URL/api/consensus/sessions"
check "Scrum board" "curl -sf $BASE_URL/api/work-items/board | grep -q backlog"
check "Work item sprints" "curl -sf $BASE_URL/api/work-items/sprints"

echo ""
echo "Workflow E2E (mock agent):"
WF_RESP=$(curl -sf -X POST "$BASE_URL/api/workflows" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Stack Test","definition":{"name":"Stack Test","steps":[{"name":"Plan","agent":"mock","capability":"planning"}]}}')
WF_ID=$(echo "$WF_RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
if [ -n "$WF_ID" ]; then
  EXEC_RESP=$(curl -sf -X POST "$BASE_URL/api/workflows/$WF_ID/execute" \
    -H 'Content-Type: application/json' \
    -d '{}')
  EXEC_ID=$(echo "$EXEC_RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  if [ -n "$EXEC_ID" ]; then
    for _ in $(seq 1 40); do
      STATUS=$(curl -sf "$BASE_URL/api/workflows/$WF_ID/executions" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -1)
      [ "$STATUS" = "completed" ] && break
      [ "$STATUS" = "failed" ] && break
      sleep 0.5
    done
    if [ "$STATUS" = "completed" ]; then
      echo "  ✓ Workflow execute (completed)"
      PASS=$((PASS + 1))
    else
      echo "  ✗ Workflow execute (status: ${STATUS:-unknown})"
      FAIL=$((FAIL + 1))
    fi
  else
    echo "  ✗ Workflow execute (no execution id)"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  ✗ Workflow create"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Privacy guard:"
RESULT=$(curl -sf -X POST "$BASE_URL/api/privacy/guard" \
  -H 'Content-Type: application/json' \
  -d '{"scope":{"files":["sk-abcdefghijklmnopqrstuvwxyz123456"],"diffs":[],"symbols":[],"maxTokens":8000,"sensitivityLevel":0},"agentType":"mock"}' 2>/dev/null || echo "")
if [ -n "$RESULT" ]; then
  if echo "$RESULT" | grep -q '"passed":false'; then
    echo "  ✓ Privacy guard blocks secrets"
    PASS=$((PASS + 1))
  else
    echo "  ✗ Privacy guard blocks secrets"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  ✗ Privacy guard endpoint"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Kubernetes (if available):"
if command -v kubectl &>/dev/null && kubectl get ns agent-hub &>/dev/null 2>&1; then
  check "Namespace agent-hub" "kubectl get ns agent-hub"
  check "HPA configured" "kubectl get hpa agenthub-frontend -n agent-hub"
  HPA_MAX=$(kubectl get hpa agenthub-frontend -n agent-hub -o jsonpath='{.spec.maxReplicas}' 2>/dev/null || echo "0")
  if [ "$HPA_MAX" = "2" ]; then
    echo "  ✓ HPA maxReplicas=2"
    PASS=$((PASS + 1))
  else
    echo "  ✗ HPA maxReplicas=2 (got $HPA_MAX)"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  (skipped – k8s not running)"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]