'use client';

import { useRef, useState } from 'react';

interface UploadZoneProps {
    onFileSelected: (file: File) => void;
    isUploading: boolean;
    error: string | null;
}

export const UploadZone = ({ onFileSelected, isUploading, error }: UploadZoneProps) => {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleFile = (file: File) => {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            alert('Please select a PDF file.');
            return;
        }
        onFileSelected(file);
    };

    const onDrop = (e: React.DragEvent<HTMLButtonElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) {
            handleFile(file);
        }
    };

    return (
        <button
            type="button"
            className={[
                'w-full rounded-xl border border-dashed p-6 transition-colors',
                isDragging ? 'border-zinc-950 bg-zinc-100' : 'border-zinc-300 bg-white',
                'dark:border-zinc-700 dark:bg-zinc-950',
            ].join(' ')}
            disabled={isUploading}
            onDragEnter={(e) => {
                e.preventDefault();
                setIsDragging(true);
            }}
            onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
        >
            <div className="flex flex-col items-center gap-3 text-center">
                <div className="font-medium text-base">Drop a PDF here</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">or</div>
                <div className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 font-medium text-sm text-white dark:bg-zinc-50 dark:text-black">
                    Choose file
                </div>
                <input
                    ref={inputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                            handleFile(file);
                        }

                        e.target.value = '';
                    }}
                />
                {error ? <div className="text-red-600 text-sm">{error}</div> : null}
            </div>
        </button>
    );
};
