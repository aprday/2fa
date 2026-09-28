import { describe, expect, it } from 'vitest';

import { SERVICE_FAMILY_ALIASES, SERVICE_FAMILY_NAMES, SERVICE_FUZZY_MATCH_KEYS, SERVICE_LOGOS } from '../../src/ui/config/serviceLogos.js';
import { createServiceAggregation } from '../../src/shared/service-aggregation.js';
import { LOCALES } from '../../src/ui/locales/index.js';
import { getCoreCode } from '../../src/ui/scripts/core.js';
import { getServiceAggregationCode } from '../../src/ui/scripts/serviceAggregation.js';
import { transferI18n } from '../helpers/transfer-i18n.js';

function createHarness(language = 'zh-CN') {
	const code = `
    const SERVICE_LOGOS = ${JSON.stringify(SERVICE_LOGOS)};
    ${getServiceAggregationCode()}
    return {
      normalizeServiceExactName,
      splitServiceWords,
      resolveServiceDomain,
      resolveServiceIdentity,
      getServiceFamilyMetadata,
      groupSecretsByServiceFamily,
      getIdentityCacheSize: () => getServiceCacheSizes().identities,
      getFamilyDomainCacheSize: () => getServiceCacheSizes().familyDomains,
      OTHER_SERVICE_GROUP_KEY,
      UNNAMED_SERVICE_GROUP_KEY
    };
  `;

	// eslint-disable-next-line no-new-func
	return new Function('i18n', `const { t, getLanguage } = i18n; ${code}`)(transferI18n(language));
}

function secret(id, name) {
	return { id, name };
}

describe('service identity resolution', () => {
	const api = createHarness();

	it('normalizes whitespace, full-width text, punctuation, and camel case', () => {
		expect(api.splitServiceWords('  Google\tDrive  ')).toEqual(['google', 'drive']);
		expect(api.splitServiceWords('Ｇｏｏｇｌｅ　Ｄｒｉｖｅ')).toEqual(['google', 'drive']);
		expect(api.splitServiceWords('GoogleDriveBackup')).toEqual(['google', 'drive', 'backup']);
		expect(api.resolveServiceDomain('Google Drive Backup')).toBe('drive.google.com');
		expect(api.resolveServiceDomain('GoogleDriveBackup')).toBe('drive.google.com');
	});

	it('merges services that share a configured account ecosystem', () => {
		const googleNames = ['Google', 'Gmail', 'YouTube', 'GCP', 'Firebase', 'Google Docs'];
		const microsoftNames = ['Microsoft', 'Azure', 'Outlook', 'OneDrive', 'Teams', 'Office 365'];
		const amazonNames = ['Amazon', 'AWS', 'Route53', 'Prime Video', 'amazonaws'];

		expect(new Set(googleNames.map((name) => api.resolveServiceIdentity(name).key))).toEqual(new Set(['domain:google.com']));
		expect(new Set(microsoftNames.map((name) => api.resolveServiceIdentity(name).key))).toEqual(new Set(['domain:microsoft.com']));
		expect(new Set(amazonNames.map((name) => api.resolveServiceIdentity(name).key))).toEqual(new Set(['domain:amazon.com']));
		expect(api.resolveServiceIdentity('Jira').key).toBe(api.resolveServiceIdentity('Confluence').key);
	});

	it('recognizes configured services written as hostnames or URLs', () => {
		const googleKey = api.resolveServiceIdentity('Google').key;

		expect(api.resolveServiceIdentity('drive.google.com').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('accounts.google.com').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('accounts.google.com:443/signin').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('https://accounts.google.com/signin?continue=%2F').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('//drive.google.com/path').key).toBe(googleKey);
		expect(api.resolveServiceIdentity('https://accounts.google.com./signin').key).toBe(googleKey);
		expect(api.resolveServiceDomain('unknown.example')).toBeNull();
		expect(api.resolveServiceDomain('https://google.com.evil.example/signin')).toBeNull();
	});

	it('uses an unambiguous normalized exact-name index for every configured service', () => {
		expect(api.resolveServiceIdentity('Apple Music').key).toBe(api.resolveServiceIdentity('AppleMusic').key);
		expect(api.resolveServiceIdentity('applemusic').key).toBe(api.resolveServiceIdentity('apple_music').key);
		expect(api.resolveServiceIdentity('Stack Overflow').key).toBe(api.resolveServiceIdentity('Stack-Overflow').key);
		expect(api.resolveServiceIdentity('stackoverflow').key).toBe(api.resolveServiceIdentity('stack.overflow').key);
	});

	it('does not turn short or partial names into unrelated brands', () => {
		expect(api.resolveServiceDomain('Project X')).toBeNull();
		expect(api.resolveServiceDomain('Amazonian Bank')).toBeNull();
		expect(api.resolveServiceDomain('Box Office')).toBeNull();
		expect(api.resolveServiceDomain('Line Manager')).toBeNull();
		expect(api.resolveServiceDomain('Max Planck Institute')).toBeNull();
		expect(api.resolveServiceDomain('Medium Rare')).toBeNull();
		expect(api.resolveServiceDomain('Wise Guys')).toBeNull();
		expect(api.resolveServiceDomain('constructor')).toBeNull();
		expect(api.resolveServiceDomain('__proto__')).toBeNull();
		expect(api.resolveServiceIdentity('MyService').key).toBe(api.resolveServiceIdentity('my.service').key);
		expect(api.resolveServiceIdentity('MyService').key).toBe(api.resolveServiceIdentity('Ｍｙ　Ｓｅｒｖｉｃｅ').key);
	});

	it('recognizes configured brands with camel-cased or descriptive suffixes', () => {
		expect(api.resolveServiceDomain('GitHub Enterprise')).toBe('github.com');
		expect(api.resolveServiceDomain('YouTube Premium')).toBe('youtube.com');
		expect(api.resolveServiceDomain('OneDrive Business')).toBe('onedrive.live.com');
		expect(api.resolveServiceDomain('ChatGPT Team')).toBe('openai.com');
		expect(api.resolveServiceDomain('PayPal Business')).toBe('paypal.com');
		expect(api.resolveServiceDomain('AWSConsole')).toBe('aws.amazon.com');
	});

	it('keeps punctuation-sensitive exact mappings distinct', () => {
		expect(api.resolveServiceDomain('yandex.mail')).toBe('yandex.com');
		expect(api.resolveServiceDomain('yandex mail')).toBe('yandex.ru');
		expect(api.resolveServiceDomain('YandexMail')).toBeNull();
	});

	it('caches resolved identities by service name', () => {
		const before = api.getIdentityCacheSize();
		api.resolveServiceIdentity('GitHub Enterprise Cache Test');
		const afterFirstResolve = api.getIdentityCacheSize();
		api.resolveServiceIdentity('GitHub Enterprise Cache Test');

		expect(afterFirstResolve).toBe(before + 1);
		expect(api.getIdentityCacheSize()).toBe(afterFirstResolve);
	});

	it('bounds dynamic identity and family-domain caches', () => {
		for (let index = 0; index < 5000; index++) {
			api.resolveServiceIdentity('tenant-' + index + '.google.com');
		}

		expect(api.getIdentityCacheSize()).toBeLessThanOrEqual(4096);
		expect(api.getFamilyDomainCacheSize()).toBeLessThanOrEqual(4096);
	});
});

