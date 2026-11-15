import React from 'react';
import { Download, Film } from 'lucide-react';
import { downloadSmallFileViaFetch } from '../utils/download';

export type WorkspaceSection = 'intake' | 'timeline' | 'preview';

interface TopBarProps {
  hasSession: boolean;
  activeSection: WorkspaceSection;
  onSelectSection: (section: WorkspaceSection) => void;
  onPrimaryAction: () => void;
  primaryLabel: string;
  primaryDisabled?: boolean;
}

export const TopBar: React.FC<TopBarProps> = ({
  hasSession,
  activeSection,
  onSelectSection,
  onPrimaryAction,
  primaryLabel,
  primaryDisabled = false,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-[#E2E8F0] bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-8 px-6">
        {/* Zone 1: Single-line brand wordmark */}
        <button
          type="button"
          onClick={() => onSelectSection('intake')}
          className="flex items-center gap-2.5 text-left text-lg font-bold tracking-tight text-[#0F172A] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#2563EB]"
        >
          <Film className="h-5 w-5 text-[#2563EB]" aria-hidden="true" />
          <span>SceneSync Studio</span>
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#475569]">
          <button
            type="button"
            onClick={() => onSelectSection('intake')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeSection === 'intake'
                ? 'border-[#2563EB] text-[#0F172A]'
                : 'border-transparent hover:text-[#0F172A]'
            }`}
          >
            Media Intake
          </button>
          <button
            type="button"
            disabled={!hasSession}
            onClick={() => onSelectSection('preview')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 disabled:opacity-40 disabled:cursor-not-allowed ${
              activeSection === 'preview'
                ? 'border-[#2563EB] text-[#0F172A]'
                : 'border-transparent hover:text-[#0F172A]'
            }`}
          >
            Sync Preview
          </button>
          <button
            type="button"
            disabled={!hasSession}
            onClick={() => onSelectSection('timeline')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 disabled:opacity-40 disabled:cursor-not-allowed ${
              activeSection === 'timeline'
                ? 'border-[#2563EB] text-[#0F172A]'
                : 'border-transparent hover:text-[#0F172A]'
            }`}
          >
            Storyboard
          </button>
          <button
            type="button"
            onClick={() => {
              void downloadSmallFileViaFetch('/api/launcher/bat', 'launch-studio.bat').catch(() => {});
            }}
            className="inline-flex items-center gap-1.5 py-1 text-[#475569] hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Desktop .bat</span>
          </button>
        </nav>

        {/* Zone 3: Single primary action CTA */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            disabled={primaryDisabled}
            onClick={onPrimaryAction}
            className="inline-flex items-center justify-center rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#94A3B8] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </header>
  );
};
