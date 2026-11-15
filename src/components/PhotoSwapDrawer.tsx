import React, { useMemo, useState } from 'react';
import { Check, Film, ImageOff, Search, X } from 'lucide-react';
import type { SceneItem, UploadedImage } from '../types/studio';

interface PhotoSwapDrawerProps {
  isOpen: boolean;
  targetScene: SceneItem | null;
  images: UploadedImage[];
  scenes: SceneItem[];
  onClose: () => void;
  onSelectPhoto: (sceneId: string, newImageId: string) => void;
}

export const PhotoSwapDrawer: React.FC<PhotoSwapDrawerProps> = ({
  isOpen,
  targetScene,
  images,
  scenes,
  onClose,
  onSelectPhoto,
}) => {
  const [query, setQuery] = useState('');
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  const usageByImageId = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const s of scenes) {
      const list = map.get(s.imageId) ?? [];
      list.push(s.index + 1);
      map.set(s.imageId, list);
    }
    return map;
  }, [scenes]);

  const filteredImages = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? images.filter(
          (img) =>
            img.originalName.toLowerCase().includes(q) ||
            img.visualSummary.toLowerCase().includes(q)
        )
      : images;

    return [...list].sort((a, b) => {
      const aUsed = (usageByImageId.get(a.id)?.length ?? 0) > 0 ? 1 : 0;
      const bUsed = (usageByImageId.get(b.id)?.length ?? 0) > 0 ? 1 : 0;
      return aUsed - bUsed;
    });
  }, [images, query, usageByImageId]);

  if (!isOpen || !targetScene) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#0F172A]/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Swap Scene Media"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-[#E2E8F0] bg-white">
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E8F0] px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[#0F172A]">
              Swap Media for Scene {String(targetScene.index + 1).padStart(2, '0')}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs text-[#475569]">
              “{targetScene.text}”
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close media swap drawer"
            className="rounded-lg border border-[#E2E8F0] p-2 text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="border-b border-[#E2E8F0] px-6 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter photos or B-roll clips by AI description or filename..."
              className="w-full rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] py-2 pl-9 pr-3 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {filteredImages.map((img) => {
              const isSelected = targetScene.imageId === img.id;
              const usedIn = usageByImageId.get(img.id) ?? [];

              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => {
                    onSelectPhoto(targetScene.id, img.id);
                    onClose();
                  }}
                  className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-colors ${
                    isSelected
                      ? 'border-[#2563EB] bg-[#EFF6FF]/40 ring-2 ring-[#2563EB]/20'
                      : 'border-[#E2E8F0] bg-white hover:border-[#2563EB]'
                  }`}
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-[#F1F5F9]">
                    {!broken[img.id] ? (
                      <img
                        src={img.thumbUrl}
                        alt={img.visualSummary}
                        referrerPolicy="no-referrer"
                        onError={() => setBroken((prev) => ({ ...prev, [img.id]: true }))}
                        className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[#94A3B8]">
                        <ImageOff className="h-6 w-6" aria-hidden="true" />
                      </div>
                    )}

                    {img.mediaType === 'video' && (
                      <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-time">
                        <Film className="h-3 w-3" aria-hidden="true" />
                        <span>
                          VIDEO{img.clipDurationMs ? ` · ${(img.clipDurationMs / 1000).toFixed(1)}s` : ''}
                        </span>
                      </div>
                    )}

                    {isSelected && (
                      <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#2563EB] text-white">
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                    )}
                  </div>

                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-semibold text-[#0F172A]">
                        {img.originalName}
                      </span>
                      <span
                        className={`shrink-0 font-medium ${
                          usedIn.length === 0 ? 'text-[#16A34A]' : 'text-[#64748B]'
                        }`}
                      >
                        {usedIn.length === 0
                          ? 'Unused'
                          : `Scene ${usedIn.map((n) => String(n).padStart(2, '0')).join(', ')}`}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#475569]">
                      {img.visualSummary}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