describe('automatic service grouping', () => {
	const api = createHarness();
	const allSecrets = [
		secret('google', 'Google'),
		secret('gmail', 'Gmail'),
		secret('youtube', 'YouTube'),
		secret('microsoft', 'Microsoft'),
		secret('outlook', 'Outlook'),
		secret('github', 'GitHub'),
		secret('discord', 'Discord'),
	];

	it('creates groups for families with at least two entries and puts singletons last', () => {
		const groups = api.groupSecretsByServiceFamily(allSecrets, allSecrets);

		expect(groups.map((group) => group.name)).toEqual(['Google', 'Microsoft', '其他服务']);
		expect(groups.map((group) => group.totalCount)).toEqual([3, 2, 2]);
		expect(groups.at(-1).key).toBe(api.OTHER_SERVICE_GROUP_KEY);
		expect(groups.flatMap((group) => group.items.map((item) => item.id)).sort()).toEqual(allSecrets.map((item) => item.id).sort());
	});

	it('sorts aggregate service names in the selected name direction and keeps other services last', () => {
		const ascendingGroups = api.groupSecretsByServiceFamily(allSecrets, allSecrets, 'name-asc');
		const descendingGroups = api.groupSecretsByServiceFamily(allSecrets, allSecrets, 'name-desc');

		expect(ascendingGroups.map((group) => group.name)).toEqual(['Google', 'Microsoft', '其他服务']);
		expect(descendingGroups.map((group) => group.name)).toEqual(['Microsoft', 'Google', '其他服务']);
	});

	it('uses totals from the full list when a search only leaves part of a family visible', () => {
		const visibleSecrets = allSecrets.filter((item) => item.id === 'gmail' || item.id === 'youtube');
		const groups = api.groupSecretsByServiceFamily(visibleSecrets, allSecrets);

		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ name: 'Google', matchedCount: 2, totalCount: 3 });
	});

	it('preserves the incoming item order inside each group', () => {
		const visibleSecrets = [allSecrets[2], allSecrets[0], allSecrets[1]];
		const [googleGroup] = api.groupSecretsByServiceFamily(visibleSecrets, allSecrets);

		expect(googleGroup.items.map((item) => item.id)).toEqual(['youtube', 'google', 'gmail']);
	});

	it('uses configured brand casing for mixed service-name variants', () => {
		const githubSecrets = [secret('github', 'GitHub'), secret('github-enterprise', 'GitHub Enterprise')];
		const [githubGroup] = api.groupSecretsByServiceFamily(githubSecrets, githubSecrets);

		expect(githubGroup.name).toBe('GitHub');
	});

	it('reuses full-list metadata and invalidates it after in-place name or list changes', () => {
		const mutableSecrets = [secret('one', 'Acme Service'), secret('two', 'Acme.Service')];
		const initialMetadata = api.getServiceFamilyMetadata(mutableSecrets);

		expect(api.getServiceFamilyMetadata(mutableSecrets)).toBe(initialMetadata);

		mutableSecrets[1].name = 'Google';
		const renamedMetadata = api.getServiceFamilyMetadata(mutableSecrets);
		expect(renamedMetadata).not.toBe(initialMetadata);

		mutableSecrets.push(secret('three', 'Gmail'));
		const appendedMetadata = api.getServiceFamilyMetadata(mutableSecrets);
		expect(appendedMetadata).not.toBe(renamedMetadata);
		expect(api.groupSecretsByServiceFamily(mutableSecrets, mutableSecrets).map((group) => group.name)).toEqual(['Google', '其他服务']);
	});

	it('keeps repeated 1000-entry grouping on the cached metadata path', () => {
		const manySecrets = Array.from({ length: 1000 }, (_, index) =>
			secret(String(index), index % 2 === 0 ? 'Google Workspace ' + index : 'Microsoft Tenant ' + index),
		);

		const initialMetadata = api.getServiceFamilyMetadata(manySecrets);
		for (let iteration = 0; iteration < 20; iteration++) {
			const groups = api.groupSecretsByServiceFamily(manySecrets, manySecrets);
			expect(groups).toHaveLength(2);
			expect(api.getServiceFamilyMetadata(manySecrets)).toBe(initialMetadata);
		}
	});

	it('wires aggregate group order independently from item sorting', () => {
		expect(getCoreCode()).toContain('groupSecretsByServiceFamily(sortedSecrets, secrets, currentGroupSortType)');
	});
});

