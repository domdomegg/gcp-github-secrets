import * as pulumi from '@pulumi/pulumi';
import * as gcp from '@pulumi/gcp';

const config = new pulumi.Config();

// Required config
const projectId = config.require('gcp-project-id');
const allowedRepositories = config.requireObject<string[]>('allowed-repositories');

// Optional config
const resourcePrefix = config.get('resource-prefix') ?? 'github-secrets';

// Secrets to store (pass via `pulumi config set --secret`)
const secrets = config.requireSecretObject<Record<string, string>>('secrets');

// Enable required GCP APIs
const iamCredentialsApi = new gcp.projects.Service('iam-credentials-api', {
	project: projectId,
	service: 'iamcredentials.googleapis.com',
});

const secretManagerApi = new gcp.projects.Service('secret-manager-api', {
	project: projectId,
	service: 'secretmanager.googleapis.com',
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const cloudResourceManagerApi = new gcp.projects.Service('cloud-resource-manager-api', {
	project: projectId,
	service: 'cloudresourcemanager.googleapis.com',
});

// Create workload identity pool
const pool = new gcp.iam.WorkloadIdentityPool('pool', {
	project: projectId,
	workloadIdentityPoolId: `${resourcePrefix}-pool`,
	displayName: 'GitHub Actions',
	description: 'Workload identity pool for GitHub Actions OIDC',
}, {dependsOn: [iamCredentialsApi]});

// Create OIDC provider for GitHub
const provider = new gcp.iam.WorkloadIdentityPoolProvider('provider', {
	project: projectId,
	workloadIdentityPoolId: pool.workloadIdentityPoolId,
	workloadIdentityPoolProviderId: `${resourcePrefix}-github`,
	displayName: 'GitHub',
	description: 'GitHub Actions OIDC provider',
	attributeMapping: {
		'google.subject': 'assertion.sub',
		'attribute.actor': 'assertion.actor',
		'attribute.repository': 'assertion.repository',
		'attribute.repository_owner': 'assertion.repository_owner',
	},
	oidc: {
		issuerUri: 'https://token.actions.githubusercontent.com',
	},
});

// Create service account for reading secrets
const serviceAccount = new gcp.serviceaccount.Account('sa', {
	project: projectId,
	accountId: `${resourcePrefix}-reader`,
	displayName: 'GitHub Actions Secret Reader',
	description: 'Service account for GitHub Actions to read secrets via OIDC',
});

// Grant service account access to read secrets
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _secretAccessor = new gcp.projects.IAMMember('secret-accessor', {
	project: projectId,
	role: 'roles/secretmanager.secretAccessor',
	member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
});

// Get project number for IAM binding
const project = gcp.organizations.getProjectOutput({
	projectId,
});

// Allow specified repositories to impersonate the service account
for (let i = 0; i < allowedRepositories.length; i++) {
	const repo = allowedRepositories[i];
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const _wifBinding = new gcp.serviceaccount.IAMMember(`wif-${i}`, {
		serviceAccountId: serviceAccount.name,
		role: 'roles/iam.workloadIdentityUser',
		member: pulumi.interpolate`principalSet://iam.googleapis.com/projects/${project.number}/locations/global/workloadIdentityPools/${pool.workloadIdentityPoolId}/attribute.repository/${repo}`,
	});
}

// Create secrets in Secret Manager
secrets.apply((secretsObj) => {
	for (const [secretName, secretValue] of Object.entries(secretsObj)) {
		const secret = new gcp.secretmanager.Secret(`secret-${secretName}`, {
			project: projectId,
			secretId: secretName,
			replication: {
				auto: {},
			},
		}, {dependsOn: [secretManagerApi]});

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const _version = new gcp.secretmanager.SecretVersion(`secret-${secretName}-version`, {
			secret: secret.id,
			secretData: secretValue,
		});
	}
});

// Exports for use in GitHub Actions
export const workloadIdentityProvider = pulumi.interpolate`projects/${project.number}/locations/global/workloadIdentityPools/${pool.workloadIdentityPoolId}/providers/${provider.workloadIdentityPoolProviderId}`;
export const serviceAccountEmail = serviceAccount.email;
