import { describe, expect, it, vi } from 'vitest';
import { getPdsVideoPreviewPlayInfo, PdsPreviewError } from './pds-video-preview';

const baseInput = {
  domainId: 'demo-domain',
  driveId: 'drive-1',
  fileId: 'file-1',
  accessToken: 'access-token',
};

describe('getPdsVideoPreviewPlayInfo', () => {
  it('requests the official PDS preview API and returns HLS renditions', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      video_preview_play_info: {
        quick_video_list: [
          { template_id: '264_480p', status: 'finished', url: 'https://media.example/480.m3u8?sig=abc' },
          { template_id: '264_1080p', status: 'processing', url: 'https://media.example/1080.m3u8' },
        ],
      },
    }), { status: 200 }));

    const result = await getPdsVideoPreviewPlayInfo(baseInput, fetcher);

    expect(result).toEqual({
      status: 'ready',
      renditions: [{
        templateId: '264_480p',
        url: 'https://media.example/480.m3u8?sig=abc',
        category: 'quick_video',
      }],
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://demo-domain.api.aliyunpds.com/v2/file/get_video_preview_play_info',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
        body: JSON.stringify({
          domain_id: 'demo-domain',
          file_id: 'file-1',
          category: 'quick_video',
          url_expire_sec: 900,
          get_master_url: false,
          drive_id: 'drive-1',
        }),
      }),
    );
  });

  it('returns a retryable pending state for PDS 202 responses', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      Code: 'VideoPreviewWaitAndRetry',
    }), { status: 202 }));

    await expect(getPdsVideoPreviewPlayInfo(baseInput, fetcher)).resolves.toEqual({
      status: 'pending',
      retryAfterSeconds: 3,
    });
  });

  it('uses only x-share-token auth and never sends a drive id for shared files', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      video_preview_play_info: {
        quick_video_list: [{ status: 'finished', url: 'https://media.example/share.m3u8' }],
      },
    }), { status: 200 }));

    await getPdsVideoPreviewPlayInfo({
      domainId: 'demo-domain',
      fileId: 'shared-file',
      shareId: 'share-1',
      shareToken: 'share-token',
      accessToken: 'must-not-be-used',
    }, fetcher);

    const init = fetcher.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get('x-share-token')).toBe('share-token');
    expect(headers.has('authorization')).toBe(false);
    expect(JSON.parse(String(init.body))).toMatchObject({ share_id: 'share-1' });
    expect(JSON.parse(String(init.body))).not.toHaveProperty('drive_id');
  });

  it('rejects unsafe URLs and incomplete credentials', async () => {
    const unsafeResponse = new Response(JSON.stringify({
      video_preview_play_info: {
        quick_video_list: [{ status: 'finished', url: 'http://media.example/stream.m3u8' }],
      },
    }), { status: 200 });
    await expect(getPdsVideoPreviewPlayInfo(baseInput, async () => unsafeResponse))
      .rejects.toBeInstanceOf(PdsPreviewError);

    await expect(getPdsVideoPreviewPlayInfo({
      domainId: 'demo-domain',
      driveId: 'drive-1',
      fileId: 'file-1',
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('maps expired credentials to an explicit unauthorized error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(getPdsVideoPreviewPlayInfo(baseInput, fetcher))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('maps disabled online transcoding to a setup error', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      Code: 'VideoPreviewDisabled.OnlineVideoTranscode',
    }), { status: 400 }));
    await expect(getPdsVideoPreviewPlayInfo(baseInput, fetcher))
      .rejects.toMatchObject({ code: 'FEATURE_DISABLED', status: 400 });
  });
});
