import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileCheck2, Paperclip, UploadCloud, X } from 'lucide-react';

export interface ValidatedFileUploadProps {
  label: string;
  acceptedExtensions: string[];
  maxBytes?: number;
  fileName: string;
  isSubmitting?: boolean;
  onFileValidated: (fileName: string, dataUrl: string) => void;
  onClearFile: () => void;
  onValidationError?: (message: string) => void;
}

type UploadPhase = 'idle' | 'reading' | 'ready' | 'error';

const DEFAULT_MAX_BYTES = 240 * 1024; // 240 KB raw -> ~320 KB base64 (safely within Firestore 360 KB limit)
const MAX_DATA_URL_LENGTH = 350_000;

const ALLOWED_MIME_PREFIXES_OR_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return `${kb.toFixed(1)} KB`;
}

export function ValidatedFileUpload({
  label,
  acceptedExtensions,
  maxBytes = DEFAULT_MAX_BYTES,
  fileName,
  isSubmitting = false,
  onFileValidated,
  onClearFile,
  onValidationError,
}: ValidatedFileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<UploadPhase>(fileName ? 'ready' : 'idle');
  const [progress, setProgress] = useState<number>(fileName ? 100 : 0);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Sync if parent clears attachment after successful submit
  useEffect(() => {
    if (!fileName && phase === 'ready') {
      setPhase('idle');
      setProgress(0);
      setFileSizeBytes(null);
      setErrorMsg('');
    } else if (fileName && phase === 'idle') {
      setPhase('ready');
      setProgress(100);
    }
  }, [fileName, phase]);

  const normalizedExts = acceptedExtensions.map((ext) =>
    ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  );

  const failValidation = (message: string, attemptedSize?: number) => {
    setPhase('error');
    setProgress(attemptedSize ? Math.min(100, Math.round((attemptedSize / maxBytes) * 100)) : 100);
    setFileSizeBytes(attemptedSize ?? null);
    setErrorMsg(message);
    onClearFile();
    if (onValidationError) onValidationError(message);
  };

  const processFile = (file: File) => {
    setErrorMsg('');

    // 1. Validate extension
    const dotIdx = file.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : '';
    if (!ext || !normalizedExts.includes(ext)) {
      failValidation(
        `Unsupported file format${ext ? ` (${ext})` : ''}. Allowed types: ${normalizedExts.join(', ')}.`,
        file.size
      );
      return;
    }

    // 2. Validate MIME type if browser provided one
    if (file.type && !ALLOWED_MIME_PREFIXES_OR_TYPES.has(file.type.toLowerCase())) {
      failValidation(
        `Blocked file MIME type (${file.type}). Upload a valid document or archive matching ${normalizedExts.join(', ')}.`,
        file.size
      );
      return;
    }

    // 3. Validate non-empty & max byte size
    if (file.size <= 0) {
      failValidation('Selected file is empty (0 B). Choose a non-empty file.', 0);
      return;
    }
    if (file.size > maxBytes) {
      failValidation(
        `File size (${formatBytes(file.size)}) exceeds the ${formatBytes(maxBytes)} portal limit. Compress the file or attach an external URL instead.`,
        file.size
      );
      return;
    }

    // 4. Read & encode with live progress feedback
    setPhase('reading');
    setProgress(12);
    setFileSizeBytes(file.size);

    const reader = new FileReader();
    reader.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        const pct = Math.min(95, Math.max(15, Math.round((ev.loaded / ev.total) * 100)));
        setProgress(pct);
      }
    };
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl || dataUrl.length > MAX_DATA_URL_LENGTH) {
        failValidation(
          `Encoded file exceeds the portal storage cap (${formatBytes(maxBytes)} raw). Please use an external link instead.`,
          file.size
        );
        return;
      }
      setProgress(100);
      setPhase('ready');
      setErrorMsg('');
      onFileValidated(file.name, dataUrl);
    };
    reader.onerror = () => {
      failValidation('Could not read the selected file from disk. Please try again.', file.size);
    };
    reader.readAsDataURL(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    processFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const handleReset = () => {
    setPhase('idle');
    setProgress(0);
    setFileSizeBytes(null);
    setErrorMsg('');
    if (inputRef.current) inputRef.current.value = '';
    onClearFile();
  };

  const effectivePhase: UploadPhase = isSubmitting && fileName ? 'reading' : phase;
  const effectiveProgress = isSubmitting && fileName ? 92 : progress;

  const progressColorClass =
    effectivePhase === 'error'
      ? '[&::-webkit-progress-value]:bg-red-500 [&::-moz-progress-bar]:bg-red-500'
      : effectivePhase === 'ready'
      ? '[&::-webkit-progress-value]:bg-emerald-500 [&::-moz-progress-bar]:bg-emerald-500'
      : '[&::-webkit-progress-value]:bg-amber-500 [&::-moz-progress-bar]:bg-amber-500';

  return (
    <div className="space-y-2 w-full">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`rounded-lg border p-3 transition-colors ${
          effectivePhase === 'error'
            ? 'border-red-500/60 bg-red-500/5 dark:bg-red-500/10'
            : isDragging
            ? 'border-amber-500 bg-amber-500/10'
            : effectivePhase === 'ready'
            ? 'border-emerald-500/50 bg-emerald-500/5 dark:bg-emerald-500/10'
            : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-100 cursor-pointer min-w-0">
            {effectivePhase === 'ready' ? (
              <FileCheck2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : effectivePhase === 'reading' ? (
              <UploadCloud className="w-4 h-4 text-amber-500 shrink-0" />
            ) : (
              <Paperclip className="w-4 h-4 text-amber-500 shrink-0" />
            )}
            <span className="truncate">
              {fileName ? `Attached: ${fileName}` : label}
            </span>
            <input
              ref={inputRef}
              type="file"
              accept={normalizedExts.join(',')}
              onChange={handleInputChange}
              className="hidden"
            />
          </label>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {fileSizeBytes !== null ? `${formatBytes(fileSizeBytes)} / ` : ''}
              Max {formatBytes(maxBytes)}
            </span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="px-2.5 py-1 text-[11px] font-semibold rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-700 dark:text-slate-200 hover:border-amber-500 whitespace-nowrap"
            >
              {fileName ? 'Replace' : 'Browse File'}
            </button>
            {(fileName || effectivePhase === 'error') && (
              <button
                type="button"
                onClick={handleReset}
                aria-label="Clear file selection"
                className="p-1 rounded text-slate-400 hover:text-red-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Allowed Extensions Helper */}
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          Drag &amp; drop or browse · Allowed formats:{' '}
          <span className="font-mono">{normalizedExts.join(', ')}</span>
        </p>

        {/* Visual Progress Bar & Status Readout */}
        {effectivePhase !== 'idle' && (
          <div className="mt-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  effectivePhase === 'error'
                    ? 'text-red-600 dark:text-red-400'
                    : effectivePhase === 'ready'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {effectivePhase === 'error' && <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                {effectivePhase === 'ready' && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                <span>
                  {isSubmitting && fileName
                    ? 'Uploading attachment to portal...'
                    : effectivePhase === 'reading'
                    ? 'Validating & preparing file...'
                    : effectivePhase === 'ready'
                    ? 'File validated & ready to publish'
                    : 'Validation failed'}
                </span>
              </span>
              <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                {effectivePhase === 'error' ? 'Rejected' : `${effectiveProgress}%`}
              </span>
            </div>

            <progress
              value={effectiveProgress}
              max={100}
              aria-label="File validation and upload progress"
              className={`block w-full h-1.5 overflow-hidden rounded-full appearance-none bg-slate-200 dark:bg-slate-800 [&::-webkit-progress-bar]:bg-slate-200 dark:[&::-webkit-progress-bar]:bg-slate-800 [&::-webkit-progress-value]:transition-all [&::-webkit-progress-value]:duration-200 ${progressColorClass}`}
            />

            {effectivePhase === 'error' && errorMsg && (
              <p className="text-xs text-red-600 dark:text-red-400 leading-snug">{errorMsg}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
