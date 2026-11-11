import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLivePrivateHostAllowed } from './live-private-hosts';
import { checkLiveUrlAllowed, isPrivateIP, isValidProxyUrl } from './ssrf';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isPrivateIP', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['192.168.1.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['100.127.255.255', true],
    ['100.128.0.1', false],
    ['0.1.2.3', true],
    ['192.0.2.10', true],
    ['198.18.0.1', true],
    ['198.19.255.254', true],
    ['198.51.100.2', true],
    ['203.0.113.8', true],
    ['224.0.0.1', true],
    ['240.0.0.1', true],
    ['::1', true],
    ['fe80::1', true],
    ['fd00::1', true],
    ['8.8.8.8', false],
    ['1.2.3.4', false],
    // URL.hostname 对 IPv6 会带方括号
    ['[::1]', true],
    ['[fe80::1]', true],
    ['[fd00::1]', true],
    ['[fe90::1]', true],
    ['[ff02::1]', true],
    ['[2001:db8::1]', true],
    ['[fc00::1]', true],
    // IPv4-mapped IPv6：十六进制形式与点分形式
    ['[::ffff:c0a8:164]', true], // ::ffff:192.168.1.100
    ['::ffff:192.168.1.100', true],
    ['[::ffff:7f00:1]', true], // ::ffff:127.0.0.1
    ['::ffff:127.0.0.1', true],
    ['[::ffff:a9fe:a9fe]', true], // ::ffff:169.254.169.254
    ['[::ffff:a00:1]', true], // ::ffff:10.0.0.1
    ['[::ffff:808:808]', false], // ::ffff:8.8.8.8 公网
    ['::ffff:8.8.8.8', false],
    ['[::ffff:c0a8:164', true], // 单边括号（异常输入）仍要拦
    ['[2606:4700::1111]', false], // 公网 IPv6 不应被误杀
  ])('%s → %s', (ip, expected) => {
    expect(isPrivateIP(ip)).toBe(expected);
  });
});

describe('isValidProxyUrl', () => {
  it('放行公网 http(s)', () => {
    expect(isValidProxyUrl('https://cdn.example.com/a.m3u8')).toBe(true);
    expect(isValidProxyUrl('http://1.2.3.4/x.ts')).toBe(true);
  });

  it('拦截内网与保留地址', () => {
    expect(isValidProxyUrl('http://localhost/x')).toBe(false);
    expect(isValidProxyUrl('http://127.0.0.1/x')).toBe(false);
    expect(isValidProxyUrl('http://192.168.1.1/x')).toBe(false);
    expect(isValidProxyUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  it('拦截带方括号的 IPv6 与 IPv4-mapped 写法', () => {
    expect(isValidProxyUrl('http://[::1]:8080/x')).toBe(false);
    expect(isValidProxyUrl('http://[::ffff:192.168.1.100]:8080/list.m3u')).toBe(false);
    expect(isValidProxyUrl('http://[::ffff:127.0.0.1]/x')).toBe(false);
    expect(isValidProxyUrl('http://[fe80::1]/x')).toBe(false);
    expect(isValidProxyUrl('http://[fd00::1]/x')).toBe(false);
  });

  it('不误杀公网 IPv6', () => {
    expect(isValidProxyUrl('http://[2606:4700::1111]/x')).toBe(true);
  });

  it('拦截非 http 协议', () => {
    expect(isValidProxyUrl('file:///etc/passwd')).toBe(false);
    expect(isValidProxyUrl('ftp://x.com/a')).toBe(false);
    expect(isValidProxyUrl('not a url')).toBe(false);
  });
});


describe('private live host allowlist', () => {
  it('does not enable private targets from LIVE_ALLOW_PRIVATE alone', async () => {
    vi.stubEnv('LIVE_ALLOW_PRIVATE', '1');
    vi.stubEnv('LIVE_PRIVATE_HOSTS', '');
    await expect(checkLiveUrlAllowed('http://192.168.1.20:8080/list.m3u')).resolves.toEqual({
      ok: false,
      reason: '目标地址不在允许范围内（仅支持公网 http/https）',
    });
  });

  it('allows an exact private IPv4 host only when both deployment settings match', async () => {
    vi.stubEnv('LIVE_ALLOW_PRIVATE', '1');
    vi.stubEnv('LIVE_PRIVATE_HOSTS', '192.168.1.20, media.lan');
    await expect(checkLiveUrlAllowed('http://192.168.1.20:8080/list.m3u')).resolves.toEqual({ ok: true });
    expect(isLivePrivateHostAllowed('http://media.lan:8080/list.m3u')).toBe(true);
  });

  it('uses exact hostname matching, not suffix or wildcard matching', () => {
    vi.stubEnv('LIVE_ALLOW_PRIVATE', '1');
    vi.stubEnv('LIVE_PRIVATE_HOSTS', 'media.example.com');
    expect(isLivePrivateHostAllowed('http://media.example.com/list.m3u')).toBe(true);
    expect(isLivePrivateHostAllowed('http://evil-media.example.com/list.m3u')).toBe(false);
    expect(isLivePrivateHostAllowed('http://sub.media.example.com/list.m3u')).toBe(false);
  });

  it('normalizes case, trailing dots, and IPv6 brackets', () => {
    vi.stubEnv('LIVE_ALLOW_PRIVATE', '1');
    vi.stubEnv('LIVE_PRIVATE_HOSTS', 'MEDIA.LAN., [fd00::10]');
    expect(isLivePrivateHostAllowed('http://media.lan/list.m3u')).toBe(true);
    expect(isLivePrivateHostAllowed('http://[fd00::10]:8080/list.m3u')).toBe(true);
  });

  it('rejects non-http protocols and remains disabled without the opt-in switch', () => {
    vi.stubEnv('LIVE_ALLOW_PRIVATE', 'false');
    vi.stubEnv('LIVE_PRIVATE_HOSTS', 'media.lan');
    expect(isLivePrivateHostAllowed('file:///etc/passwd')).toBe(false);
    expect(isLivePrivateHostAllowed('http://media.lan/list.m3u')).toBe(false);
  });
});