describe('accounts without a service name', () => {
	const unnamed = [secret('a', ''), secret('b', '   '), secret('c', null)];

	it.each([
		['zh-CN', LOCALES['zh-CN'].transferUnnamed],
		['zh-TW', LOCALES['zh-TW'].transferUnnamed],
		['en', LOCALES.en.transferUnnamed],
	])('groups them under an internal key with the card label of %s', (language, title) => {
		const api = createHarness(language);
		const groups = api.groupSecretsByServiceFamily(unnamed, unnamed);

		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ key: api.UNNAMED_SERVICE_GROUP_KEY, name: title, isOther: false, totalCount: 3 });
		expect(groups[0].items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
	});

	it('never merges them with a service that is really called Unknown service', () => {
		const api = createHarness('zh-CN');
		const all = [...unnamed, secret('d', '未知服务'), secret('e', '未知服务')];
		const groups = api.groupSecretsByServiceFamily(all, all);

		expect(groups.map((group) => [group.name, group.items.map((item) => item.id)])).toEqual([
			['未命名', ['a', 'b', 'c']],
			['未知服务', ['d', 'e']],
		]);
		expect(groups[1].key).toBe('name:未知服务');
		expect(api.resolveServiceIdentity('').key).toBe(api.UNNAMED_SERVICE_GROUP_KEY);
		expect(api.resolveServiceIdentity('__unnamed-service__').key).not.toBe(api.UNNAMED_SERVICE_GROUP_KEY);
	});

	it('puts a single one into the other services group', () => {
		const api = createHarness('en');
		const all = [secret('a', ''), secret('g1', 'GitHub'), secret('g2', 'GitHub')];
		const groups = api.groupSecretsByServiceFamily(all, all);

		expect(groups.at(-1)).toMatchObject({ key: api.OTHER_SERVICE_GROUP_KEY, name: LOCALES.en.otherServices });
		expect(groups.at(-1).items.map((item) => item.id)).toEqual(['a']);
	});

	it('takes the group title from the adapter each time, so a language change applies at once', () => {
		let title = 'First';
		const aggregation = createServiceAggregation({
			SERVICE_LOGOS,
			SERVICE_FAMILY_ALIASES,
			SERVICE_FAMILY_NAMES,
			SERVICE_FUZZY_MATCH_KEYS,
			getUnnamedServiceGroupName: () => title,
		});
		expect(aggregation.groupSecretsByServiceFamily(unnamed, unnamed)[0].name).toBe('First');
		title = 'Second';
		expect(aggregation.groupSecretsByServiceFamily(unnamed, unnamed)[0].name).toBe('Second');
	});
});
