# gcp-github-secrets

Use GCP Secret Manager with GitHub Actions OIDC - no more rotating tokens in every repo.

## The problem

NPM (and other services) now require short-lived tokens (90 days max). If you have many repositories, rotating tokens in each one is painful. GitHub Actions OIDC lets you authenticate without static secrets, but setting it up with GCP is fiddly.

## The solution

This repo is a Pulumi stack that sets up:
- GCP Workload Identity Federation for GitHub Actions
- A service account with Secret Manager access
- Your secrets in GCP Secret Manager

Once deployed, your workflows authenticate via OIDC (no static secrets), and you only need to rotate the actual token in one place (GCP Secret Manager).

## Setup

### 1. Fork this repo

Click "Fork" on GitHub to create your own copy.

### 2. Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) (authenticated)
- A GCP project with these APIs enabled:
  - IAM Service Account Credentials API
  - Secret Manager API
  - Cloud Resource Manager API

```bash
gcloud services enable iamcredentials.googleapis.com secretmanager.googleapis.com cloudresourcemanager.googleapis.com
```

### 3. Configure

```bash
# Clone your fork
git clone git@github.com:YOUR_USERNAME/gcp-github-secrets.git
cd gcp-github-secrets

# Install dependencies
npm install

# Create a Pulumi stack
pulumi stack init prod

# Set required config
pulumi config set gcp-project-id YOUR_GCP_PROJECT_ID
pulumi config set allowed-repositories '["your-username/*"]'  # or specific repos

# Set your secrets (stored encrypted)
pulumi config set --secret secrets '{"npm-token": "npm_xxxx"}'

# Set GCP region (optional)
pulumi config set gcp:region us-central1
```

### 4. Deploy

```bash
pulumi up
```

Note the outputs:
- `workloadIdentityProvider` - use this in your GitHub Actions
- `serviceAccountEmail` - use this in your GitHub Actions

### 5. Use in GitHub Actions

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # Required for OIDC

    steps:
      - uses: actions/checkout@v4

      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/github-secrets-pool/providers/github-secrets-github'
          service_account: 'github-secrets-reader@your-project.iam.gserviceaccount.com'

      - uses: google-github-actions/setup-gcloud@v2

      - name: Get NPM token
        run: |
          NPM_TOKEN=$(gcloud secrets versions access latest --secret=npm-token)
          echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> ~/.npmrc

      - run: npm publish
```

Or use the included composite action:

```yaml
      - uses: YOUR_USERNAME/gcp-github-secrets/action@master
        id: secrets
        with:
          workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/github-secrets-pool/providers/github-secrets-github'
          service_account: 'github-secrets-reader@your-project.iam.gserviceaccount.com'
          secrets: |
            npm-token

      - run: echo "//registry.npmjs.org/:_authToken=${{ steps.secrets.outputs.npm-token }}" >> ~/.npmrc
```

## Rotating secrets

When your NPM token expires, just update it in GCP:

```bash
echo -n "npm_NEW_TOKEN" | gcloud secrets versions add npm-token --data-file=-
```

No changes needed in any of your repositories.

## Configuration reference

| Config Key | Required | Description |
|------------|----------|-------------|
| `gcp-project-id` | Yes | Your GCP project ID |
| `allowed-repositories` | Yes | JSON array of repos (`["owner/repo"]` or `["owner/*"]`) |
| `secrets` | Yes | JSON object of secrets (`{"name": "value"}`) - use `--secret` flag |
| `resource-prefix` | No | Prefix for GCP resources (default: `github-secrets`) |

## Contributing

Pull requests are welcomed on GitHub! To get started:

1. Install Git and Node.js
2. Clone the repository
3. Install dependencies with `npm install`
4. Build with `npm run build`
