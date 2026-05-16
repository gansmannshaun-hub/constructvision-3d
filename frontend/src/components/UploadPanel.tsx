import { useState } from 'react';
import axios from 'axios';

interface Props {
  onUploadSuccess: (id: string, data: any) => void;
}

export default function UploadPanel({ onUploadSuccess }: Props) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const formData = new FormData();
    Array.from(files).forEach(file => formData.append('files', file));

    try {
      const response = await axios.post('/api/upload/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });

      onUploadSuccess(response.data.project_id, response.data.extracted_data || {});
      alert(`✅ ${files.length} file(s) uploaded successfully!`);
    } catch (err: any) {
      console.error(err);
      alert("Upload failed. Check console (F12).");
    }
    setUploading(false);
  };

  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold mb-3">Upload Construction Documents</h3>
      <input
        type="file"
        multiple
        accept=".pdf,.jpg,.png,.jpeg"
        onChange={handleUpload}
        disabled={uploading}
        className="block w-full text-sm text-gray-400 file:mr-4 file:py-3 file:px-6 file:rounded-lg file:border-0 file:bg-cyan-600 file:text-white hover:file:bg-cyan-700 cursor-pointer"
      />
      <p className="text-xs text-gray-500 mt-2">PDFs work best for accurate 3D generation</p>
    </div>
  );
}