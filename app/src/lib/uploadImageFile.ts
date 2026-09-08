// CUSTOM-JOURNAL: shared "upload a standalone image, get back a stored file
// path" helper - the common piece behind EditorStore's uploadCoverImage /
// uploadBackgroundImage (per-entry) and the page-wide background setting in
// PerferSetting.tsx (global, not tied to any note). Same /api/file/upload
// endpoint used for regular note attachments and voice memos.
import axiosInstance from '@/lib/axios';
import { getBlinkoEndpoint } from '@/lib/blinkoEndpoint';
import { RootStore } from '@/store';
import { ToastPlugin } from '@/store/module/Toast/Toast';

export async function uploadImageFile(file: File): Promise<string | undefined> {
  const formData = new FormData();
  formData.append('file', file);
  const { onUploadProgress } = RootStore.Get(ToastPlugin).setSizeThreshold(40).uploadProgress(file);
  const response = await axiosInstance.post(getBlinkoEndpoint('/api/file/upload'), formData, { onUploadProgress });
  return response.data?.filePath;
}
