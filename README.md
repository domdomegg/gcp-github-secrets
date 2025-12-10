# gcp-github-secrets

Use GCP Secret Manager with GitHub Actions OIDC - no more rotating tokens in every repo.

## The problem

NPM now requires short-lived tokens (90 days max). If you have many repositories, rotating tokens in each one is painful.

**Why not use GitHub organization secrets?** If your repos are in a GitHub organization, you can set a secret once and share it across all repos. But personal accounts don't have this feature - you'd need to update each repo individually.

**Why not use NPM's OIDC trusted publishing?** NPM supports OIDC, but it has limitations:
- You can't publish *new* packages with OIDC - the first publish must use a token
- There's no API to configure it - you have to click through the npm website for each package, which is tedious if you have many

## The solution

This repo contains a bash script that sets up:
- GCP Workload Identity Federation for GitHub Actions
- A service account with Secret Manager access

Once deployed, your workflows authenticate via OIDC (no static secrets), and you only need to rotate the actual token in one place (GCP Secret Manager).

## Setup

### 1. Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install) (authenticated via `gcloud auth login`)

### 2. Configure and deploy

```bash
# Clone this repo
git clone git@github.com:domdomegg/gcp-github-secrets.git
cd gcp-github-secrets

# Edit setup.sh to set your project ID and allowed repos
vim setup.sh

# Run the setup script
./setup.sh
```

The script will output the values you need for your GitHub Actions workflows.

### 3. Add your secrets to GCP

```bash
# Create a secret (e.g., npm-token)
echo -n "npm_xxxx" | gcloud secrets create npm-token --data-file=- --project=gcp-github-secrets
```

### 4. Use in GitHub Actions

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
          service_account: 'github-secrets-reader@gcp-github-secrets.iam.gserviceaccount.com'

      - uses: google-github-actions/setup-gcloud@v2

      - name: Get NPM token
        run: |
          NPM_TOKEN=$(gcloud secrets versions access latest --secret=npm-token)
          echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" >> ~/.npmrc

      - run: npm publish
```

Or use the included composite action:

```yaml
      - uses: domdomegg/gcp-github-secrets/action@master
        id: secrets
        with:
          workload_identity_provider: 'projects/123456789/locations/global/workloadIdentityPools/github-secrets-pool/providers/github-secrets-github'
          service_account: 'github-secrets-reader@gcp-github-secrets.iam.gserviceaccount.com'
          secrets: |
            npm-token

      - run: echo "//registry.npmjs.org/:_authToken=${{ steps.secrets.outputs.npm-token }}" >> ~/.npmrc
```

## Rotating secrets

When your NPM token expires, just update it in GCP:

```bash
echo -n "npm_NEW_TOKEN" | gcloud secrets versions add npm-token --data-file=- --project=gcp-github-secrets
```

No changes needed in any of your repositories.

## Configuration

Edit these variables at the top of `setup.sh`:

| Variable | Description |
|----------|-------------|
| `PROJECT_ID` | Your GCP project ID |
| `PROJECT_NAME` | Display name for the project |
| `ALLOWED_REPOS` | Comma-separated repos (`owner/repo` or `owner/*`) |
| `RESOURCE_PREFIX` | Prefix for GCP resources (default: `github-secrets`) |

## Contributing

Pull requests are welcomed on GitHub! To get started:

1. Install Git
2. Clone the repository
3. Make your changes to `setup.sh` or `action/`
