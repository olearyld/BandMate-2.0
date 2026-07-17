import { renderHook, act } from '@testing-library/react-native';

const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestMediaLibraryPermissionsAsync(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
  UIImagePickerControllerQualityType: { Medium: 'medium' },
}));

const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: (...args: unknown[]) => mockManipulate(...args) },
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

const mockGetThumbnailAsync = jest.fn();
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (...args: unknown[]) => mockGetThumbnailAsync(...args),
}));

const mockRecorderRecord = jest.fn();
const mockRecorderStop = jest.fn();
let mockRecorderUri: string | null = null;
const mockUseAudioRecorder = jest.fn(() => ({
  record: mockRecorderRecord,
  stop: mockRecorderStop,
  get uri() {
    return mockRecorderUri;
  },
}));
const mockRequestRecordingPermissionsAsync = jest.fn();
const mockSetAudioModeAsync = jest.fn();
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => mockUseAudioRecorder(),
  RecordingPresets: { HIGH_QUALITY: 'high_quality' },
  requestRecordingPermissionsAsync: (...args: unknown[]) =>
    mockRequestRecordingPermissionsAsync(...args),
  setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
}));

const mockUpload = jest.fn();
const mockGetPublicUrl = jest.fn();
jest.mock('../../src/lib/supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        getPublicUrl: (...args: unknown[]) => mockGetPublicUrl(...args),
      })),
    },
  },
}));

const mockFileConstructor = jest.fn();
const mockArrayBuffer = jest.fn(async () => new ArrayBuffer(8));
jest.mock('expo-file-system', () => ({
  File: class {
    constructor(...args: unknown[]) {
      mockFileConstructor(...args);
    }
    arrayBuffer() {
      return mockArrayBuffer();
    }
  },
}));

import {
  pickImage,
  pickVideo,
  uploadIntroMedia,
  uploadPostMedia,
  useMediaRecorder,
  MAX_MEDIA_DURATION_MS,
} from '../../src/lib/mediaUpload';

function manipulatorContext(saveUri = 'compressed.jpg') {
  const context: any = {};
  context.resize = jest.fn(() => context);
  context.renderAsync = jest.fn(async () => ({
    saveAsync: jest.fn(async () => ({ uri: saveUri, width: 100, height: 100 })),
  }));
  return context;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRecorderUri = null;
  mockArrayBuffer.mockClear();
  mockArrayBuffer.mockImplementation(async () => new ArrayBuffer(8));
});

describe('pickImage', () => {
  it('throws if permission is denied', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(pickImage()).rejects.toThrow('Allow photo library access to pick a photo.');
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns null if the user cancels', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
    await expect(pickImage()).resolves.toBeNull();
  });

  it('does not resize an image already under the max dimension', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://small.jpg', width: 800, height: 600 }],
    });
    const ctx = manipulatorContext();
    mockManipulate.mockReturnValue(ctx);

    const result = await pickImage();

    expect(ctx.resize).not.toHaveBeenCalled();
    expect(result).toEqual({ uri: 'compressed.jpg', type: 'image' });
  });

  it('resizes an image over the max dimension to 1600px', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://huge.jpg', width: 4000, height: 3000 }],
    });
    const ctx = manipulatorContext();
    mockManipulate.mockReturnValue(ctx);

    await pickImage();

    expect(ctx.resize).toHaveBeenCalledWith({ width: 1600 });
  });
});

describe('pickVideo', () => {
  it('throws if permission is denied', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await expect(pickVideo()).rejects.toThrow('Allow photo library access to pick a video.');
  });

  it('returns null if the user cancels', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
    await expect(pickVideo()).resolves.toBeNull();
  });

  it('rejects a video over the 60s cap', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://long.mov', duration: MAX_MEDIA_DURATION_MS + 1 }],
    });
    await expect(pickVideo()).rejects.toThrow('Please pick a video under 60 seconds.');
  });

  it('returns media with a thumbnail on success', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://clip.mov', duration: 5000 }],
    });
    mockGetThumbnailAsync.mockResolvedValue({ uri: 'file://thumb.jpg', width: 100, height: 100 });

    const result = await pickVideo();

    expect(result).toEqual({ uri: 'file://clip.mov', type: 'video', thumbnailUri: 'file://thumb.jpg' });
  });

  it('still returns the video if thumbnail generation fails (best-effort)', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://clip.mov', duration: 5000 }],
    });
    mockGetThumbnailAsync.mockRejectedValue(new Error('thumbnail failed'));

    const result = await pickVideo();

    expect(result).toEqual({ uri: 'file://clip.mov', type: 'video', thumbnailUri: undefined });
  });
});

