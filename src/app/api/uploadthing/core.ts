import { createUploadthing, type FileRouter } from 'uploadthing/next';

const f = createUploadthing();

export const uploadRouter = {
    pdfUploader: f({ pdf: { maxFileCount: 1, maxFileSize: '64MB' } }, { awaitServerData: false }).onUploadComplete(
        async () => {
            return;
        },
    ),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
