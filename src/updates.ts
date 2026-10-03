import { VERSION } from './version.js';

export const RELEASES_URL = 'https://github.com/zs-andy/lms-cli/releases';
export const RELEASE_API = 'https://api.github.com/repos/zs-andy/lms-cli/releases/latest';
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseVersion(input: string) {
  const match = input.length <= 100 ? VERSION_RE.exec(input.replace(/^v/, '')) : null;
  if (!match) return null;
  const core = match.slice(1, 4).map(Number);
  const pre = match[4]?.split('.') ?? [];
  if (core.some(n => !Number.isSafeInteger(n)) || pre.some(p => /^\d+$/.test(p) && (p.length > 1 && p.startsWith('0') || !Number.isSafeInteger(Number(p))))) return null;
  return { core, pre };
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) throw new Error('Invalid version');
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return left.core[i]! > right.core[i]! ? 1 : -1;
  if (!left.pre.length || !right.pre.length) return left.pre.length ? -1 : right.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) > Number(y) ? 1 : -1;
    if (xn !== yn) return xn ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function portableAsset(version: string, platform = process.platform, arch = process.arch) {
  if (!parseVersion(version) || !['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) return null;
  return `lms-cli-${version.replace(/^v/, '')}-${platform}-${arch}.tar.gz`;
}

export type UpdateInfo = {
  status: 'available' | 'current' | 'ahead' | 'unavailable' | 'no-release' | 'disabled';
  current: string;
  latest?: string;
  checkedAt: string;
  releaseUrl: string;
  asset?: { name: string; url: string };
  checksumUrl?: string;
  message: string;
};

async function readBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error('Empty release response');
  const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Release response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

/** Fixed public endpoint only: no school origins, identifiers, credentials or user-supplied URLs. */
export async function fetchRelease(fetcher: typeof fetch = fetch, timeoutMs = 6000) {
  const response = await fetcher(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lms-cli-update-check' },
    signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
  });
  if (response.status === 404) return null;
  if (!response.ok || !response.body) throw new Error('Release check unavailable');
  return JSON.parse((await readBody(response, 1024 * 1024)).toString('utf8')) as unknown;
}

/** Hosts a GitHub release redirect may pass through; the updater's downloader enforces the same list. */
export const TRUSTED_RELEASE_HOSTS = ['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
const LATEST_URL = `${RELEASES_URL}/latest`;
const LATEST_TAG_PATH = /^\/zs-andy\/lms-cli\/releases\/tag\/(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/;
const REDIRECTS = [301, 302, 303, 307, 308];
/** A failure worth one more attempt: an unexpected status from github.com, as opposed to a validation failure. */
class TransientLookupError extends Error {}
const trusted = (url: URL) => url.protocol === 'https:' && !url.username && !url.password && !url.port && TRUSTED_RELEASE_HOSTS.includes(url.hostname);

/**
 * Release lookup that does not use the GitHub REST API. Anonymous REST calls are limited to 60 per hour per IP,
 * which shared campus or VPN addresses exhaust, so the check used to fail there. github.com web pages are not
 * subject to that limit. /releases/latest redirects to the newest stable (non-draft, non-prerelease) tag, which is
 * one request when already up to date. Only when a newer version exists, the installer for this platform and
 * SHA256SUMS.txt are checked in parallel: a download URL answers 302 when the asset exists and 404 when it does not,
 * so no redirect is followed and no file is read. Only fixed github.com URLs are requested, redirects are never
 * followed automatically and must point at GitHub's own hosts, and no school data or credentials are sent.
 * The result has the shape of a REST release so inspectRelease validates both sources identically.
 */
export async function fetchLatestFromWeb(fetcher: typeof fetch = fetch, options: { current?: string; platform?: NodeJS.Platform; arch?: NodeJS.Architecture; timeoutMs?: number } = {}) {
  const { current = VERSION, platform = process.platform, arch = process.arch, timeoutMs = 8000 } = options;
  const signal = AbortSignal.timeout(timeoutMs), headers = { 'User-Agent': 'lms-cli-update-check' };
  const probe = async (url: string) => {
    const response = await fetcher(url, { headers, signal, redirect: 'manual' });
    await response.body?.cancel().catch(() => {});
    return response;
  };
  const latest = await probe(LATEST_URL);
  const location = REDIRECTS.includes(latest.status) ? latest.headers.get('location') : null;
  if (!location) throw new TransientLookupError('Release check unavailable');
  const target = new URL(location, LATEST_URL);
  if (!trusted(target) || target.hostname !== 'github.com' || target.search || target.hash) throw new Error('Unexpected release redirect');
  // With no stable release GitHub sends /releases/latest back to the release list.
  if (target.pathname.replace(/\/$/, '') === '/zs-andy/lms-cli/releases') return null;
  const tag = LATEST_TAG_PATH.exec(target.pathname)?.[1];
  if (!tag) throw new Error('Unexpected release redirect');
  const wanted = parseVersion(tag) && compareVersions(tag, current) > 0 ? [portableAsset(tag, platform, arch), 'SHA256SUMS.txt'].filter((name): name is string => Boolean(name)) : [];
  const present = await Promise.all(wanted.map(async name => {
    const url = `${RELEASES_URL}/download/${tag}/${name}`, response = await probe(url);
    if (response.status === 404) return undefined;
    if (!REDIRECTS.includes(response.status)) throw new TransientLookupError('Release check unavailable');
    const next = response.headers.get('location');
    if (!next || !trusted(new URL(next, url))) throw new Error('Unexpected asset redirect');
    return name;
  }));
  const assets = present.filter((name): name is string => Boolean(name)).map(name => ({ name, state: 'uploaded', browser_download_url: `${RELEASES_URL}/download/${tag}/${name}` }));
  return { tag_name: tag, draft: false, prerelease: false, assets } as unknown;
}

/**
 * Network failures (a TypeError from fetch, e.g. a connection reset) and unexpected statuses are retried once on the
 * web pages before the REST API is used; timeouts and validation failures are not, so a slow or hostile response
 * never doubles the wait or the traffic.
 */
const transient = (error: unknown) => error instanceof TransientLookupError || error instanceof TypeError;

/** Web pages first (no API quota); the REST endpoint is only a fallback when github.com pages are unreachable. */
async function latestRelease(fetcher: typeof fetch | undefined, current: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await fetchLatestFromWeb(fetcher, { current }); }
    catch (error) { if (!transient(error)) break; }
  }
  return fetchRelease(fetcher, 4000);
}

export function inspectRelease(data: unknown, current = VERSION, platform = process.platform, arch = process.arch): UpdateInfo {
  const base = { current, checkedAt: new Date().toISOString(), releaseUrl: RELEASES_URL };
  if (data === null) return { ...base, status: 'no-release', message: '尚无可用的稳定版 Release；不会安装预览版或同名 npm 包。' };
  const release = data as Record<string, unknown>;
  const tag = release?.tag_name;
  if (typeof tag !== 'string' || !/^v\d/.test(tag) || !parseVersion(tag) || release.draft !== false || release.prerelease !== false || parseVersion(tag)!.pre.length || !Array.isArray(release.assets)) throw new Error('Invalid release metadata');
  const latest = tag.slice(1), releaseUrl = `${RELEASES_URL}/tag/${encodeURIComponent(tag)}`;
  const assetName = portableAsset(latest, platform, arch);
  const assets = release.assets;
  const find = (name: string) => assets.find((a: any) => a?.name === name && a?.state === 'uploaded' && a?.browser_download_url === `${RELEASES_URL}/download/${tag}/${name}`) as { name: string; browser_download_url: string } | undefined;
  const asset = assetName ? find(assetName) : undefined, checksum = find('SHA256SUMS.txt');
  const comparison = compareVersions(latest, current);
  const status = comparison > 0 ? 'available' : comparison < 0 ? 'ahead' : 'current';
  return {
    ...base, latest, releaseUrl, status,
    ...(asset && checksum ? { asset: { name: asset.name, url: asset.browser_download_url }, checksumUrl: checksum.browser_download_url } : {}),
    message: status === 'available' ? `发现新版本 ${latest}。运行 lms update 查看并确认升级；账号配置和凭据会保留。${asset && checksum ? '' : ' 当前系统的自包含安装包或校验和尚未发布，请查看 Release。'}`
      : status === 'ahead' ? '当前版本比已发布稳定版更新，不会自动降级。' : '当前已是最新稳定版。',
  };
}

export async function checkForUpdates(options: { automatic?: boolean; fetcher?: typeof fetch; current?: string } = {}): Promise<UpdateInfo> {
  const current = options.current ?? VERSION;
  const base = { current, checkedAt: new Date().toISOString(), releaseUrl: RELEASES_URL };
  if (options.automatic && process.env.LMS_UPDATE_CHECK === '0') return { ...base, status: 'disabled', message: '已通过 LMS_UPDATE_CHECK=0 关闭自动更新检查。' };
  try { return inspectRelease(await latestRelease(options.fetcher, current), current); }
  catch { return { ...base, status: 'unavailable', message: '暂时无法检查更新（网络、限流或发布信息不可用）。现有查询不受影响；可稍后运行 lms update --check 重试。' }; }
}

/**
 * One request per MCP session, deferred until the first user call; never on the stdio protocol channel.
 * A failed check is not cached for the whole session: a later call retries after UPDATE_RETRY_MS, so a
 * single slow or rate-limited request cannot silence the update notice until the client restarts.
 */
export const UPDATE_RETRY_MS = 60_000;
let sessionCheck: Promise<UpdateInfo> | undefined;
let sessionFailedAt: number | undefined;
export function resetSessionUpdate() { sessionCheck = undefined; sessionFailedAt = undefined; }
export function sessionUpdate(options: { fetcher?: typeof fetch; now?: () => number } = {}): Promise<UpdateInfo> {
  const now = (options.now ?? Date.now)();
  if (sessionFailedAt !== undefined && now - sessionFailedAt >= UPDATE_RETRY_MS) resetSessionUpdate();
  return sessionCheck ??= checkForUpdates({ automatic: true, fetcher: options.fetcher }).then(info => {
    if (info.status === 'unavailable') sessionFailedAt = now;
    return info;
  });
}
