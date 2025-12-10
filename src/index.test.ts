import {describe, it, expect} from 'vitest';
import {GcpGithubSecrets} from './index';

describe('GcpGithubSecrets', () => {
	it('exports the component', () => {
		expect(GcpGithubSecrets).toBeDefined();
		expect(typeof GcpGithubSecrets).toBe('function');
	});
});
