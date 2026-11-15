export function triggerBlobDownload(blobUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function downloadSmallFileViaFetch(
  url: string,
  filename: string
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        throw new Error(`Download failed (${res.status})`);
      }
      const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
      if (ctype.includes('text/html')) {
        throw new Error('Proxy returned an HTML check instead of the file.');
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      triggerBlobDownload(blobUrl, filename);
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('File download failed.');
}

const DOWNLOAD_CHUNK_BYTES = 5 * 1024 * 1024; // Keeps every HTTP response well below Cloud Run's 32MB ceiling

export async function downloadJobVideoInChunks(
  jobId: string,
  filename: string,
  knownTotalBytes?: number,
  onProgress?: (pct: number, loadedBytes: number, totalBytes: number) => void
): Promise<string> {
  let totalBytes = knownTotalBytes && knownTotalBytes > 0 ? knownTotalBytes : 0;

  if (!totalBytes) {
    const metaRes = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
      credentials: 'include',
    });
    if (!metaRes.ok) {
      throw new Error('Rendered video session was not found.');
    }
    const meta = (await metaRes.json()) as { fileSizeBytes?: number };
    totalBytes = Number(meta.fileSizeBytes ?? 0);
  }

  const buffers: ArrayBuffer[] = [];
  let offset = 0;

  while (true) {
    const reqLen = totalBytes > 0
      ? Math.min(DOWNLOAD_CHUNK_BYTES, Math.max(1, totalBytes - offset))
      : DOWNLOAD_CHUNK_BYTES;

    let chunkBuf: ArrayBuffer | null = null;
    let headerTotal = totalBytes;
    let lastErr: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(
          `/api/jobs/${encodeURIComponent(jobId)}/chunk?offset=${offset}&length=${reqLen}`,
          { credentials: 'include' }
        );
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(errBody.error || `Chunk download failed (${res.status})`);
        }
        const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
        if (ctype.includes('text/html')) {
          throw new Error('Proxy cookie check intercepted the request. Retrying...');
        }
        const totalHdr = Number(res.headers.get('x-total-bytes') ?? '0');
        if (Number.isFinite(totalHdr) && totalHdr > 0) {
          headerTotal = totalHdr;
        }
        chunkBuf = await res.arrayBuffer();
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    }

    if (!chunkBuf) {
      throw lastErr instanceof Error ? lastErr : new Error('Failed to download video chunk.');
    }

    totalBytes = headerTotal || totalBytes;
    if (chunkBuf.byteLength === 0) break;

    buffers.push(chunkBuf);
    offset += chunkBuf.byteLength;

    if (onProgress && totalBytes > 0) {
      const pct = Math.min(100, Math.round((offset / totalBytes) * 100));
      onProgress(pct, offset, totalBytes);
    }

    if (totalBytes > 0 && offset >= totalBytes) {
      break;
    }
    if (chunkBuf.byteLength < reqLen) {
      break;
    }
  }

  const fullBlob = new Blob(buffers, { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(fullBlob);
  triggerBlobDownload(blobUrl, filename);
  return blobUrl;
}
