#!/bin/bash
set -euo pipefail

# Configuration - edit these values
PROJECT_ID="gcp-github-secrets"
PROJECT_NAME="GitHub Secrets"
REPO_OWNER="domdomegg"
RESOURCE_PREFIX="github-secrets"

# Derived values
POOL_ID="${RESOURCE_PREFIX}-pool"
PROVIDER_ID="${RESOURCE_PREFIX}-github"

# Attribute condition - restricts which GitHub OIDC tokens GCP accepts
# This matches GitHub Actions secrets behavior: only repos owned by REPO_OWNER
# For stricter security, you could add ref restrictions, e.g.:
#   && (assertion.ref.startsWith('refs/tags/') || assertion.ref == 'refs/heads/master' || assertion.ref == 'refs/heads/main')
ATTRIBUTE_CONDITION="assertion.repository_owner == '${REPO_OWNER}'"

echo "==> Creating GCP project (if it doesn't exist)..."
if ! gcloud projects describe "$PROJECT_ID" &>/dev/null; then
    gcloud projects create "$PROJECT_ID" --name="$PROJECT_NAME"
fi

echo "==> Enabling required APIs..."
gcloud services enable \
    iamcredentials.googleapis.com \
    secretmanager.googleapis.com \
    cloudresourcemanager.googleapis.com \
    --project="$PROJECT_ID"

echo "==> Creating workload identity pool..."
if ! gcloud iam workload-identity-pools describe "$POOL_ID" --location=global --project="$PROJECT_ID" &>/dev/null; then
    gcloud iam workload-identity-pools create "$POOL_ID" \
        --location=global \
        --display-name="GitHub Actions" \
        --description="Workload identity pool for GitHub Actions OIDC" \
        --project="$PROJECT_ID"
fi

echo "==> Creating OIDC provider..."
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --workload-identity-pool="$POOL_ID" --location=global --project="$PROJECT_ID" &>/dev/null; then
    gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
        --location=global \
        --workload-identity-pool="$POOL_ID" \
        --display-name="GitHub" \
        --description="GitHub Actions OIDC provider" \
        --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
        --attribute-condition="$ATTRIBUTE_CONDITION" \
        --issuer-uri="https://token.actions.githubusercontent.com" \
        --project="$PROJECT_ID"
fi

echo "==> Getting project number..."
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")

echo "==> Granting secret accessor role to pool..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/*" \
    --role="roles/secretmanager.secretAccessor" \
    --condition=None \
    --quiet

echo ""
echo "==> Setup complete!"
echo ""
echo "Use this value in your GitHub Actions:"
echo ""
echo "  workload_identity_provider: projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
echo ""
echo "To add a secret:"
echo "  echo -n 'your-secret-value' | gcloud secrets create SECRET_NAME --data-file=- --project=${PROJECT_ID}"
