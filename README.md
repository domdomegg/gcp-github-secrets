# gcp-github-secrets

Use GCP Secret Manager with GitHub Actions OIDC - no more rotating tokens in every repo.

## The problem

NPM (and other services) now require short-lived tokens (90 days max). If you have many repositories, rotating tokens in each one is painful. GitHub Actions OIDC lets you authenticate without static secrets, but setting it up with GCP is fiddly.

## The solution

This package provides:
1. A **Pulumi component** to set up GCP workload identity federation + Secret Manager
2. A **GitHub Action** to fetch secrets in your workflows

Once set up, your workflows authenticate via OIDC (no static secrets), and you only need to rotate the actual NPM token in one place (GCP Secret Manager).

## Setup

### 1. Install the Pulumi package

```bash
npm install gcp-github-secrets
```

### 2. Add to your Pulumi stack

```typescript
import { GcpGithubSecrets } from 'gcp-github-secrets';

const secrets = new GcpGithubSecrets('my-secrets', {
  projectId: 'my-gcp-project',
  allowedRepositories: [
    'myorg/*',              // All repos in an org
    'myuser/specific-repo', // Or specific repos
  ],
  secrets: {
    'npm-token': process.env.NPM_TOKEN!,
  },
});

// Export these for use in GitHub Actions
export const workloadIdentityProvider = secrets.workloadIdentityProvider;
export const serviceAccountEmail = secrets.serviceAccountEmail;
```

### 3. Deploy

```bash
pulumi up
```

Note the outputs - you'll need `workloadIdentityProvider` and `serviceAccountEmail` for your workflows.

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

      - uses: domdomegg/gcp-github-secrets/action@v1
        id: secrets
        with:
          workload_identity_provider: 'projects/123456/locations/global/workloadIdentityPools/github-secrets-pool/providers/github-secrets-github'
          service_account: 'github-secrets-reader@my-project.iam.gserviceaccount.com'
          secrets: |
            npm-token

      - name: Setup npmrc
        run: echo "//registry.npmjs.org/:_authToken=${{ steps.secrets.outputs.npm-token }}" > ~/.npmrc

      - run: npm publish
```

## Rotating secrets

When your NPM token expires, just update it in GCP:

```bash
echo -n "npm_NEW_TOKEN" | gcloud secrets versions add npm-token --data-file=-
```

No changes needed in any of your repositories.

## API

### Pulumi Component: `GcpGithubSecrets`

#### Inputs

| Name | Type | Description |
|------|------|-------------|
| `projectId` | `string` | GCP project ID |
| `allowedRepositories` | `string[]` | Repos allowed to access secrets (`owner/repo` or `owner/*`) |
| `secrets` | `Record<string, string>` | Map of secret names to values |
| `resourcePrefix` | `string` | Optional prefix for resources (default: `github-secrets`) |

#### Outputs

| Name | Type | Description |
|------|------|-------------|
| `workloadIdentityProvider` | `string` | Full provider name for GitHub Actions |
| `serviceAccountEmail` | `string` | Service account email for GitHub Actions |
| `workloadIdentityPoolId` | `string` | The pool ID |
| `workloadIdentityProviderId` | `string` | The provider ID |
| `secretNames` | `Record<string, string>` | Map of secret names |

### GitHub Action

#### Inputs

| Name | Required | Description |
|------|----------|-------------|
| `workload_identity_provider` | Yes | Full workload identity provider name |
| `service_account` | Yes | Service account email |
| `secrets` | Yes | Newline-separated secrets (`SECRET_NAME` or `SECRET_NAME:output_name`) |
| `project_id` | No | GCP project ID |

#### Outputs

Each secret is available as an output with the name specified (or the secret name if not specified).

## Contributing

Pull requests are welcomed on GitHub! To get started:

1. Install Git and Node.js
2. Clone the repository
3. Install dependencies with `npm install`
4. Run `npm run test` to run tests
5. Build with `npm run build`

## Releases

Versions follow the [semantic versioning spec](https://semver.org/).

To release:

1. Use `npm version <major | minor | patch>` to bump the version
2. Run `git push --follow-tags` to push with tags
3. Wait for GitHub Actions to publish to the NPM registry.