describe('uploadIntroMedia', () => {
  it('uploads to {userId}/intro.{ext} with upsert enabled', async () => {
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn/media/u1/intro.jpg' } });

    const result = await uploadIntroMedia('u1', { uri: 'file://photo.jpg', type: 'image' });

    expect(mockUpload).toHaveBeenCalledWith(
      'u1/intro.jpg',
      expect.anything(),
      expect.objectContaining({ upsert: true, contentType: 'image/jpeg' })
    );
    expect(result).toEqual({ url: 'https://cdn/media/u1/intro.jpg' });
  });

  it('always uses the m4a extension and audio/m4a content type for audio, regardless of source uri', async () => {
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn/media/u1/intro.m4a' } });

    await uploadIntroMedia('u1', { uri: 'file://recording.caf', type: 'audio' });

    expect(mockUpload).toHaveBeenCalledWith(
      'u1/intro.m4a',
      expect.anything(),
      expect.objectContaining({ contentType: 'audio/m4a' })
    );
  });

  it('reads the file via expo-file-system\'s File(uri).arrayBuffer(), not fetch().blob()', async () => {
    // storage-js's own docs: "For React Native, using either Blob, File or FormData
    // does not work as intended" (RN's Blob->FormData serialization doesn't reliably
    // carry the real bytes/content-type) -- an ArrayBuffer is the documented fix.
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn/media/u1/intro.jpg' } });
    const fakeBuffer = new ArrayBuffer(16);
    mockArrayBuffer.mockResolvedValueOnce(fakeBuffer);

    await uploadIntroMedia('u1', { uri: 'file://photo.jpg', type: 'image' });

    expect(mockFileConstructor).toHaveBeenCalledWith('file://photo.jpg');
    expect(mockUpload).toHaveBeenCalledWith(
      'u1/intro.jpg',
      fakeBuffer,
      expect.objectContaining({ contentType: 'image/jpeg' })
    );
  });

  it('propagates a storage upload error', async () => {
    mockUpload.mockResolvedValue({ error: new Error('bucket denied') });
    await expect(uploadIntroMedia('u1', { uri: 'file://x.jpg', type: 'image' })).rejects.toThrow(
      'bucket denied'
    );
  });
});

describe('uploadPostMedia', () => {
  it('uploads to a unique {userId}/posts/{id}.{ext} path with no thumbnail', async () => {
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn/media/u1/posts/x.jpg' } });

    const result = await uploadPostMedia('u1', { uri: 'file://photo.jpg', type: 'image' });

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0][0]).toMatch(/^u1\/posts\/[a-z0-9]+\.jpg$/);
    expect(result.thumbnailUrl).toBeNull();
  });

  it('uploads a second object for the thumbnail when present', async () => {
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl
      .mockReturnValueOnce({ data: { publicUrl: 'https://cdn/media/u1/posts/x.mov' } })
      .mockReturnValueOnce({ data: { publicUrl: 'https://cdn/media/u1/posts/x_thumb.jpg' } });

    const result = await uploadPostMedia('u1', {
      uri: 'file://clip.mov',
      type: 'video',
      thumbnailUri: 'file://thumb.jpg',
    });

    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(mockUpload.mock.calls[0][2]).toEqual(expect.objectContaining({ contentType: 'video/quicktime' }));
    expect(mockUpload.mock.calls[1][0]).toMatch(/^u1\/posts\/[a-z0-9]+_thumb\.jpg$/);
    expect(mockUpload.mock.calls[1][2]).toEqual(expect.objectContaining({ contentType: 'image/jpeg' }));
    expect(result.thumbnailUrl).toBe('https://cdn/media/u1/posts/x_thumb.jpg');
  });
});

describe('useMediaRecorder', () => {
  it('throws from start() if microphone permission is denied, and never records', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: false });
    const { result } = renderHook(() => useMediaRecorder());

    await expect(
      act(async () => {
        await result.current.start();
      })
    ).rejects.toThrow('Allow microphone access to record audio.');
    expect(mockRecorderRecord).not.toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
  });

  it('stop() without a prior start() is a no-op returning null', async () => {
    const { result } = renderHook(() => useMediaRecorder());
    let stopped: unknown;
    await act(async () => {
      stopped = await result.current.stop();
    });
    expect(stopped).toBeNull();
    expect(mockRecorderStop).not.toHaveBeenCalled();
  });

  it('start() then stop() records and returns the audio media', async () => {
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true });
    const { result } = renderHook(() => useMediaRecorder());

    await act(async () => {
      await result.current.start();
    });
    expect(mockRecorderRecord).toHaveBeenCalled();
    expect(result.current.isRecording).toBe(true);

    mockRecorderUri = 'file://recording.m4a';
    let stopped: unknown;
    await act(async () => {
      stopped = await result.current.stop();
    });

    expect(mockRecorderStop).toHaveBeenCalled();
    expect(stopped).toEqual({ uri: 'file://recording.m4a', type: 'audio' });
    expect(result.current.isRecording).toBe(false);
  });

  it('auto-stops after the 60s cap', async () => {
    jest.useFakeTimers();
    mockRequestRecordingPermissionsAsync.mockResolvedValue({ granted: true });
    mockRecorderUri = 'file://auto-stopped.m4a';
    const { result } = renderHook(() => useMediaRecorder());

    await act(async () => {
      await result.current.start();
    });
    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(MAX_MEDIA_DURATION_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRecorderStop).toHaveBeenCalled();
    expect(result.current.isRecording).toBe(false);
    jest.useRealTimers();
  });
});
