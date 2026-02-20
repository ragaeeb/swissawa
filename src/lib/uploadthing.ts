import { genUploader } from 'uploadthing/client';
import type { UploadRouter } from '@/app/api/uploadthing/core';

export const uploadthingClient = genUploader<UploadRouter>({ url: '/api/uploadthing' });
