import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, Loader2, X, XCircle } from 'lucide-react';
import type { RenderJobState } from '../types/studio';
import { downloadJobVideoInChunks, triggerBlobDownload } from '../utils/download';
import { formatBytes, formatDurationSec } from '../utils/time';

interface ExportModalProps {
  isOpen: boolean;
  jobState: RenderJobState | null;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  jobState,
  onClose,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadPct, setDownloadPct] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [cachedBlobs, setCachedBlobs] = useState<Record<string, string>>({});

  useEffect(() => {
    return () => {
      for (const url of Object.values(cachedBlobs)) {
        URL.revokeObjectURL(url);
      }
    };
  }, [cachedBlobs]);

  useEffect(() => {
    setDownloadError(null);
    setDownloadPct(0);
    setDownloadedBytes(0);
  }, [jobState?.jobId]);

  if (!isOpen || !jobState) return null;

  const isCompleted = jobState.status === 'completed';
  const isFailed = jobState.status === 'failed'||jobState.status==='cancelled';
  const filename = `scenesync_${jobState.projectId}_1080p.mp4`;
  const cachedUrl = cachedBlobs[jobState.jobId];

  const handleDownloadClick = async () => {
    setDownloadError(null);

    if (cachedUrl) {
      triggerBlobDownload(cachedUrl, filename);
      return;
    }

    setIsDownloading(true);
    setDownloadPct(0);
    setDownloadedBytes(0);

    try {
      const blobUrl = await downloadJobVideoInChunks(
        jobState.jobId,
        filename,
        jobState.fileSizeBytes,
        (pct, loaded) => {
          setDownloadPct(pct);
          setDownloadedBytes(loaded);
        }
      );
      setCachedBlobs((prev) => ({ ...prev, [jobState.jobId]: blobUrl }));
    } catch (err: unknown) {
      setDownloadError(
        err instanceof Error ? err.message : 'Download interrupted. Please click Download MP4 again.'
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Export 1080p MP4"
    >
      <div className="w-full max-w-lg rounded-xl border border-[#E2E8F0] bg-white p-6">
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] pb-4">
          <div>
            <h3 className="text-lg font-bold text-[#0F172A]">
              1080p MP4 Export Studio
            </h3>
            <p className="mt-0.5 text-xs text-[#475569] tabular-time">
              <span>Encoder: {jobState.encoderUsed}</span>
              <span aria-hidden="true"> · </span>
              <span>Elapsed: {formatDurationSec(jobState.elapsedMs)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="rounded-lg border border-[#E2E8F0] p-1.5 text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="py-5">
          {/* Status Header */}
          <div className="flex items-center gap-3">
            {isCompleted ? (
              <CheckCircle2 className="h-6 w-6 shrink-0 text-[#16A34A]" aria-hidden="true" />
            ) : isFailed ? (
              <XCircle className="h-6 w-6 shrink-0 text-[#DC2626]" aria-hidden="true" />
            ) : (
              <Loader2 className="h-6 w-6 shrink-0 animate-spin text-[#2563EB]" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#0F172A]">{jobState.stage}</p>
              <p className="mt-0.5 text-xs text-[#475569]">{jobState.message}</p>
            </div>
            <span className="tabular-time text-sm font-bold text-[#0F172A]">
              {jobState.progress}%
            </span>
          </div>

          {!isCompleted&&!isFailed&&jobState.jobId!=='pending'&&<button className="mt-4 rounded border border-[#cbd5e1] px-3 py-2 text-xs text-[#475569] hover:bg-[#f1f5f9]" onClick={async()=>{try{const r=await fetch(`/api/jobs/${jobState.jobId}/cancel`,{method:'POST'});if(!r.ok){const x=await r.json();setDownloadError(x.error||'Could not cancel render.');}}catch{setDownloadError('Could not reach the render server.');}}}>Cancel render</button>}
          {downloadError&&!isCompleted&&<p role="alert" className="mt-3 text-xs text-[#991b1b]">{downloadError}</p>}
          {/* Render Progress Bar */}
          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-[#F1F5F9]">
            <div
              style={{ width: `${Math.max(2, jobState.progress)}%` }}
              className={`h-full transition-all duration-200 ${
                isFailed
                  ? 'bg-[#DC2626]'
                  : isCompleted
                    ? 'bg-[#16A34A]'
                    : 'bg-[#2563EB]'
              }`}
            />
          </div>

          {isCompleted && jobState.outputUrl && (
            <div className="mt-5 space-y-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-[#475569] tabular-time">
                  <p className="font-semibold text-[#0F172A]">
                    Master MP4 Ready ({formatBytes(jobState.fileSizeBytes)})
                  </p>
                  <p className="mt-0.5">
                    H.264 30fps · AAC 192kbps · Validated audio and video coverage
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={handleDownloadClick}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-60 whitespace-nowrap"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span className="tabular-time">Saving ({downloadPct}%)...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      <span>{cachedUrl ? 'Save MP4 Again' : 'Download MP4'}</span>
                    </>
                  )}
                </button>
              </div>

              {isDownloading && (
                <div className="space-y-1.5 border-t border-[#E2E8F0] pt-2.5">
                  <div className="flex items-center justify-between text-[11px] text-[#475569] tabular-time">
                    <span>Transferring video in safe 5 MB chunks...</span>
                    <span>
                      {formatBytes(downloadedBytes)} / {formatBytes(jobState.fileSizeBytes)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#E2E8F0]">
                    <div
                      style={{ width: `${Math.max(4, downloadPct)}%` }}
                      className="h-full bg-[#2563EB] transition-all duration-150"
                    />
                  </div>
                </div>
              )}

              {!isDownloading && (
                <div className="border-t border-[#E2E8F0] pt-3">
                  <video
                    controls
                    playsInline
                    src={cachedUrl || jobState.outputUrl}
                    className="max-h-56 w-full rounded-md bg-black"
                  />
                </div>
              )}

              {downloadError && (
                <div className="rounded-md border border-[#FECACA] bg-[#FEF2F2] p-2.5 text-xs text-[#991B1B]">
                  {downloadError}
                </div>
              )}
            </div>
          )}

          {isFailed && jobState.error && (
            <div className="mt-4 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]">
              {jobState.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
