import * as pulumi from '@pulumi/pulumi';
import * as gcp from '@pulumi/gcp';

export type GcpGithubSecretsArgs = {
	/**
   * GCP project ID where resources will be created
   */
	projectId: pulumi.Input<string>;

	/**
   * GitHub repositories allowed to access secrets.
   * Use 'owner/repo' for a specific repo, or 'owner/*' for all repos in an org/user.
   * @example ['domdomegg/my-repo', 'domdomegg/other-repo']
   * @example ['my-org/*']
   */
	allowedRepositories: pulumi.Input<string>[];

	/**
   * Secrets to create in GCP Secret Manager.
   * Map of secret name to secret value.
   * @example { 'npm-token': 'npm_xxxx', 'other-secret': 'value' }
   */
	secrets: Record<string, pulumi.Input<string>>;

	/**
   * Optional name prefix for created resources.
   * @default 'github-secrets'
   */
	resourcePrefix?: string;
};

export class GcpGithubSecrets extends pulumi.ComponentResource {
	/**
   * The workload identity pool ID
   */
	public readonly workloadIdentityPoolId: pulumi.Output<string>;

	/**
   * The workload identity provider ID
   */
	public readonly workloadIdentityProviderId: pulumi.Output<string>;

	/**
   * The service account email
   */
	public readonly serviceAccountEmail: pulumi.Output<string>;

	/**
   * Full workload identity provider name (for use in GitHub Actions)
   */
	public readonly workloadIdentityProvider: pulumi.Output<string>;

	/**
   * Map of secret names to their GCP resource names
   */
	public readonly secretNames: pulumi.Output<Record<string, string>>;

	constructor(name: string, args: GcpGithubSecretsArgs, opts?: pulumi.ComponentResourceOptions) {
		super('gcp-github-secrets:index:GcpGithubSecrets', name, {}, opts);

		const prefix = args.resourcePrefix ?? 'github-secrets';

		// Create workload identity pool
		const pool = new gcp.iam.WorkloadIdentityPool(`${name}-pool`, {
			project: args.projectId,
			workloadIdentityPoolId: `${prefix}-pool`,
			displayName: 'GitHub Actions',
			description: 'Workload identity pool for GitHub Actions OIDC',
		}, {parent: this});

		// Create OIDC provider for GitHub
		const provider = new gcp.iam.WorkloadIdentityPoolProvider(`${name}-provider`, {
			project: args.projectId,
			workloadIdentityPoolId: pool.workloadIdentityPoolId,
			workloadIdentityPoolProviderId: `${prefix}-github`,
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
		}, {parent: this});

		// Create service account for reading secrets
		const serviceAccount = new gcp.serviceaccount.Account(`${name}-sa`, {
			project: args.projectId,
			accountId: `${prefix}-reader`,
			displayName: 'GitHub Actions Secret Reader',
			description: 'Service account for GitHub Actions to read secrets via OIDC',
		}, {parent: this});

		// Grant service account access to read secrets
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const _secretAccessor = new gcp.projects.IAMMember(`${name}-secret-accessor`, {
			project: args.projectId,
			role: 'roles/secretmanager.secretAccessor',
			member: pulumi.interpolate`serviceAccount:${serviceAccount.email}`,
		}, {parent: this});

		// Get project number for IAM binding
		const project = gcp.organizations.getProjectOutput({
			projectId: args.projectId,
		});

		// Allow specified repositories to impersonate the service account
		for (let i = 0; i < args.allowedRepositories.length; i++) {
			const repo = args.allowedRepositories[i];
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const _wifBinding = new gcp.serviceaccount.IAMMember(`${name}-wif-${i}`, {
				serviceAccountId: serviceAccount.name,
				role: 'roles/iam.workloadIdentityUser',
				member: pulumi.interpolate`principalSet://iam.googleapis.com/projects/${project.number}/locations/global/workloadIdentityPools/${pool.workloadIdentityPoolId}/attribute.repository/${repo}`,
			}, {parent: this});
		}

		// Create secrets
		const secretResourceNames: Record<string, pulumi.Output<string>> = {};
		for (const [secretName, secretValue] of Object.entries(args.secrets)) {
			const secret = new gcp.secretmanager.Secret(`${name}-secret-${secretName}`, {
				project: args.projectId,
				secretId: secretName,
				replication: {
					auto: {},
				},
			}, {parent: this});

			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const _version = new gcp.secretmanager.SecretVersion(`${name}-secret-${secretName}-version`, {
				secret: secret.id,
				secretData: secretValue,
			}, {parent: this});

			secretResourceNames[secretName] = secret.secretId;
		}

		// Set outputs
		this.workloadIdentityPoolId = pool.workloadIdentityPoolId;
		this.workloadIdentityProviderId = provider.workloadIdentityPoolProviderId;
		this.serviceAccountEmail = serviceAccount.email;
		this.workloadIdentityProvider = pulumi.interpolate`projects/${project.number}/locations/global/workloadIdentityPools/${pool.workloadIdentityPoolId}/providers/${provider.workloadIdentityPoolProviderId}`;
		this.secretNames = pulumi.output(secretResourceNames).apply((names) => {
			const result: Record<string, string> = {};
			for (const [k, v] of Object.entries(names)) {
				result[k] = v;
			}

			return result;
		});

		this.registerOutputs({
			workloadIdentityPoolId: this.workloadIdentityPoolId,
			workloadIdentityProviderId: this.workloadIdentityProviderId,
			serviceAccountEmail: this.serviceAccountEmail,
			workloadIdentityProvider: this.workloadIdentityProvider,
			secretNames: this.secretNames,
		});
	}
}
