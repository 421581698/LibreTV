import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickSaveTarget, sanitizeDownloadFilename, suggestDownloadFilename, UserCancelledError, MAX_MEMORY_DOWNLOAD_BYTES } from './download-saver';

describe('download filename safety', () => {
  it('removes path separators and reserved filename characters', () => {
    const result = sanitizeDownloadFilename('../../evil:name?.mp4');
    expect(result).toBe('_.._evil_name_.mp4');
    expect(result).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('prefixes Windows reserved device names', () => {
    expect(sanitizeDownloadFilename('CON.mp4')).toBe('_CON.mp4');
    expect(sanitizeDownloadFilename('LPT1')).toBe('_LPT1');
  });

  it('removes control and bidirectional override characters', () => {
    expect(sanitizeDownloadFilename('safe\u202Ename\u0000.mp4')).toBe('safename.mp4');
  });

  it('keeps a valid extension when truncating long titles', () => {
    const result = sanitizeDownloadFilename('x'.repeat(240) + '.mp4');
    expect(result.length).toBeLessThanOrEqual(180);
    expect(result.endsWith('.mp4')).toBe(true);
  });

  it('does not cut a Unicode surrogate pair at the filename length limit', () => {
    const result = sanitizeDownloadFilename('x'.repeat(175) + '😀' + '.mp4');
    expect(result).toBe('x'.repeat(175) + '.mp4');
    expect(result.length).toBeLessThanOrEqual(180);
  });

  it('infers a direct media extension from the URL path, not its query string', () => {
    expect(suggestDownloadFilename('Episode 1', 'https://cdn.example.com/media/ep1.mkv?token=secret'))
      .toBe('Episode 1.mkv');
    expect(suggestDownloadFilename('Episode 1.mp4', 'https://cdn.example.com/media/ep1.mkv'))
      .toBe('Episode 1.mp4');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pickSaveTarget file-output lifecycle', () => {
  it('writes and closes a File System Access writer', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const writer = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const createWritable = vi.fn().mockResolvedValue({ getWriter: () => writer });
    const showSaveFilePicker = vi.fn().mockResolvedValue({ createWritable });
    vi.stubGlobal('window', { showSaveFilePicker });

    const target = await pickSaveTarget('episode.mp4');
    expect(target.kind).toBe('fs');
    await target.write(bytes);
    await target.close();

    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'episode.mp4' });
    expect(createWritable).toHaveBeenCalledOnce();
    expect(writer.write).toHaveBeenCalledWith(bytes);
    expect(writer.close).toHaveBeenCalledOnce();
  });

  it('aborts the writable stream when a task fails', async () => {
    const writer = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubGlobal('window', {
      showSaveFilePicker: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({ getWriter: () => writer }),
      }),
    });

    const target = await pickSaveTarget('episode.mp4');
    await target.write(new Uint8Array([9, 8, 7]));
    await target.abort();

    expect(writer.abort).toHaveBeenCalledOnce();
    expect(writer.close).not.toHaveBeenCalled();
  });

  it('maps the native picker AbortError to a deliberate user cancellation', async () => {
    vi.stubGlobal('window', {
      showSaveFilePicker: vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')),
    });
    await expect(pickSaveTarget('episode.mp4')).rejects.toBeInstanceOf(UserCancelledError);
  });

  it('uses OPFS for unknown-length streams and removes partial files on abort', async () => {
    const writer = {
      write: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { storage: {
      estimate: async () => ({ quota: 1024, usage: 0 }),
      getDirectory: async () => ({
        getFileHandle: async () => ({ createWritable: async () => writer }),
        removeEntry,
      }),
    }});
    const target = await pickSaveTarget('unknown.mp4');
    expect(target.kind).toBe('fs');
    await target.write(new Uint8Array([1, 2, 3]));
    await target.abort();
    expect(writer.write).toHaveBeenCalledOnce();
    expect(writer.abort).toHaveBeenCalledOnce();
    expect(writer.close).not.toHaveBeenCalled();
    expect(removeEntry).toHaveBeenCalledOnce();
  });

  it('stages a large file in OPFS and exports the exact written bytes', async () => {
    vi.useFakeTimers();
    const chunks: Uint8Array[] = [];
    const writer = {
      write: vi.fn(async (data: ArrayBuffer) => { chunks.push(new Uint8Array(data)); }),
      close: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
    };
    const handle = {
      createWritable: vi.fn().mockResolvedValue(writer),
      getFile: vi.fn(async () => new Blob(chunks.map(c => c.slice().buffer as ArrayBuffer))),
    };
    const removeEntry = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { storage: {
      estimate: async () => ({ quota: MAX_MEMORY_DOWNLOAD_BYTES * 4, usage: 0 }),
      getDirectory: async () => ({ getFileHandle: async () => handle, removeEntry }),
    }});
    vi.stubGlobal('window', {});
    const click = vi.fn();
    vi.stubGlobal('document', { createElement: () => ({ click, remove: vi.fn() }), body: { appendChild: vi.fn() } });
    let exported: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { exported = blob as Blob; return 'blob:opfs'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const target = await pickSaveTarget('large.mp4', MAX_MEMORY_DOWNLOAD_BYTES + 1);
    await target.write(new Uint8Array([99, 1, 2, 88]).subarray(1, 3));
    await target.write(new Uint8Array([3]));
    await target.close();
    expect(Array.from(new Uint8Array(await exported!.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(click).toHaveBeenCalledOnce();
    vi.runOnlyPendingTimers();
    expect(removeEntry).toHaveBeenCalledOnce();
  });

  it('rejects a known oversized memory download before allocating a Blob', async () => {
    vi.stubGlobal('window', {});
    await expect(pickSaveTarget('big.mp4', MAX_MEMORY_DOWNLOAD_BYTES + 1))
      .rejects.toThrow('安全内存保存上限');
  });

  it('rejects a streamed file once cumulative bytes exceed the budget', async () => {
    vi.stubGlobal('window', {});
    const target = await pickSaveTarget('large.mp4');
    await target.write(new Uint8Array(1024));
    await expect(target.write(new Uint8Array(MAX_MEMORY_DOWNLOAD_BYTES)))
      .rejects.toThrow('浏览器内存保存容量不足');
    await target.abort();
  });

  it('rejects a streaming chunk that exceeds the in-memory budget', async () => {
    vi.stubGlobal('window', {});
    const target = await pickSaveTarget('large.mp4');
    await expect(target.write(new Uint8Array(MAX_MEMORY_DOWNLOAD_BYTES + 1)))
      .rejects.toThrow('浏览器内存保存容量不足');
    await target.abort();
  });

  it('flushes the memory fallback as a browser download on close', async () => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const appendChild = vi.fn();
    const createElement = vi.fn(() => anchor);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download-test');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { createElement, body: { appendChild } });

    const target = await pickSaveTarget('episode.ts');
    expect(target.kind).toBe('memory');
    await target.write(new Uint8Array([1, 2, 3]));
    await target.write(new Uint8Array([4, 5]));
    await target.close();

    expect(createElement).toHaveBeenCalledWith('a');
    expect(anchor.download).toBe('episode.ts');
    expect(anchor.href).toBe('blob:download-test');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();

    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download-test');
  });

  it('preserves only Uint8Array subview bytes in memory downloads', async () => {
    vi.useFakeTimers();
    let saved: Blob | undefined;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      saved = blob as Blob;
      return 'blob:subview';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', click: vi.fn(), remove: vi.fn() }),
      body: { appendChild: vi.fn() },
    });
    const target = await pickSaveTarget('subview.ts');
    await target.write(new Uint8Array([99, 10, 11, 12, 88]).subarray(1, 4));
    await target.close();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(Array.from(new Uint8Array(await saved!.arrayBuffer()))).toEqual([10, 11, 12]);
    vi.runOnlyPendingTimers();
  });

  it('discards buffered bytes on abort instead of creating a partial file', async () => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const createElement = vi.fn(() => anchor);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:must-not-exist');
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { createElement, body: { appendChild: vi.fn() } });

    const target = await pickSaveTarget('episode.ts');
    await target.write(new Uint8Array([1, 2, 3]));
    await target.abort();
    await target.close();

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(anchor.click).not.toHaveBeenCalled();
  });
});
